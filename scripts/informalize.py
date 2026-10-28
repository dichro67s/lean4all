#!/usr/bin/env python3
"""Auto-informalization: Qwen reads each Lean statement back into plain mathematics.

For every theorem card, two calls to an OpenAI-compatible endpoint (our vLLM-served Qwen):

  1. Read-back. Qwen sees only the Lean preamble and statement, never the human-written
     description, and states what the Lean actually says, in English and Korean.
  2. Audit. Qwen compares that reading with the human description and flags any mismatch
     (missing hypotheses, off-by-one ranges, wrong quantifiers, ...).

Results go to informal/<ID>.json, keyed by a hash of the formal statement, so a theorem is only
re-informalized if its statement changes. Usage:

  python3 scripts/informalize.py            # fill in missing / stale entries
  python3 scripts/informalize.py --force T0003
Environment: QWEN_URL (default http://127.0.0.1:18080/v1), QWEN_MODEL (default Qwen3.8-Flash-Next).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lean4all as L  # noqa: E402

OUT = L.ROOT / "informal"
URL = os.environ.get("QWEN_URL", "http://127.0.0.1:18080/v1").rstrip("/")
MODEL = os.environ.get("QWEN_MODEL", "Qwen3.8-Flash-Next")

READBACK_SYSTEM = """You are an expert mathematician and Lean 4 / Mathlib user. You translate Lean \
statements into precise, natural mathematical language ("informalization").
Rules:
- State exactly what the Lean says: every hypothesis, every quantifier, the exact types \
(ℕ includes 0; ℕ subtraction truncates; division on ℕ is floor division; Finset.range n = {0,…,n-1}).
- Do not add or drop assumptions, and do not explain how to prove it.
- Write math in LaTeX between $…$. Keep it to one to three sentences.
- `en` is English. `ko` is natural Korean in the style of a Korean math textbook (e.g. "…이면 …이다").
- `caveats_en`/`caveats_ko`: list any Lean-specific subtleties a mathematician might miss \
(e.g. truncated subtraction, 0 being allowed, junk values like x/0 = 0, what Finset.range covers). \
Each caveat is one short, final sentence about how to read the Lean. Never judge whether the \
statement is true, never think aloud, never write "wait". Use an empty list if there is nothing \
subtle, and at most three items."""

AUDIT_SYSTEM = """You audit formalizations. You are given a Lean 4 statement, a faithful reading of \
it, and the human-written description it is supposed to formalize. Decide whether the Lean \
statement says the same thing as the description. Minor wording differences are fine; flag \
genuine mathematical differences (missing or extra hypotheses, wrong ranges or types, \
off-by-one, different quantifiers, a weaker or stronger claim). \
`verdict` is "match", "minor" (harmless difference worth noting) or "mismatch". \
Write `note_en` (English) and `note_ko` (Korean), one or two sentences each; empty if verdict is "match"."""

READBACK_SCHEMA = {
    "type": "object",
    "properties": {
        "en": {"type": "string"}, "ko": {"type": "string"},
        "caveats_en": {"type": "array", "items": {"type": "string"}},
        "caveats_ko": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["en", "ko", "caveats_en", "caveats_ko"],
}
AUDIT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["match", "minor", "mismatch"]},
        "note_en": {"type": "string"}, "note_ko": {"type": "string"},
    },
    "required": ["verdict", "note_en", "note_ko"],
}


def chat(system: str, user: str, schema: dict) -> dict:
    body = {
        "model": MODEL, "temperature": 0, "max_tokens": 1200,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": "out", "schema": schema, "strict": True}},
    }
    req = urllib.request.Request(f"{URL}/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        content = json.load(r)["choices"][0]["message"]["content"]
    return json.loads(content)


def definitions_for(card: dict) -> str:
    imports, _ = L.split_header(L.preamble_of(card))
    out = []
    for imp in imports:
        m = L.DEF_IMPORT.match(imp)
        if m:
            out.append(f"-- {imp}\n" + (L.DEFINITIONS / f"{m.group(1)}.lean").read_text(encoding="utf-8"))
    return "\n\n".join(out)


def formal_hash(card: dict) -> str:
    text = L.preamble_of(card) + "\n" + card["statement"].strip() + "\n" + definitions_for(card)
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def informalize(tid: str, card: dict) -> dict:
    lean = f"{L.preamble_of(card)}\n\ntheorem {tid} {card['statement'].strip()}"
    defs = definitions_for(card)
    user = f"Lean 4 (Mathlib) statement:\n```lean\n{lean}\n```"
    if defs:
        user += f"\n\nDefinitions it uses:\n```lean\n{defs}\n```"
    rb = chat(READBACK_SYSTEM, user, READBACK_SCHEMA)
    audit = chat(AUDIT_SYSTEM,
                 f"{user}\n\nFaithful reading: {rb['en']}\n\n"
                 f"Human description (title: {card.get('title', '')}):\n{card.get('description', '')}",
                 AUDIT_SCHEMA)
    return {
        "id": tid, "hash": formal_hash(card), "model": MODEL,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        **rb, "audit": audit,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--force", nargs="*", default=None, help="re-run these ids (all if none given)")
    a = ap.parse_args()
    cards, errors = L.load_cards()
    OUT.mkdir(exist_ok=True)
    done = []
    for tid, card in cards.items():
        if errors[tid]:
            continue
        path = OUT / f"{tid}.json"
        forced = a.force is not None and (not a.force or tid in a.force)
        if path.exists() and not forced:
            try:
                if json.loads(path.read_text())["hash"] == formal_hash(card):
                    continue
            except Exception:  # noqa: BLE001
                pass
        try:
            res = informalize(tid, card)
        except Exception as e:  # noqa: BLE001
            print(f"{tid}: failed ({e})", file=sys.stderr)
            continue
        path.write_text(json.dumps(res, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        done.append(tid)
        print(f"{tid}: {res['audit']['verdict']} — {res['en']}")
    print(f"informalized {len(done)} theorem(s)" + (f": {', '.join(done)}" if done else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
