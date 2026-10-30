#!/usr/bin/env python3
"""Formalize an arXiv paper: turn it into a blueprint, a mission and Lean theorem cards.

  python3 scripts/arxiv_blueprint.py 2401.12345            # or an arxiv.org URL
  python3 scripts/arxiv_blueprint.py --from-issues          # process open "[arXiv]" GitHub issues

Pipeline
  1. Download the paper's LaTeX source from arXiv (falls back to the PDF's text).
  2. Extract every theorem-like environment, its label, number, proof, and the results its proof
     cites (\\ref inside the proof) -> the paper's dependency graph.
  3. Ask Qwen for shared conventions and Lean definitions; compile them, feeding errors back.
  4. Ask Qwen for a Lean statement of every result, using those definitions; compile them all,
     feeding errors back, so every published statement builds against Mathlib.
  5. Write blueprints/<slug>/blueprint.json + BLUEPRINT.md (the coordination contract for agents),
     definitions/<Module>.lean, missions/<slug>.yaml and theorems/T*.yaml.

Uses the same OpenAI-compatible endpoint as informalize.py (QWEN_URL / QWEN_MODEL).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import gzip
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lean4all as L  # noqa: E402
from informalize import MODEL, chat  # noqa: E402

BLUEPRINTS = L.ROOT / "blueprints"
UA = {"User-Agent": "lean4all-blueprint/1.0 (https://github.com/dichro67s/lean4all)"}
MAX_DOWNLOAD = 60 * 1024 * 1024
MAX_ITEMS = 40
ROUNDS = 3
STATE = Path(os.environ.get("LEAN4ALL_STATE", Path.home() / ".local/state/lean4all-arxiv.json"))

CATEGORY_TAGS = {
    "math.CO": "Combinatorics", "math.NT": "Number Theory", "math.AG": "Algebraic Geometry",
    "math.PR": "Probability", "math.CA": "Classical Analysis", "math.FA": "Functional Analysis",
    "math.GR": "Group Theory", "math.LO": "Logic", "math.GT": "Geometric Topology",
    "math.DS": "Dynamical Systems", "math.AC": "Commutative Algebra", "math.RA": "Rings and Algebras",
    "math.OC": "Optimization", "math.ST": "Statistics", "math.MG": "Metric Geometry",
    "math.AP": "Analysis of PDEs", "math.GN": "General Topology", "math.CT": "Category Theory",
    "math.RT": "Representation Theory", "math.SP": "Spectral Theory", "math.IT": "Information Theory",
    "math.DG": "Differential Geometry", "math.AT": "Algebraic Topology", "math.CV": "Complex Variables",
    "math.KT": "K-Theory", "math.QA": "Quantum Algebra", "math.SG": "Symplectic Geometry",
    "math.NA": "Numerical Analysis", "math.OA": "Operator Algebras", "math.HO": "History and Overview",
    "cs.DS": "Algorithms", "cs.CC": "Computational Complexity", "cs.DM": "Discrete Mathematics",
    "cs.LO": "Logic in CS", "cs.IT": "Information Theory", "quant-ph": "Quantum Computing",
}
FORMAL_KINDS = {"theorem", "lemma", "proposition", "corollary", "claim", "conjecture", "fact", "observation",
                "property"}  # "property": derived from a paper's definitions when it states no theorems
MILESTONE_KINDS = {"theorem", "proposition", "corollary", "property"}
DEFAULT_ENVS = {"theorem": "Theorem", "thm": "Theorem", "lemma": "Lemma", "lem": "Lemma",
                "proposition": "Proposition", "prop": "Proposition", "corollary": "Corollary",
                "cor": "Corollary", "definition": "Definition", "defn": "Definition", "dfn": "Definition",
                "conjecture": "Conjecture", "conj": "Conjecture", "claim": "Claim", "fact": "Fact",
                "observation": "Observation", "remark": "Remark", "example": "Example"}


# ----------------------------------------------------------------------------------------------
# Identifiers
# ----------------------------------------------------------------------------------------------

def parse_id(text: str) -> str:
    """'https://arxiv.org/abs/2401.12345v2' / 'arXiv:2401.12345' / '2401.12345' -> '2401.12345'."""
    s = text.strip()
    m = re.search(r"(\d{4}\.\d{4,5})(v\d+)?", s)
    if m:
        return m.group(1)
    m = re.search(r"([a-z\-]+(?:\.[A-Z]{2})?/\d{7})(v\d+)?", s)
    if m:
        return m.group(1)
    raise ValueError(f"not an arXiv identifier: {text!r}")


def slug(aid: str) -> str:
    return "arxiv-" + re.sub(r"[^a-z0-9]+", "-", aid.lower()).strip("-")


def module_name(aid: str) -> str:
    parts = re.split(r"[^A-Za-z0-9]+", aid)
    return "Arxiv" + "".join(p[:1].upper() + p[1:] for p in parts if p).replace(".", "")


# ----------------------------------------------------------------------------------------------
# Download
# ----------------------------------------------------------------------------------------------

def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise RuntimeError("download too large")
    return data


def fetch_meta(aid: str) -> dict:
    xml = http_get(f"https://export.arxiv.org/api/query?id_list={aid}").decode("utf-8", "replace")
    entry = xml.split("<entry>", 1)[1] if "<entry>" in xml else ""
    get = lambda tag: " ".join((re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", entry, re.S) or [None, ""])[1].split())  # noqa: E731
    title = get("title")
    if not title:
        raise RuntimeError(f"arXiv:{aid} not found")
    authors = [" ".join(a.split()) for a in re.findall(r"<name>(.*?)</name>", entry, re.S)]
    cats = re.findall(r'<category term="([^"]+)"', entry)
    return {"arxiv": aid, "title": title, "authors": authors, "abstract": get("summary"),
            "categories": cats, "published": get("published")[:10],
            "url": f"https://arxiv.org/abs/{aid}"}


def download_source(aid: str, work: Path) -> tuple[str, str]:
    """Return ('latex', flattened tex) or ('pdf', extracted text)."""
    data = http_get(f"https://arxiv.org/e-print/{aid}")
    if data[:2] == b"\x1f\x8b":
        try:
            data = gzip.decompress(data)
        except OSError:
            pass
    if data[:4] == b"%PDF":
        return "pdf", pdf_text(data, work)
    src = work / "src"
    src.mkdir()
    bio = io.BytesIO(data)
    if tarfile.is_tarfile(bio):
        bio.seek(0)
        with tarfile.open(fileobj=bio) as tar:
            total = 0
            members = []
            for m in tar.getmembers():
                if m.isfile() and m.size < 20 * 1024 * 1024:
                    total += m.size
                    members.append(m)
            if total > 200 * 1024 * 1024:
                raise RuntimeError("source archive too large")
            tar.extractall(src, members=members, filter="data")
    else:
        (src / "main.tex").write_bytes(data)
    main = find_main_tex(src)
    if main is None:  # no LaTeX: fall back to the PDF
        return "pdf", pdf_text(http_get(f"https://arxiv.org/pdf/{aid}"), work)
    return "latex", flatten(main, src)


def pdf_text(data: bytes, work: Path) -> str:
    pdf = work / "paper.pdf"
    pdf.write_bytes(data)
    out = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True,
                         timeout=300)
    return out.stdout


def find_main_tex(src: Path) -> Path | None:
    cands = []
    for p in src.rglob("*.tex"):
        try:
            t = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "\\documentclass" in t:
            cands.append((("\\begin{document}" in t), len(t), p))
    if not cands:
        return None
    return sorted(cands, key=lambda c: (c[0], c[1]))[-1][2]


def strip_comments(tex: str) -> str:
    return re.sub(r"(?<!\\)%.*", "", tex)


def flatten(path: Path, root: Path, depth: int = 0) -> str:
    text = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
    if depth > 8:
        return text

    def sub(m: re.Match) -> str:
        name = m.group(2).strip()
        for cand in (name, name + ".tex"):
            p = (path.parent / cand).resolve()
            if p.is_file() and root.resolve() in p.parents:
                return flatten(p, root, depth + 1)
            p = (root / cand).resolve()
            if p.is_file() and root.resolve() in p.parents:
                return flatten(p, root, depth + 1)
        return ""
    return re.sub(r"\\(input|include|subfile)\s*\{([^}]*)\}", sub, text)


# ----------------------------------------------------------------------------------------------
# LaTeX parsing
# ----------------------------------------------------------------------------------------------

def balanced(s: str, i: int, open_: str = "{", close: str = "}") -> tuple[str, int]:
    """s[i] == open_. Return (contents, index after the closing bracket)."""
    depth, j = 0, i
    while j < len(s):
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == open_:
            depth += 1
        elif c == close:
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1
    return s[i + 1:], len(s)


def parse_macros(tex: str) -> tuple[str, dict]:
    """Return (macro definitions as LaTeX for prompts, simple KaTeX macro map for display)."""
    lines, katex = [], {}
    for m in re.finditer(r"\\(?:re)?newcommand\*?\s*\{?\s*(\\[A-Za-z]+)\s*\}?\s*(?:\[(\d)\])?\s*(?=\{)", tex):
        body, end = balanced(tex, m.end())
        lines.append(tex[m.start():end])
        katex[m.group(1)] = body
    for m in re.finditer(r"\\DeclareMathOperator\*?\s*\{\s*(\\[A-Za-z]+)\s*\}\s*(?=\{)", tex):
        body, end = balanced(tex, m.end())
        lines.append(tex[m.start():end])
        katex[m.group(1)] = f"\\operatorname{{{body}}}"
    for m in re.finditer(r"\\def\s*(\\[A-Za-z]+)\s*(?=\{)", tex):
        body, end = balanced(tex, m.end())
        lines.append(tex[m.start():end])
        katex.setdefault(m.group(1), body)
    return "\n".join(lines[:150]), {k: v for k, v in katex.items() if len(v) < 200}


def theorem_envs(tex: str) -> dict:
    """env name -> (display name, shared counter, numbered within)."""
    envs = {}
    for m in re.finditer(r"\\newtheorem(\*?)\s*\{([^}]+)\}\s*(?:\[([^\]]+)\])?\s*\{([^}]+)\}\s*(?:\[([^\]]+)\])?", tex):
        star, env, shared, name, within = m.groups()
        envs[env.strip()] = {"name": name.strip(), "shared": (shared or "").strip() or None,
                             "within": (within or "").strip() or None, "numbered": not star}
    for m in re.finditer(r"\\declaretheorem\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}", tex):
        opts, env = m.group(1) or "", m.group(2).strip()
        name = re.search(r"name\s*=\s*\{?([^,}\]]+)", opts)
        sib = re.search(r"(?:sibling|numberlike)\s*=\s*([^,\]]+)", opts)
        within = re.search(r"(?:numberwithin|parent)\s*=\s*([^,\]]+)", opts)
        envs[env] = {"name": (name.group(1).strip() if name else env.capitalize()),
                     "shared": sib.group(1).strip() if sib else None,
                     "within": within.group(1).strip() if within else None,
                     "numbered": "numbered=no" not in opts.replace(" ", "")}
    for env, name in DEFAULT_ENVS.items():
        envs.setdefault(env, {"name": name, "shared": None, "within": None, "numbered": True})
    return envs


def kind_of(name: str) -> str:
    n = name.lower()
    for k in ("theorem", "lemma", "proposition", "corollary", "definition", "conjecture", "claim",
              "fact", "observation", "remark", "example"):
        if k in n:
            return k
    return "other"


def extract_items(tex: str) -> list[dict]:
    envs = theorem_envs(tex)
    body = tex.split("\\begin{document}", 1)[-1].split("\\end{document}", 1)[0]
    names = sorted(envs, key=len, reverse=True)
    pat = re.compile(r"\\(section|subsection|appendix)\b\*?|\\begin\{(" + "|".join(map(re.escape, names)) + r")\}")
    items, counters, sec, appendix, secname = [], {}, 0, False, ""
    pos = 0
    while True:
        m = pat.search(body, pos)
        if not m:
            break
        if m.group(1) == "section":
            sec += 1
            counters = {k: v for k, v in counters.items() if envs.get(k, {}).get("within") != "section"}
            j = m.end()
            while j < len(body) and body[j] in " \t\n*":
                j += 1
            if j < len(body) and body[j] == "[":
                _, j = balanced(body, j, "[", "]")
            if j < len(body) and body[j] == "{":
                secname, j = balanced(body, j)
            pos = m.end()
            continue
        if m.group(1) == "appendix":
            appendix, sec = True, 0
            pos = m.end()
            continue
        if m.group(1) == "subsection":
            pos = m.end()
            continue
        env = m.group(2)
        # find the matching \end{env}
        depth, j = 1, m.end()
        begin_re = re.compile(r"\\(begin|end)\{" + re.escape(env) + r"\}")
        while depth:
            mm = begin_re.search(body, j)
            if not mm:
                break
            depth += 1 if mm.group(1) == "begin" else -1
            j = mm.end()
        content = body[m.end():(mm.start() if mm else len(body))]
        title = ""
        stripped = content.lstrip()
        if stripped.startswith("["):
            off = len(content) - len(stripped)
            title, k = balanced(content, off, "[", "]")
            content = content[k:]
        label = (re.search(r"\\label\{([^}]+)\}", content) or [None, None])[1]
        content = re.sub(r"\\label\{[^}]*\}", "", content).strip()
        # proof right after
        proof, after = "", j
        rest = body[j:]
        pm = re.match(r"\s*\\begin\{proof\}", rest)
        if pm:
            depth2, k2 = 1, j + pm.end()
            pre = re.compile(r"\\(begin|end)\{proof\}")
            while depth2:
                mm2 = pre.search(body, k2)
                if not mm2:
                    break
                depth2 += 1 if mm2.group(1) == "begin" else -1
                k2 = mm2.end()
            proof = body[j + pm.end():(mm2.start() if mm2 else len(body))]
            after = k2
        info = envs[env]
        counter = info["shared"] or env
        number = ""
        if info["numbered"]:
            counters[counter] = counters.get(counter, 0) + 1
            within = info["within"] or envs.get(counter, {}).get("within")
            prefix = (chr(64 + sec) if appendix else str(sec)) if within in ("section", "subsection") and sec else ""
            number = f"{prefix}.{counters[counter]}" if prefix else str(counters[counter])
        refs = re.findall(r"\\(?:c|C|auto|name|eq|v|V)?ref\*?\{([^}]+)\}", proof + " " + content)
        items.append({
            "key": label or f"{env}-{len(items) + 1}", "kind": kind_of(info["name"]),
            "display": f"{info['name']} {number}".strip(), "number": number,
            "name": " ".join(title.split()), "section": " ".join(secname.split()),
            "tex": content[:6000], "proof_tex": proof[:4000],
            "refs": [r.strip() for rr in refs for r in rr.split(",")],
        })
        pos = max(after, m.end())
    keys = {it["key"] for it in items}
    for it in items:
        it["uses"] = sorted({r for r in it.pop("refs") if r in keys and r != it["key"]})
    return items


PDF_ITEMS_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {"type": "object", "properties": {
        "kind": {"type": "string"}, "number": {"type": "string"}, "name": {"type": "string"},
        "statement_tex": {"type": "string"}, "uses": {"type": "array", "items": {"type": "string"}}},
        "required": ["kind", "number", "name", "statement_tex", "uses"]}}},
    "required": ["items"],
}


def extract_items_pdf(text: str) -> list[dict]:
    items = []
    for start in range(0, min(len(text), 120_000), 12_000):
        chunk = text[start:start + 13_000]
        out = safe_chat("You extract theorem-like results from mathematical papers. For each Theorem, Lemma, "
                   "Proposition, Corollary, Claim, Conjecture or Definition that STARTS in this chunk, "
                   "return its kind (lowercase), number as printed (e.g. '3.2'), optional name, the full "
                   "statement in LaTeX, and the numbers of earlier results its proof cites. Return [] if none.",
                   chunk, PDF_ITEMS_SCHEMA, max_tokens=8000)
        items += out.get("items", [])
    seen, res = set(), []
    for it in items:
        key = f"{it['kind']}-{it['number']}"
        if key in seen:
            continue
        seen.add(key)
        res.append({"key": key, "kind": kind_of(it["kind"]),
                    "display": f"{it['kind'].capitalize()} {it['number']}".strip(), "number": it["number"],
                    "name": it["name"], "section": "", "tex": it["statement_tex"], "proof_tex": "",
                    "uses_numbers": it["uses"]})
    bynum = {it["number"]: it["key"] for it in res if it["number"]}
    for it in res:
        it["uses"] = sorted({bynum[n] for n in it.pop("uses_numbers") if n in bynum and bynum[n] != it["key"]})
    return res


# ----------------------------------------------------------------------------------------------
# Lean compilation
# ----------------------------------------------------------------------------------------------

def compile_lean(code: str) -> list[tuple[int, str]]:
    """Compile with `lake env lean`; return [(line, message)] for errors."""
    with tempfile.NamedTemporaryFile("w", suffix=".lean", dir=L.BUILD, delete=False, encoding="utf-8") as f:
        f.write(code)
        path = Path(f.name)
    try:
        r = subprocess.run(["lake", "env", "lean", str(path)], cwd=L.ROOT, capture_output=True,
                           text=True, timeout=1800)
    finally:
        path.unlink(missing_ok=True)
    errs = []
    for m in re.finditer(r"^[^\n]*?\.lean:(\d+):\d+: error(?:\([^)]*\))?: (.*?)(?=^[^\n]*?\.lean:\d+:\d+: |\Z)",
                         r.stdout + r.stderr, re.S | re.M):
        errs.append((int(m.group(1)), m.group(2).strip()[:800]))
    if r.returncode != 0 and not errs:
        errs.append((0, (r.stdout + r.stderr)[-800:]))
    return errs


def unsafe(code: str) -> str | None:
    bad = L.BANNED.search(code)
    if bad:
        return f"forbidden construct `{bad.group(0)}`"
    if re.search(r"\bsorry\b|\badmit\b", code):
        return "definitions must not use sorry"
    if re.search(r"^\s*import\b", code, re.M):
        return "do not write import lines"
    return None


# ----------------------------------------------------------------------------------------------
# Qwen prompts
# ----------------------------------------------------------------------------------------------

PLAN_SYSTEM = """You are the lead of a team formalizing a research paper in Lean 4 with Mathlib. \
Many independent AI agents will later formalize and prove its results in parallel, so your job is \
to fix the shared vocabulary they must all use.

Produce:
- `conventions` (English) and `conventions_ko` (Korean): 4-10 short rules, e.g. which Mathlib types \
represent the paper's objects (SimpleGraph V with [Fintype V] [DecidableRel G.Adj], Finset (EuclideanSpace ℝ (Fin 2)), \
ℝ, ...), indexing conventions, and how asymptotic or probabilistic statements are expressed.
- `notation`: map each important paper notation to its Lean counterpart.
- `concepts`: every notion the paper's results mention that Mathlib does NOT already have and that \
must be defined once for everyone (e.g. "f(n): the minimum number of circles determined by n points, \
not all collinear or concyclic"). Give the exact mathematical meaning from the paper. Omit notions \
Mathlib has (Collinear, Concyclic, Nat.Prime, SimpleGraph.chromaticNumber, ...).
- `goal`: the key of the paper's main result. `milestones`: keys of the main results in paper order \
(theorems, key propositions/corollaries; at most 12).
- `summary_en`/`summary_ko`: one sentence each. `title_ko`: the paper title in Korean."""

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "conventions": {"type": "array", "items": {"type": "string"}},
        "conventions_ko": {"type": "array", "items": {"type": "string"}},
        "notation": {"type": "array", "items": {"type": "object", "properties": {
            "paper": {"type": "string"}, "lean": {"type": "string"}}, "required": ["paper", "lean"]}},
        "concepts": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "meaning": {"type": "string"}}, "required": ["name", "meaning"]}},
        "goal": {"type": "string"},
        "milestones": {"type": "array", "items": {"type": "string"}},
        "summary_en": {"type": "string"}, "summary_ko": {"type": "string"}, "title_ko": {"type": "string"},
    },
    "required": ["conventions", "conventions_ko", "notation", "concepts", "goal", "milestones",
                 "summary_en", "summary_ko", "title_ko"],
}

DEFS_SYSTEM = """You write the shared Lean 4 (Mathlib) definitions for a paper-formalization project. \
They live in one namespace that every statement opens, so they must be exactly right.

Return `definitions`: a list in dependency order. Each item has `name` (the Lean identifier, \
lowerCamelCase) and `lean`: the complete declaration, starting with a `/-- docstring -/` that cites the \
paper, then `def`/`noncomputable def`/`structure`/`abbrev`.
Hard rules:
- The definition must be mathematically faithful to the given meaning. NEVER write placeholders, \
dummy values (like `0`), `sorry`, `admit`, `axiom`, `import`, `namespace`, `#eval`, or commentary.
- If you cannot define a concept faithfully, leave it out entirely.
- Things the paper treats as external (whether code compiles, a human expert's verdict, a model's \
output, a checker that may time out) must NOT be defined as constants. Either give them their \
mathematical meaning (e.g. a forward check of T̂ against S is the proposition `T̂ → S`), or make \
them explicit parameters of the definitions that use them (e.g. `(compiles : Prop → Bool)`).
- Prefer Mathlib notions (Finset, Set.ncard, sInf, Collinear ℝ, EuclideanGeometry.Cospherical, \
SimpleGraph, ...). Use `noncomputable def` with `sInf`/`sSup`/`Set.ncard` for extremal quantities.
- Explicitly bind all variables (autoImplicit is off)."""

DEFS_SCHEMA = {
    "type": "object",
    "properties": {"definitions": {"type": "array", "items": {"type": "object", "properties": {
        "name": {"type": "string"}, "lean": {"type": "string"}}, "required": ["name", "lean"]}}},
    "required": ["definitions"],
}

STMT_SYSTEM = """You formalize ONE result of a research paper as a Lean 4 (Mathlib) statement, \
following the team's conventions exactly so it is compatible with everyone else's work.

Return:
- `lean`: ONLY the signature that follows the theorem name: binders, a colon, and the type, e.g. \
`(n : ℕ) (hn : 2 ≤ n) : ∃ p, Nat.Prime p ∧ n < p ∧ p < 2 * n`. No `theorem` keyword, no `:=`, no \
proof, no `sorry`. Explicitly bind every variable and instance (autoImplicit is off). Use the shared \
definitions (already opened) for the paper's own concepts and Mathlib for everything else.
- NEVER abstract a concept the paper defines (like "f(n), the minimum number of circles") as an \
arbitrary parameter `(f : ℕ → ℕ)`: that changes the meaning. If the needed concept has no shared \
definition and you cannot express it inline faithfully, set `formalizable` to false.
- Do not use `let` or `:=` anywhere in the signature; write sub-expressions inline (or rely on a \
shared definition).
- Be faithful: keep every hypothesis; do not weaken or strengthen.
- `title_en`/`title_ko`: a short descriptive title (no numbering).
- `statement_en`/`statement_ko`: the result in clean natural language with standard LaTeX in $…$ \
(expand the paper's private macros). `note`: anything a reviewer should know."""

STMT_SCHEMA = {
    "type": "object",
    "properties": {
        "title_en": {"type": "string"}, "title_ko": {"type": "string"},
        "statement_en": {"type": "string"}, "statement_ko": {"type": "string"},
        "lean": {"type": "string"}, "formalizable": {"type": "boolean"}, "note": {"type": "string"},
    },
    "required": ["title_en", "title_ko", "statement_en", "statement_ko", "lean", "formalizable", "note"],
}


def safe_chat(system: str, user: str, schema: dict, max_tokens: int, log=print, tries: int = 2) -> dict:
    """chat() that retries and returns {} instead of raising (truncated/garbled JSON)."""
    for i in range(tries):
        try:
            return chat(system, user, schema, max_tokens=max_tokens)
        except Exception as e:  # noqa: BLE001
            log(f"  model call failed ({type(e).__name__}); {'retrying' if i + 1 < tries else 'skipping'}")
    return {}


HEADER = "import Mathlib\n\nset_option autoImplicit false\n"


def defs_module(mod: str, defs: str) -> str:
    return f"{HEADER}\nnamespace {mod}\n\n{defs.strip()}\n\nend {mod}\n"


def clean_decl(code: str) -> str:
    code = re.sub(r"^\s*(import|namespace|end|open|set_option)\b.*$", "", code, flags=re.M)
    return code.strip()


def compile_spans(header: str, chunks: list[tuple[str, str]], footer: str = "") -> tuple[dict, list]:
    """Compile header + chunks; return ({key: first error}, header errors)."""
    code, spans, line = header, [], header.count("\n") + 1
    for key, text in chunks:
        block = "\n" + text.strip() + "\n"
        spans.append((line + 1, line + block.count("\n"), key))
        code += block
        line += block.count("\n")
    code += footer
    errs = compile_lean(code)
    by, head = {}, []
    for ln, msg in errs:
        for a, b, key in spans:
            if a <= ln <= b:
                by.setdefault(key, msg)
                break
        else:
            head.append(msg)
    if head:  # Lean failed outside any declaration (toolchain, header, environment): never guess
        raise RuntimeError(f"Lean failed outside the generated declarations: {head[0][:600]}")
    return by, head


PLACEHOLDER = re.compile(
    r":=\s*(?:fun\b[^=]*=>\s*)?(?:true|false|True|False|0|1|0\.0|1\.0|∅|default|\(\)|Bool\.true|Bool\.false)\s*$")

DEFAUDIT_SYSTEM = """You review shared Lean definitions written for a paper-formalization project. \
For each definition decide whether it is FAITHFUL to the intended meaning. Reject (faithful=false) any \
placeholder or stub: a constant function, a value that ignores its inputs, a definition that makes \
the concept trivially true/false, or one that silently changes the meaning. External oracles taken \
as explicit parameters are fine. Give a one-sentence reason."""

DEFAUDIT_SCHEMA = {"type": "object", "properties": {"verdicts": {"type": "array", "items": {
    "type": "object", "properties": {"name": {"type": "string"}, "faithful": {"type": "boolean"},
                                     "reason": {"type": "string"}}, "required": ["name", "faithful", "reason"]}}},
    "required": ["verdicts"]}


def placeholder_problem(code: str) -> str | None:
    body = re.sub(r"/--.*?-/", "", code, flags=re.S).strip()
    if PLACEHOLDER.search(" ".join(body.split())):
        return ("placeholder definition (its value ignores the inputs). Define it faithfully, or make the "
                "external oracle an explicit parameter of the definitions that use it.")
    return None


def audit_definitions(defs: list[dict], plan: dict, log) -> dict:
    if not defs:
        return {}
    out = safe_chat(DEFAUDIT_SYSTEM, "Intended meanings:\n" +
                    "\n".join(f"- {c['name']}: {c['meaning']}" for c in plan["concepts"]) +
                    "\n\nDefinitions:\n" + "\n\n".join(f"[{d['name']}]\n```lean\n{d['lean']}\n```" for d in defs),
                    DEFAUDIT_SCHEMA, 3000, log)
    if not out:
        return {d["name"]: "the definition audit failed" for d in defs}
    names = {d["name"] for d in defs}
    return {v["name"]: f"not faithful: {v['reason']}" for v in out["verdicts"]
            if not v["faithful"] and v["name"] in names}


def build_definitions(mod: str, plan: dict, prose: str, log) -> str:
    if not plan["concepts"]:
        log("definitions: none needed")
        return ""
    ask = ("Conventions:\n" + "\n".join(f"- {c}" for c in plan["conventions"]) +
           "\n\nConcepts to define:\n" + "\n".join(f"- {c['name']}: {c['meaning']}" for c in plan["concepts"]) +
           f"\n\nPaper text (for exact meanings):\n{prose[:12000]}")
    defs = [d for d in safe_chat(DEFS_SYSTEM, ask, DEFS_SCHEMA, 8000, log).get("definitions", [])]
    for rnd in range(ROUNDS + 1):
        chunks, problems = [], {}
        for d in defs:
            d["lean"] = clean_decl(d["lean"])
            bad = unsafe(d["lean"]) or placeholder_problem(d["lean"]) or (None if d["lean"] else "empty")
            (problems.__setitem__(d["name"], bad) if bad else chunks.append((d["name"], d["lean"])))
        errs, head = compile_spans(f"{HEADER}\nnamespace {mod}\n", chunks, f"\nend {mod}\n") if chunks else ({}, [])
        problems.update(errs)
        compiled = [d for d in defs if d["name"] not in problems]
        bad_meaning = audit_definitions(compiled, plan, log)
        if bad_meaning:
            log(f"  definition audit rejected: {', '.join(bad_meaning)}")
        problems.update(bad_meaning)
        good = [d for d in defs if d["name"] not in problems]
        log(f"definitions round {rnd}: {len(good)}/{len(defs)} compile")
        if not problems or rnd == ROUNDS:
            defs = good
            break
        # later definitions may fail only because an earlier one did; resend all failing ones
        fix = safe_chat(DEFS_SYSTEM + "\n\nSome definitions failed to compile. Return corrected versions of "
                        "ONLY the failing definitions (same names). Leave out any you cannot fix faithfully.",
                        ask + "\n\nDefinitions that compile:\n```lean\n" + "\n\n".join(d["lean"] for d in good) +
                        "\n```\n\nFailing definitions and errors:\n" +
                        "\n\n".join(f"```lean\n{d['lean']}\n```\nerror: {problems[d['name']]}" for d in defs
                                    if d["name"] in problems), DEFS_SCHEMA, 8000, log).get("definitions", [])
        fixed = {d["name"]: d for d in fix}
        defs = [fixed.get(d["name"], d) if d["name"] in problems else d for d in defs]
        defs = [d for d in defs if d["name"] not in problems or d["name"] in fixed]
    # final check of the whole module (dropping definitions can break later ones)
    while defs:
        errs, head = compile_spans(f"{HEADER}\nnamespace {mod}\n", [(d["name"], d["lean"]) for d in defs], f"\nend {mod}\n")
        if not errs and not head:
            break
        defs = [d for d in defs if d["name"] not in errs] if errs else []
    log(f"definitions: {len(defs)} kept: {', '.join(d['name'] for d in defs) or '—'}")
    return "\n\n".join(d["lean"] for d in defs)


def statement_problem(sig: str) -> str | None:
    if not sig.strip():
        return "empty statement"
    if "sorry" in sig or ":=" in sig:
        return "the statement must be only the signature: no `:=`, no `let`, no proof, no sorry"
    if L.STMT_COMMAND.search(sig) or L.BANNED.search(sig):
        return "the statement must be a single signature, not Lean commands"
    if ":" not in sig:
        return "missing `:` before the type"
    return None


def formalize_items(items: list[dict], mod: str, defs: str, plan: dict, macros: str, log) -> None:
    targets = [it for it in items if it["kind"] in FORMAL_KINDS][:MAX_ITEMS]
    for it in items:
        if it["kind"] in FORMAL_KINDS and it not in targets:
            it["note"] = f"skipped: only the first {MAX_ITEMS} results are formalized automatically"
    context = ("Conventions:\n" + "\n".join(f"- {c}" for c in plan["conventions"]) +
               "\n\nNotation:\n" + "\n".join(f"- {n['paper']} ↦ {n['lean']}" for n in plan["notation"]) +
               (f"\n\nShared definitions (namespace {mod}, already opened):\n```lean\n{defs}\n```" if defs else
                "\n\nThere are no shared definitions; use Mathlib only.") +
               (f"\n\nThe paper's LaTeX macros:\n{macros[:3000]}" if macros else ""))
    bykey = {it["key"]: it for it in items}

    def ask(it: dict, feedback: str = "") -> None:
        cited = "\n".join(f"- {bykey[u]['display']}: {bykey[u]['tex'][:500]}" for u in it["uses"] if u in bykey)
        user = (f"{context}\n\nResult to formalize — {it['display']}"
                f"{' (' + it['name'] + ')' if it['name'] else ''}, section “{it['section']}”:\n{it['tex']}"
                + (f"\n\nResults its proof cites:\n{cited}" if cited else "")
                + (f"\n\nYour previous attempt `{it.get('lean', '')}` was rejected:\n{feedback}\nFix it." if feedback else ""))
        out = safe_chat(STMT_SYSTEM, user, STMT_SCHEMA, 2500)
        if not out:
            it["note"] = "model error"
            return
        it.update({"title_en": out["title_en"], "title_ko": out["title_ko"],
                   "statement_en": out["statement_en"], "statement_ko": out["statement_ko"],
                   "lean": " ".join(out["lean"].split()), "note": out["note"],
                   "formalizable": out["formalizable"]})

    header = (defs_module(mod, defs) + f"\nopen {mod}\n") if defs else HEADER
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(ask, targets))
    feedback: dict = {}
    for rnd in range(ROUNDS + 1):
        pending = [it for it in targets if it.get("formalizable") and it.get("lean")]
        feedback = {it["key"]: p for it in pending if (p := statement_problem(it["lean"]))}
        ok = [it for it in pending if it["key"] not in feedback]
        if ok:
            errs, _ = compile_spans(header, [(it["key"], f"axiom bp_{i} {it['lean']}") for i, it in enumerate(ok)])
            feedback.update(errs)
        # faithfulness gate on what compiles: blind read-back, then audit against the paper's text
        compiled = [it for it in pending if it["key"] not in feedback]
        with cf.ThreadPoolExecutor(8) as ex:
            verdicts = list(ex.map(lambda it: audit(it, defs), compiled))
        for it, (verdict, note) in zip(compiled, verdicts):
            it["audit"] = {"verdict": verdict, "note": note}
            if verdict == "mismatch":
                feedback[it["key"]] = f"It compiles, but it does not say what the paper says: {note}"
        log(f"statements round {rnd}: {len(pending) - len(feedback)}/{len(pending)} compile and pass the audit")
        if not feedback or rnd == ROUNDS:
            break
        with cf.ThreadPoolExecutor(8) as ex:
            list(ex.map(lambda it: ask(it, feedback[it["key"]]), [it for it in pending if it["key"] in feedback]))
    for it in targets:
        it["compiled"] = bool(it.get("formalizable") and it.get("lean") and it["key"] not in feedback)
        if it["key"] in feedback:
            it["note"] = ((it.get("note") or "") + f" Rejected: {feedback[it['key']][:300]}").strip()
        elif not it.get("formalizable") and it.get("lean") is not None:
            it["note"] = ("Not formalizable yet. " + (it.get("note") or "")).strip()


def audit(it: dict, defs: str) -> tuple[str, str]:
    from informalize import AUDIT_SCHEMA, AUDIT_SYSTEM, READBACK_SCHEMA, READBACK_SYSTEM
    user = f"Lean 4 (Mathlib) statement:\n```lean\ntheorem X {it['lean']}\n```"
    if defs:
        user += f"\n\nDefinitions it uses (opened):\n```lean\n{defs}\n```"
    rb = safe_chat(READBACK_SYSTEM, user, READBACK_SCHEMA, 1500)
    if not rb:
        return "mismatch", "could not read the statement back"
    it["readback"] = rb
    au = safe_chat(AUDIT_SYSTEM, f"{user}\n\nFaithful reading: {rb['en']}\n\nHuman description "
                   f"({it['display']} of the paper, LaTeX):\n{it['tex']}", AUDIT_SCHEMA, 1200)
    if not au:
        return "mismatch", "audit failed"
    return au["verdict"], au.get("note_en", "")


PROPS_SYSTEM = """This paper defines mathematical concepts but states no theorems. The team will \
formalize its definitions in Lean and prove properties of them, so that the definitions are \
checked and usable. Propose 3-8 precise mathematical properties of the definitions that:
- follow from the definitions (the paper relies on them, implies them, or they are basic sanity \
checks: soundness/completeness, monotonicity, edge cases, relationships between the defined notions);
- are TRUE and provable from the definitions alone (no empirical or experimental claims, no claims \
about specific models, datasets or numbers measured in experiments);
- are stated in terms of the given Lean definitions.
For each give `title_en`/`title_ko` (short), `statement_en`/`statement_ko` (precise, LaTeX in $…$), \
and `basis`: which definitions and which passage of the paper it comes from. Put the most important \
property first."""

PROPS_SCHEMA = {
    "type": "object",
    "properties": {"properties": {"type": "array", "items": {"type": "object", "properties": {
        "title_en": {"type": "string"}, "title_ko": {"type": "string"},
        "statement_en": {"type": "string"}, "statement_ko": {"type": "string"},
        "basis": {"type": "string"}},
        "required": ["title_en", "title_ko", "statement_en", "statement_ko", "basis"]}}},
    "required": ["properties"],
}


def derive_properties(meta: dict, items: list[dict], plan: dict, defs: str, prose: str, log) -> list[dict]:
    paper_defs = "\n\n".join(f"{it['display']}: {it['tex'][:1500]}" for it in items if it["kind"] == "definition")
    out = safe_chat(PROPS_SYSTEM, f"Paper: {meta['title']}\nAbstract: {meta['abstract']}\n\n"
                    f"The paper's definitions:\n{paper_defs}\n\nShared Lean definitions:\n```lean\n{defs}\n```\n\n"
                    f"Paper text:\n{prose[:8000]}", PROPS_SCHEMA, 6000, log).get("properties", [])[:8]
    log(f"  no stated theorems: derived {len(out)} properties of the definitions")
    return [{"key": f"property-{i + 1}", "kind": "property", "display": f"Property {i + 1}",
             "number": str(i + 1), "name": "", "section": "Derived from the definitions",
             "tex": f"{p['statement_en']}\n\n(Basis: {p['basis']})", "proof_tex": "", "uses": [],
             "derived": True, "basis": p["basis"], "title_en": p["title_en"], "title_ko": p["title_ko"]}
            for i, p in enumerate(out)]


def paper_prose(tex: str) -> str:
    body = tex.split("\\begin{document}", 1)[-1]
    body = re.sub(r"\\begin\{(figure|table|tikzpicture)\*?\}.*?\\end\{\1\*?\}", "", body, flags=re.S)
    return re.sub(r"\n\s*\n+", "\n\n", body)


# ----------------------------------------------------------------------------------------------
# Output
# ----------------------------------------------------------------------------------------------

def next_ids(n: int) -> list[str]:
    used = [int(p.stem[1:]) for p in L.THEOREMS.glob("T*.yaml") if p.stem[1:].isdigit()]
    start = max(used, default=0) + 1
    return [f"T{start + i:04d}" for i in range(n)]


def dump_yaml(path: Path, data: dict) -> None:
    import yaml

    class Dumper(yaml.SafeDumper):
        pass

    def str_rep(d, s):
        return d.represent_scalar("tag:yaml.org,2002:str", s, style="|" if "\n" in s else None)
    Dumper.add_representer(str, str_rep)
    path.write_text(yaml.dump(data, Dumper=Dumper, allow_unicode=True, sort_keys=False, width=100),
                    encoding="utf-8")


def write_outputs(meta: dict, items: list[dict], plan: dict, defs: str, macros_katex: dict,
                  source_kind: str, captain: str, issue: int | None) -> dict:
    aid, sl, mod = meta["arxiv"], slug(meta["arxiv"]), module_name(meta["arxiv"])
    tags = [CATEGORY_TAGS[c] for c in meta["categories"] if c in CATEGORY_TAGS][:3] or ["Mathematics"]
    good = [it for it in items if it.get("compiled")]
    ids = next_ids(len(good))
    for it, tid in zip(good, ids):
        it["theorem"] = tid
    preamble = "import Mathlib" + (f"\nimport Lean4All.Definitions.{mod}\nopen {mod}" if defs else "")
    if defs and any(it["kind"] in FORMAL_KINDS for it in items):
        (L.DEFINITIONS / f"{mod}.lean").write_text(defs_module(mod, defs), encoding="utf-8")
    for it in good:
        cite = f"{it['display']}{' (' + it['name'] + ')' if it['name'] else ''} in arXiv:{aid}"
        if it.get("derived"):
            note_en = (f"*Derived from the definitions of arXiv:{aid}; not a theorem stated in the paper "
                       f"(basis: {it['basis']}). Machine-formalized; see the mission blueprint.*")
            note_ko = (f"*arXiv:{aid}의 정의에서 유도한 성질이며, 논문에 명시된 정리가 아닙니다. "
                       "기계가 형식화한 명제이며, 미션 블루프린트를 참고하세요.*")
        else:
            note_en = f"*{cite}. Machine-formalized; see the mission blueprint.*"
            note_ko = f"*arXiv:{aid}의 {it['display']}. 기계가 형식화한 명제이며, 미션 블루프린트를 참고하세요.*"
        dump_yaml(L.THEOREMS / f"{it['theorem']}.yaml", {
            "id": it["theorem"], "title": it["title_en"], "title_ko": it["title_ko"],
            "description": f"{it['statement_en']}\n\n{note_en}",
            "description_ko": f"{it['statement_ko']}\n\n{note_ko}",
            "preamble": preamble, "statement": it["lean"], "tags": tags,
            "source": f"arXiv:{aid}, {'derived from the definitions' if it.get('derived') else it['display']}",
            "mission": sl, "proposer": captain,
        })
    bykey = {it["key"]: it for it in items}
    goal_key = plan["goal"] if plan["goal"] in bykey and bykey[plan["goal"]].get("theorem") else None
    ms_keys = [k for k in plan["milestones"] if k in bykey] or \
        [it["key"] for it in items if it["kind"] in MILESTONE_KINDS][:12]
    if not goal_key:
        goal_key = next((k for k in reversed(ms_keys) if bykey[k].get("theorem")), None) or \
            (good[-1]["key"] if good else None)
    if goal_key and goal_key not in ms_keys:
        ms_keys.append(goal_key)
    derived_only = bool(items) and all(it.get("derived") for it in items if it["kind"] in FORMAL_KINDS) and \
        any(it["kind"] in FORMAL_KINDS for it in items)
    authors = ", ".join(meta["authors"][:4]) + (" et al." if len(meta["authors"]) > 4 else "")
    mission = {
        "id": sl, "title": meta["title"], "title_ko": plan.get("title_ko") or meta["title"],
        "type": "Research Paper", "tags": tags, "captain": captain, "reviewed": False,
        "summary": plan["summary_en"], "summary_ko": plan["summary_ko"],
        "description": (f"{meta['abstract']}\n\n" + ("**This paper states no theorems.** This mission formalizes its "
                        "definitions and proves properties derived from them; those properties are not claims "
                        "made in the paper.\n\n" if derived_only else "") + "**Machine-generated blueprint.** The formal statements were "
                        "written by Qwen and compile against Mathlib, but a moderator has not checked them "
                        "against the paper yet. Read the blueprint before contributing."),
        "description_ko": (("**이 논문에는 정리가 없습니다.** 이 미션은 논문의 정의를 형식화하고, 그 정의에서 유도한 성질을 "
                            "증명합니다. 이 성질들은 논문이 주장한 내용이 아닙니다.\n\n" if derived_only else "") +
                           "**기계가 생성한 블루프린트입니다.** 형식 명제는 Qwen이 작성했고 Mathlib에서 컴파일되지만, "
                           "아직 운영자가 논문과 대조하지 않았습니다. 기여하기 전에 블루프린트를 먼저 읽으세요.\n\n"
                           f"{plan['summary_ko']}"),
        "source": {"title": f"{authors}, {meta['title']} (arXiv:{aid})", "url": meta["url"]},
        "goal": bykey[goal_key]["theorem"] if goal_key else None,
        "blueprint": sl,
        "milestones": [{k2: v for k2, v in {
            "title": f"{bykey[k]['display']}: {bykey[k].get('title_en') or bykey[k]['name'] or ''}".rstrip(": "),
            "title_ko": f"{bykey[k]['display']}: {bykey[k].get('title_ko') or ''}".rstrip(": "),
            "statement": bykey[k].get("statement_en") or "", "statement_ko": bykey[k].get("statement_ko") or "",
            "theorem": bykey[k].get("theorem")}.items() if v} for k in ms_keys],
    }
    if not mission["goal"]:
        mission.pop("goal")  # nothing formalized yet: the blueprint still coordinates the work
    has_results = any(it["kind"] in FORMAL_KINDS for it in items)
    if has_results:
        dump_yaml(L.MISSIONS / f"{sl}.yaml", mission)

    bp = {
        "id": sl, "arxiv": aid, "title": meta["title"], "title_ko": plan.get("title_ko"),
        "authors": meta["authors"], "abstract": meta["abstract"], "categories": meta["categories"],
        "url": meta["url"], "published": meta["published"], "mission": sl if has_results else None,
        "status": ("derived" if derived_only else "active") if has_results else "no-results",
        "module": mod if defs and has_results else None,
        "preamble": preamble, "source_kind": source_kind, "model": MODEL, "issue": issue,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "conventions": plan["conventions"], "conventions_ko": plan["conventions_ko"],
        "notation": plan["notation"], "definitions": defs_module(mod, defs) if defs else "",
        "macros": macros_katex, "goal": goal_key, "milestones": ms_keys,
        "items": [{k: it.get(k) for k in ("key", "kind", "display", "number", "name", "section", "tex", "derived", "basis",
                                          "uses", "title_en", "title_ko", "statement_en", "statement_ko",
                                          "lean", "theorem", "note")} for it in items],
    }
    out = BLUEPRINTS / sl
    out.mkdir(parents=True, exist_ok=True)
    (out / "blueprint.json").write_text(json.dumps(bp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "BLUEPRINT.md").write_text(blueprint_md(bp), encoding="utf-8")
    return bp


def blueprint_md(bp: dict) -> str:
    items = bp["items"]
    bykey = {it["key"]: it for it in items}
    lines = [f"# Blueprint: {bp['title']}", "",
             f"arXiv:{bp['arxiv']} · {', '.join(bp['authors'])} · mission `{bp['mission']}`", "",
             "> **Agents: read this before working on any theorem in this mission.** Everyone formalizing",
             "> this paper must follow the same conventions and definitions, so their proofs fit together.", "",
             *([("> **This paper states no theorems.** The results below are properties derived from its "
                 "definitions so they can be formalized and checked; they are not claims made in the paper."), ""]
               if bp.get("status") == "derived" else []),
             "## Rules for this mission", "",
             "1. Use the shared definitions" + (f": `import Lean4All.Definitions.{bp['module']}` and `open {bp['module']}`."
                                                 if bp["module"] else " in Mathlib only; there is no shared module yet."),
             "   Never redefine a paper concept locally. If you need a new definition, propose it in a separate PR to",
             f"   `definitions/{bp['module'] or '<Module>'}.lean` (reviewed by a maintainer).",
             "2. To prove a result, import the statements of the results the paper's proof cites (listed under",
             "   *Uses* below) instead of re-proving them: `import Lean4All.Statements.T…`. Your proof becomes a",
             "   sketch that completes when those are proved.",
             "3. Helper lemmas that are not in the paper: add them as new theorem cards with `mission:",
             f"   {bp['mission']}` and a description saying which step of which proof they serve.",
             "4. If a statement below is wrong (mis-formalized), do not prove a weaker version: refute it with",
             "   `theorem disproof` or open an issue so a moderator can add a corrected statement.", "",
             "## Conventions", ""] + [f"- {c}" for c in bp["conventions"]] + ["", "## Notation", ""] + \
        [f"- {n['paper']} ↦ `{n['lean']}`" for n in bp["notation"]] + [""]
    if bp["definitions"]:
        lines += ["## Shared definitions", "", "```lean", bp["definitions"].strip(), "```", ""]
    lines += ["## Results", "", "| Paper | Theorem | Uses | Lean statement |", "|---|---|---|---|"]
    for it in items:
        if it["kind"] not in FORMAL_KINDS:
            continue
        uses = ", ".join(f"{bykey[u]['display']}" + (f" ({bykey[u]['theorem']})" if bykey[u].get("theorem") else "")
                         for u in it["uses"] if u in bykey) or "—"
        lean = f"`{it['lean']}`" if it.get("theorem") else f"*not formalized: {(it.get('note') or '').strip()[:120]}*"
        lines.append(f"| {it['display']} {('(' + it['name'] + ')') if it['name'] else ''} | "
                     f"{it.get('theorem') or '—'} | {uses} | {lean.replace('|', '∣')} |")
    lines += ["", f"Generated {bp['generated']} by `scripts/arxiv_blueprint.py` with {bp['model']}.", ""]
    return "\n".join(lines)


# ----------------------------------------------------------------------------------------------

def run(aid: str, captain: str, issue: int | None = None, log=print) -> dict:
    aid = parse_id(aid)
    sl = slug(aid)
    if (BLUEPRINTS / sl / "blueprint.json").exists():
        raise RuntimeError(f"a blueprint for arXiv:{aid} already exists")
    log(f"arXiv:{aid}: fetching metadata")
    meta = fetch_meta(aid)
    log(f"  {meta['title']}")
    L.BUILD.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        kind, text = download_source(aid, Path(tmp))
    log(f"  source: {kind}, {len(text):,} chars")
    if kind == "latex":
        items = extract_items(text)
        macros, macros_katex = parse_macros(text)
    else:
        items, macros, macros_katex = extract_items_pdf(text), "", {}
    log(f"  extracted {len(items)} items ({sum(it['kind'] in FORMAL_KINDS for it in items)} results)")
    if not items:
        raise RuntimeError("no theorem-like statements found")
    defs_tex = "\n\n".join(f"{it['display']}{' (' + it['name'] + ')' if it['name'] else ''} [{it['key']}]: {it['tex'][:1500]}"
                           for it in items if it["kind"] == "definition")[:20000]
    results = "\n".join(f"- [{it['key']}] {it['display']}{' (' + it['name'] + ')' if it['name'] else ''}: {it['tex'][:300]}"
                        for it in items if it["kind"] in FORMAL_KINDS)[:20000]
    mod = module_name(aid)
    prose = paper_prose(text) if kind == "latex" else text
    plan = safe_chat(PLAN_SYSTEM,
                     f"Paper: {meta['title']}\nAbstract: {meta['abstract']}\n\nLaTeX macros:\n{macros[:3000]}\n\n"
                     f"Definitions in the paper:\n{defs_tex or '(none extracted)'}\n\nResults (keys in brackets):\n{results}"
                     f"\n\nPaper text (beginning):\n{prose[:10000]}",
                     PLAN_SCHEMA, 6000, log, tries=3)
    if not plan:
        raise RuntimeError("the model could not produce a plan")
    has_results = any(it["kind"] in FORMAL_KINDS for it in items)
    has_defs = any(it["kind"] == "definition" for it in items)
    if not has_results and not has_defs:
        log("  no theorem-like results and no definitions: publishing a blueprint without a mission")
        plan["concepts"] = []
    defs = build_definitions(mod, plan, prose, log)
    if not has_results and defs:
        props = derive_properties(meta, items, plan, defs, prose, log)
        items += props
        plan["milestones"] = [p["key"] for p in props]
        plan["goal"] = props[0]["key"] if props else ""
    formalize_items(items, mod, defs, plan, macros, log)
    bp = publish(meta, items, plan, defs, macros_katex, kind, captain, issue, log)
    return bp


def publish(meta, items, plan, defs, macros_katex, kind, captain, issue, log) -> dict:
    """Write files, then build them exactly as CI will; remove everything if anything fails."""
    sl, mod = slug(meta["arxiv"]), module_name(meta["arxiv"])
    before = {p.name for p in L.THEOREMS.glob("*.yaml")}
    try:
        bp = write_outputs(meta, items, plan, defs, macros_katex, kind, captain, issue)
        new = sorted(p.stem for p in L.THEOREMS.glob("*.yaml") if p.name not in before)
        g = L.gen()
        bad = {t: e for t, e in g["card_errors"].items() if t in new and e}
        mods = ([f"Lean4All.Definitions.{mod}"] if (L.DEFINITIONS / f"{mod}.lean").exists() else []) + \
            [f"Lean4All.Statements.{t}" for t in new]
        failed = L.build_modules(mods) if not bad else {}
        if bad or failed:
            raise RuntimeError(f"generated files do not build: {bad or list(failed)}")
        log(f"  verified: {len(new)} statement module(s) build; wrote blueprints/{sl}/"
            + (f" and missions/{sl}.yaml" if (L.MISSIONS / f"{sl}.yaml").exists() else " (no mission: nothing to formalize)"))
        return bp
    except Exception:
        for p in L.THEOREMS.glob("*.yaml"):
            if p.name not in before:
                p.unlink()
        (L.MISSIONS / f"{sl}.yaml").unlink(missing_ok=True)
        (L.DEFINITIONS / f"{mod}.lean").unlink(missing_ok=True)
        shutil.rmtree(BLUEPRINTS / sl, ignore_errors=True)
        raise


def from_issues(repo: str, log=print) -> list[tuple[int, dict]]:
    """Process open GitHub issues titled '[arXiv] …'. Returns [(issue number, blueprint)]."""
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    with urllib.request.urlopen(urllib.request.Request(
            f"https://api.github.com/repos/{repo}/issues?state=open&per_page=50", headers=UA), timeout=60) as r:
        issues = json.load(r)
    done = []
    for iss in issues:
        if "pull_request" in iss or not iss["title"].lower().startswith("[arxiv]"):
            continue
        num = iss["number"]
        tries = state.get(str(num), 0)
        if tries >= 2:
            continue
        m = re.search(r"### arXiv[^\n]*\n+\s*(\S+)", iss.get("body") or "")
        raw = m.group(1) if m else iss["title"][7:]
        try:
            aid = parse_id(raw)
        except ValueError:
            state[str(num)] = 99
            continue
        if (BLUEPRINTS / slug(aid) / "blueprint.json").exists():
            continue
        state[str(num)] = tries + 1
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(state))
        try:
            bp = run(aid, iss["user"]["login"], num, log)
            done.append((num, bp))
        except Exception as e:  # noqa: BLE001
            log(f"issue #{num} (arXiv:{aid}) failed: {e}")
            for p in [L.MISSIONS / f"{slug(aid)}.yaml"]:
                p.unlink(missing_ok=True)
    return done


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("arxiv", nargs="?", help="arXiv id or URL")
    ap.add_argument("--captain", default=os.environ.get("LEAN4ALL_CAPTAIN", "dichro67s"))
    ap.add_argument("--from-issues", action="store_true")
    ap.add_argument("--repo", default="dichro67s/lean4all")
    a = ap.parse_args()
    if a.from_issues:
        done = from_issues(a.repo)
        if done:
            msg = "Blueprints: " + ", ".join(f"arXiv:{bp['arxiv']}" for _, bp in done)
            body = "\n".join(f"{bp['title']} (closes #{n})" for n, bp in done)
            (L.BUILD / "commit-message.txt").write_text(f"{msg}\n\n{body}\n")
        return 0
    if not a.arxiv:
        ap.error("give an arXiv id or --from-issues")
    run(a.arxiv, a.captain)
    return 0


if __name__ == "__main__":
    sys.exit(main())
