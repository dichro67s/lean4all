#!/usr/bin/env python3
"""Turn mission proposals (GitHub issues titled "[Mission] …") into missions and theorem cards.

Proposals come from the site's "Launch a mission" page (signed-in visitors) or from the issue form
.github/ISSUE_TEMPLATE/propose-mission.yml. For each new proposal this script:
  1. reads the issue form fields; the issue author becomes captain and proposer,
  2. checks the mission id, the fields, and the goal statement against the theorem-card rules,
  3. compiles the statement against Mathlib,
  4. writes missions/<id>.yaml (reviewed: false) and theorems/T####.yaml.
scripts/informal-bot.sh commits the result with "closes #N", which closes the issue.
A proposal is tried at most twice. If LEAN4ALL_BOT_TOKEN is set, failures are explained in a
comment on the issue.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lean4all as L  # noqa: E402

REPO = os.environ.get("LEAN4ALL_REPO", "dichro67s/lean4all")
STATE = Path(os.environ.get("LEAN4ALL_MISSION_STATE", Path.home() / ".local/state/lean4all-missions.json"))
TOKEN = os.environ.get("LEAN4ALL_BOT_TOKEN", "")
UA = {"User-Agent": "lean4all-missions/1.0 (https://github.com/dichro67s/lean4all)",
      "Accept": "application/vnd.github+json"}
TYPES = ["Research Paper", "Textbook", "Open Problem", "Classic"]
MAX_PER_RUN = 3
LIMITS = {"title": 200, "summary": 400, "tags": 200, "source title": 300, "source url": 500,
          "goal description": 4000, "goal statement (lean)": 3000}


def api(path: str, data: dict | None = None) -> dict | list:
    headers = dict(UA)
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    req = urllib.request.Request(f"https://api.github.com{path}", headers=headers,
                                 data=json.dumps(data).encode() if data is not None else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def fields(body: str) -> dict[str, str]:
    """Issue form body ("### Label\n\nvalue" sections) -> {lowercase label: value}."""
    out = {}
    for m in re.finditer(r"^### (.+?)\s*\n(.*?)(?=^### |\Z)", body or "", re.S | re.M):
        v = m.group(2).strip()
        if v == "_No response_":
            v = ""
        v = re.sub(r"^```[a-zA-Z]*\n(.*?)\n?```$", r"\1", v, flags=re.S).strip()
        out[m.group(1).strip().lower()] = v
    return out


def compile_statement(card: dict) -> str | None:
    """Compile the statement as a theorem with `sorry`. Returns an error message or None."""
    L.BUILD.mkdir(parents=True, exist_ok=True)
    code = f"{L.preamble_of(card)}\n\n{L.lean_signature(card, 'l4a_proposal_check')} := by\n  sorry\n"
    with tempfile.NamedTemporaryFile("w", suffix=".lean", dir=L.BUILD, delete=False, encoding="utf-8") as f:
        f.write(code)
        path = Path(f.name)
    try:
        r = subprocess.run(["lake", "env", "lean", str(path)], cwd=L.ROOT, capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        return "Lean took longer than 15 minutes on this statement."
    finally:
        path.unlink(missing_ok=True)
    out = (r.stdout + r.stderr).replace(str(path), "statement.lean")
    if r.returncode != 0 or re.search(r": error", out):
        return out.strip()[-1500:] or f"lean exited with {r.returncode}"
    return None


def next_theorem_id() -> str:
    nums = [int(p.stem[1:]) for p in L.THEOREMS.glob("T*.yaml") if L.ID_RE.match(p.stem)]
    return f"T{max(nums, default=0) + 1:04d}"


def build(iss: dict) -> tuple[str, str]:
    """Write the mission and theorem files for one proposal. Returns (mission id, theorem id)."""
    f = fields(iss.get("body") or "")
    for k, n in LIMITS.items():
        if len(f.get(k, "")) > n:
            raise ValueError(f"`{k}` is longer than {n} characters.")
    mid = f.get("mission id", "").strip()
    login = iss["user"]["login"]
    if not L.MISSION_RE.match(mid) or len(mid) > 80:
        raise ValueError("The mission ID must use lowercase letters, digits and dashes.")
    if (L.MISSIONS / f"{mid}.yaml").exists():
        raise ValueError(f"A mission called `{mid}` already exists. Please file a new proposal with another ID.")
    mtype = f.get("type") if f.get("type") in TYPES else "Research Paper"
    title, stmt = f.get("title", ""), f.get("goal statement (lean)", "")
    if not title or not stmt:
        raise ValueError("A title and a goal statement are required.")
    tags = [t.strip() for t in f.get("tags", "").split(",") if t.strip()][:8] or ["Mathematics"]
    desc = f.get("goal description") or title
    tid = next_theorem_id()
    card = {"id": tid, "title": title, "description": desc, "statement": stmt, "tags": tags,
            "source": f.get("source title", ""), "mission": mid, "proposer": login}
    errs = L.validate_card(tid, card)
    if errs:
        raise ValueError("The goal statement does not follow the theorem-card rules:\n- " + "\n- ".join(errs))
    err = compile_statement(card)
    if err:
        raise ValueError(f"The goal statement does not compile against Mathlib:\n\n```\n{err}\n```")
    summary = f.get("summary") or title
    mission = {
        "id": mid, "title": title, "type": mtype, "tags": tags, "captain": login, "reviewed": False,
        "summary": summary,
        "description": f"{summary}\n\n*Proposed by @{login} from the Lean4All site (issue #{iss['number']}). "
                       "A moderator has not compared the statement with the source yet.*",
        "source": {"title": f.get("source title", ""), "url": f.get("source url", "")},
        "goal": tid,
        "milestones": [{"title": title, "statement": desc, "theorem": tid}],
    }
    dump = lambda d: yaml.safe_dump(d, sort_keys=False, allow_unicode=True, width=100)  # noqa: E731
    (L.THEOREMS / f"{tid}.yaml").write_text(dump(card), encoding="utf-8")
    (L.MISSIONS / f"{mid}.yaml").write_text(dump(mission), encoding="utf-8")
    _, merrs = L.load_missions()
    if merrs.get(mid):
        (L.THEOREMS / f"{tid}.yaml").unlink()
        (L.MISSIONS / f"{mid}.yaml").unlink()
        raise ValueError("The mission file is invalid:\n- " + "\n- ".join(merrs[mid]))
    return mid, tid


def comment(num: int, text: str) -> None:
    if not TOKEN:
        return
    try:
        api(f"/repos/{REPO}/issues/{num}/comments", {"body": text})
    except Exception as e:  # noqa: BLE001
        print(f"could not comment on #{num}: {e}")


def main() -> int:
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    issues = api(f"/repos/{REPO}/issues?state=open&per_page=50")
    done, lines = [], []
    for iss in issues:
        if "pull_request" in iss or not iss["title"].lower().startswith("[mission]"):
            continue
        num = iss["number"]
        tries = state.get(str(num), 0)
        if tries >= 2 or len(done) >= MAX_PER_RUN:
            continue
        state[str(num)] = tries + 1
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(state))
        try:
            mid, tid = build(iss)
        except ValueError as e:
            state[str(num)] = 99   # the proposal itself is wrong; don't retry
            STATE.write_text(json.dumps(state))
            print(f"issue #{num} rejected: {str(e).splitlines()[0]}")
            comment(num, f"Lean4All could not publish this proposal.\n\n{e}\n\n"
                         "You can file a corrected proposal from the site or with the issue form.")
            continue
        except Exception as e:  # noqa: BLE001
            print(f"issue #{num} failed: {e}")
            continue
        print(f"issue #{num}: mission {mid}, goal {tid}")
        done.append(num)
        uid = iss["user"].get("id")
        lines.append((mid, tid, num, iss["user"]["login"], uid))
    if lines:
        msg = "Mission proposals: " + ", ".join(m for m, *_ in lines)
        body = "\n".join(f"{m} (goal {t}), proposed by @{u} (closes #{n})" for m, t, n, u, _ in lines)
        trailers = "\n".join(sorted({f"Co-authored-by: {u} <{i}+{u}@users.noreply.github.com>" for *_, u, i in lines}))
        (L.BUILD / "mission-commit-message.txt").write_text(f"{msg}\n\n{body}\n\n{trailers}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
