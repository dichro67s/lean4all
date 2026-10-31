#!/usr/bin/env python3
"""Lean4All platform tooling.

  gen       write Lean modules from theorem cards and solution files
  check     build everything with Lake, verify every proof, write build/status.json
  policy    check a pull request against the contribution rules (immutability, authorship)
  verify    policy + check, failing on any problem in the files the PR touches
  site      build the static website into _site/
  template  print a solution template for a theorem
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
THEOREMS = ROOT / "theorems"
SOLUTIONS = ROOT / "solutions"
MISSIONS = ROOT / "missions"
DEFINITIONS = ROOT / "definitions"
GEN = ROOT / "Lean4All"
BUILD = ROOT / "build"
SITE_SRC = ROOT / "site"
SITE_OUT = ROOT / "_site"

ID_RE = re.compile(r"^T\d{4,}$")
DEF_RE = re.compile(r"^[A-Z][A-Za-z0-9]*$")
MISSION_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
LIB_IMPORT = re.compile(r"^(Mathlib|Batteries|Aesop|Std|Plausible)(\.[A-Za-z0-9_]+)*$")
STMT_IMPORT = re.compile(r"^Lean4All\.Statements\.(T\d{4,})$")
DEF_IMPORT = re.compile(r"^Lean4All\.Definitions\.([A-Z][A-Za-z0-9]*)$")

# Commands that run arbitrary code at build time or bypass the kernel. Proofs never need them.
BANNED = re.compile(
    r"#eval|#exit|\brun_cmd\b|\brun_elab\b|\brun_meta\b|\brun_tac\b|\binitialize\b|"
    r"\bbuiltin_initialize\b|\bunsafe\b|\bimplemented_by\b|@\[extern|\belab\b|\belab_rules\b|"
    r"\bsimproc\b|\bdsimproc\b|\baxiom\b|native_decide|ofReduceBool|_root_|\bdebug\.skipKernelTC\b"
)
# A statement is a single signature: binders, a colon, and a type.
STMT_COMMAND = re.compile(
    r"(^|\n)\s*(axiom|theorem|lemma|def|abbrev|instance|example|structure|class|inductive|"
    r"namespace|section|end|open|attribute|macro|syntax|notation|infix|infixl|infixr|prefix|postfix|"
    r"set_option|variable|universe|noncomputable|private|protected|@\[)\b"
)
STD_AXIOMS = ["propext", "Classical.choice", "Quot.sound"]
CARD_FIELDS = {"id", "title", "title_ko", "description", "description_ko", "preamble", "statement", "tags", "source", "mission",
               "proposer", "created"}
FORMAL_FIELDS = ("id", "preamble", "statement")


# ----------------------------------------------------------------------------------------------
# Loading
# ----------------------------------------------------------------------------------------------

def load_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path.name}: expected a mapping")
    return data


def split_header(src: str) -> tuple[list[str], str]:
    """Split Lean source into (imports, body). Comments may appear before and between imports."""
    pos, last, imports, n = 0, 0, [], len(src)
    while pos < n:
        if src[pos].isspace():
            pos += 1
        elif src.startswith("--", pos):
            nl = src.find("\n", pos)
            pos = n if nl == -1 else nl
        elif src.startswith("/-", pos):
            depth, pos = 1, pos + 2
            while pos < n and depth:
                if src.startswith("/-", pos):
                    depth, pos = depth + 1, pos + 2
                elif src.startswith("-/", pos):
                    depth, pos = depth - 1, pos + 2
                else:
                    pos += 1
        else:
            m = re.match(r"import\s+([A-Za-z0-9_.]+)", src[pos:])
            if not m:
                break
            imports.append(m.group(1))
            pos += m.end()
            last = pos
    return imports, src[last:]


def preamble_of(card: dict) -> str:
    return (card.get("preamble") or "import Mathlib").strip()


def lean_signature(card: dict, name: str) -> str:
    return f"theorem {name} {card['statement'].strip()}"


def solution_template(card: dict) -> str:
    return (f"{preamble_of(card)}\n\n"
            f"-- Target: Lean4All.Statements.{card['id']}  ({card.get('title', '')})\n"
            f"{lean_signature(card, 'solution')} := by\n  sorry\n")


def load_cards() -> tuple[dict[str, dict], dict[str, list[str]]]:
    cards, errors = {}, {}
    for path in sorted(THEOREMS.glob("*.yaml")):
        tid = path.stem
        try:
            card = load_yaml(path)
        except Exception as e:  # noqa: BLE001
            errors[tid] = [f"cannot parse {path.name}: {e}"]
            continue
        cards[tid] = card
        errors[tid] = validate_card(tid, card)
    return cards, errors


def validate_card(tid: str, card: dict) -> list[str]:
    errs = []
    if not ID_RE.match(tid):
        errs.append(f"theorem file name must look like T0001.yaml, got {tid}.yaml")
    if card.get("id") != tid:
        errs.append("field `id` must match the file name")
    for field in ("title", "description", "statement"):
        if not isinstance(card.get(field), str) or not card[field].strip():
            errs.append(f"missing field `{field}`")
    unknown = set(card) - CARD_FIELDS
    if unknown:
        errs.append(f"unknown fields: {', '.join(sorted(unknown))}")
    stmt = card.get("statement") or ""
    if isinstance(stmt, str):
        if "sorry" in stmt or ":=" in stmt:
            errs.append("`statement` is only the signature after the name, e.g. `(n : ℕ) : 0 ≤ n`")
        if STMT_COMMAND.search(stmt):
            errs.append("`statement` must be a single signature, not Lean commands")
        if BANNED.search(stmt):
            errs.append("`statement` uses a forbidden command")
    imports, rest = split_header(preamble_of(card))
    for imp in imports:
        if not (LIB_IMPORT.match(imp) or DEF_IMPORT.match(imp)):
            errs.append(f"preamble import not allowed: {imp}")
        m = DEF_IMPORT.match(imp)
        if m and not (DEFINITIONS / f"{m.group(1)}.lean").exists():
            errs.append(f"unknown definitions module: {imp}")
    for line in rest.splitlines():
        s = line.strip()
        if s and not s.startswith("--") and not re.match(r"open\s+[A-Za-z0-9_. ]+$", s):
            errs.append(f"preamble may only contain `import` and `open` lines, found: {s}")
    if card.get("tags") is not None and not isinstance(card["tags"], list):
        errs.append("`tags` must be a list")
    return errs


def load_solution(tid: str) -> tuple[dict | None, list[str]]:
    lean = SOLUTIONS / f"{tid}.lean"
    if not lean.exists():
        return None, []
    errs = []
    code = lean.read_text(encoding="utf-8")
    meta, explanation = {}, ""
    md = SOLUTIONS / f"{tid}.md"
    if md.exists():
        text = md.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
        if m:
            meta = yaml.safe_load(m.group(1)) or {}
            explanation = m.group(2).strip()
        else:
            explanation = text.strip()
    else:
        errs.append(f"missing solutions/{tid}.md (author + natural-language explanation)")
    if not meta.get("author"):
        errs.append(f"solutions/{tid}.md needs an `author:` (your GitHub username) in its front matter")
    if not explanation:
        errs.append(f"solutions/{tid}.md needs a natural-language explanation of the proof")
    imports, _ = split_header(code)
    deps_imported = []
    for imp in imports:
        m = STMT_IMPORT.match(imp)
        if m:
            deps_imported.append(m.group(1))
        elif not (LIB_IMPORT.match(imp) or DEF_IMPORT.match(imp)):
            errs.append(f"import not allowed in a solution: {imp}")
    bad = BANNED.search(code)
    if bad:
        errs.append(f"forbidden command in solution: `{bad.group(0)}`")
    return {"code": code, "meta": meta, "explanation": explanation, "imports": imports}, errs


def load_missions() -> tuple[dict[str, dict], dict[str, list[str]]]:
    missions, errors = {}, {}
    for path in sorted(MISSIONS.glob("*.yaml")):
        mid = path.stem
        try:
            m = load_yaml(path)
        except Exception as e:  # noqa: BLE001
            errors[mid] = [f"cannot parse {path.name}: {e}"]
            continue
        errs = []
        if not MISSION_RE.match(mid):
            errs.append("mission file names are lowercase-with-dashes")
        if m.get("id") != mid:
            errs.append("field `id` must match the file name")
        for field in ("title", "type", "captain", "summary", "goal"):
            if not m.get(field) and not (field == "goal" and m.get("blueprint")):
                errs.append(f"missing field `{field}`")
        for i, ms in enumerate(m.get("milestones") or []):
            if not isinstance(ms, dict) or not ms.get("title"):
                errs.append(f"milestone {i + 1} needs a title")
        missions[mid] = m
        errors[mid] = errs
    return missions, errors


# ----------------------------------------------------------------------------------------------
# gen
# ----------------------------------------------------------------------------------------------

def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")


def gen() -> dict:
    """Write Lean modules. Returns which modules exist plus validation errors."""
    cards, card_errors = load_cards()
    for sub in ("Statements", "Solutions", "Definitions"):
        shutil.rmtree(GEN / sub, ignore_errors=True)
    statements, solutions, definitions, sol_errors, sols = [], [], [], {}, {}

    for path in sorted(DEFINITIONS.glob("*.lean")):
        if DEF_RE.match(path.stem):
            write(GEN / "Definitions" / path.name, path.read_text(encoding="utf-8"))
            definitions.append(path.stem)

    for tid, card in cards.items():
        if card_errors[tid]:
            continue
        imports, rest = split_header(preamble_of(card))
        body = "\n".join(f"import {i}" for i in imports)
        body += f"\n{rest.strip()}\n\naxiom Lean4All.Statements.{tid} {card['statement'].strip()}\n"
        write(GEN / "Statements" / f"{tid}.lean", body)
        statements.append(tid)

    for path in sorted(SOLUTIONS.glob("*.lean")):
        tid = path.stem
        sol, errs = load_solution(tid)
        if tid not in cards:
            errs.append(f"solutions/{tid}.lean has no matching theorems/{tid}.yaml")
        elif card_errors.get(tid):
            errs.append("the theorem card is invalid")
        sol_errors[tid] = errs
        sols[tid] = sol
        if errs:
            continue
        _, body = split_header(sol["code"])
        header = sol["code"][: len(sol["code"]) - len(body)]
        ns = f"Lean4All.Solutions.{tid}"
        # Open the namespace on the last import line so error line numbers match the author's file.
        text = f"{header} namespace {ns}{body.rstrip()}\n\nend {ns}\n"
        write(GEN / "Solutions" / f"{tid}.lean", text)
        solutions.append(tid)

    write(ROOT / "Lean4All.lean", "import Lean4All.All\n")
    return {"cards": cards, "card_errors": card_errors, "statements": statements,
            "solutions": solutions, "definitions": definitions, "sol_errors": sol_errors, "sols": sols}


# ----------------------------------------------------------------------------------------------
# check
# ----------------------------------------------------------------------------------------------

def lake(*args: str, capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["lake", *args], cwd=ROOT, text=True,
                          capture_output=capture, check=False)


def build_modules(mods: list[str]) -> dict[str, str]:
    """Build modules; return {module: error output} for the ones that fail."""
    if not mods:
        return {}
    res = lake("build", *mods)
    if res.returncode == 0:
        return {}
    failed = {}
    for mod in mods:  # isolate the failures
        r = lake("build", mod)
        if r.returncode != 0:
            failed[mod] = clean_log(r.stdout + r.stderr)
    if not failed:  # something else is wrong (toolchain, network…)
        sys.stderr.write(res.stdout + res.stderr)
        raise SystemExit("lake build failed")
    return failed


def clean_log(log: str) -> str:
    keep = [ln for ln in log.splitlines() if "error" in ln.lower() or ln.startswith(("  ", "\t"))]
    text = "\n".join(keep or log.splitlines()[-30:])
    text = text.replace(str(ROOT) + "/", "").replace("Lean4All/Solutions/", "solutions/")
    return text.replace("Lean4All/Statements/", "theorems/")[-4000:]


CHECK_LEAN = r'''
import Lean4All.All
open Lean Meta

def ids : List String := __IDS__

def moduleOf (env : Environment) (n : Name) : Option Name := do
  let idx ← env.getModuleIdxFor? n
  env.header.moduleNames[idx.toNat]?

def stdAxioms : List Name := [``propext, ``Classical.choice, ``Quot.sound]

def checkProof (id : String) (kind : String) : MetaM (Option Json) := do
  let env ← getEnv
  let target := (`Lean4All.Statements).str id
  let ns := (`Lean4All.Solutions).str id
  let n := ns.str kind
  let some tinfo := env.find? target | return none
  let some cinfo := env.find? n | return none
  let mut errs : Array String := #[]
  let mut deps : Array String := #[]
  let mut axs : Array String := #[]
  unless cinfo matches .thmInfo _ do
    errs := errs.push s!"`{kind}` must be declared with `theorem`"
  unless moduleOf env n == some ((`Lean4All.Solutions).str id) do
    errs := errs.push s!"`{kind}` is declared in the wrong file"
  let expected := if kind == "solution" then tinfo.type else mkNot tinfo.type
  let same ← withReducible <| isDefEq cinfo.type expected
  unless same do
    errs := errs.push s!"the type of `{kind}` does not match the target statement exactly"
  for ax in (← collectAxioms n) do
    if stdAxioms.contains ax then
      axs := axs.push ax.toString
    else
      match ax with
      | .str p s =>
        if p == `Lean4All.Statements && ids.contains s &&
            moduleOf env ax == some ((`Lean4All.Statements).str s) then
          if s == id then errs := errs.push "the proof uses its own statement"
          else deps := deps.push s
        else errs := errs.push s!"disallowed axiom: {ax}"
      | _ => errs := errs.push s!"disallowed axiom: {ax}"
  return some <| Json.mkObj [("kind", kind), ("errors", toJson errs),
    ("deps", toJson deps), ("axioms", toJson axs)]

#eval show MetaM Unit from do
  let env ← getEnv
  let mut out : Array Json := #[]
  for id in ids do
    let target := (`Lean4All.Statements).str id
    let mut serrs : Array String := #[]
    match env.find? target with
    | some (.axiomInfo info) =>
      if info.type.hasSorry then serrs := serrs.push "the statement contains sorry"
    | _ => serrs := serrs.push "statement not found"
    let mut proofs : Array Json := #[]
    for kind in ["solution", "disproof"] do
      if let some j ← checkProof id kind then proofs := proofs.push j
    out := out.push <| Json.mkObj [("id", id), ("statement_errors", toJson serrs),
      ("proofs", toJson proofs)]
  IO.FS.writeFile "build/check.json" (toJson out).pretty
'''


def check(lean: bool = True) -> dict:
    g = gen()
    cards = g["cards"]
    results = {tid: {"errors": list(g["card_errors"][tid]), "proof": None, "proof_errors": []}
               for tid in cards}
    for tid, errs in g["sol_errors"].items():
        if tid in results:
            results[tid]["proof_errors"] += errs
    BUILD.mkdir(exist_ok=True)

    if lean:
        def_fail = build_modules([f"Lean4All.Definitions.{d}" for d in g["definitions"]])
        if def_fail:
            raise SystemExit("definitions failed to build:\n" + "\n".join(def_fail.values()))
        st_fail = build_modules([f"Lean4All.Statements.{t}" for t in g["statements"]])
        statements = [t for t in g["statements"] if f"Lean4All.Statements.{t}" not in st_fail]
        for mod, log in st_fail.items():
            results[mod.rsplit(".", 1)[1]]["errors"].append("statement does not compile:\n" + log)
        candidates = [t for t in g["solutions"] if t in statements]
        sol_fail = build_modules([f"Lean4All.Solutions.{t}" for t in candidates])
        solutions = [t for t in candidates if f"Lean4All.Solutions.{t}" not in sol_fail]
        for mod, log in sol_fail.items():
            results[mod.rsplit(".", 1)[1]]["proof_errors"].append("proof does not compile:\n" + log)

        imports = ([f"Lean4All.Definitions.{d}" for d in g["definitions"]]
                   + [f"Lean4All.Statements.{t}" for t in statements]
                   + [f"Lean4All.Solutions.{t}" for t in solutions])
        write(GEN / "All.lean", "".join(f"import {m}\n" for m in imports) or "import Mathlib\n")
        r = lake("build", "Lean4All")
        if r.returncode != 0:
            sys.stderr.write(r.stdout + r.stderr)
            raise SystemExit("building Lean4All.All failed")
        write(BUILD / "Check.lean", CHECK_LEAN.replace("__IDS__", json.dumps(statements)))
        r = lake("env", "lean", "build/Check.lean")
        if r.returncode != 0:
            sys.stderr.write(r.stdout + r.stderr)
            raise SystemExit("the proof checker failed")
        report = json.loads((BUILD / "check.json").read_text())
        for row in report:
            res = results[row["id"]]
            res["errors"] += row["statement_errors"]
            proofs = row["proofs"]
            if len(proofs) > 1:
                res["proof_errors"].append("define either `solution` or `disproof`, not both")
            elif proofs and not g["sol_errors"].get(row["id"]):
                p = proofs[0]
                res["proof_errors"] += p["errors"]
                if not p["errors"]:
                    res["proof"] = {"kind": p["kind"], "deps": sorted(set(p["deps"])),
                                    "axioms": p["axioms"]}
            elif row["id"] in solutions:
                res["proof_errors"].append("the file must declare `theorem solution` "
                                           "(or `theorem disproof` for a counterexample)")
    else:  # reuse a previous run (site preview without Lean)
        old = BUILD / "status.json"
        if old.exists():
            prev = json.loads(old.read_text())
            for tid, r in prev.items():
                if tid in results:
                    results[tid] = {k: r[k] for k in ("errors", "proof", "proof_errors")}

    status = resolve(results)
    for tid, r in results.items():
        r["status"] = status[tid]
    (BUILD / "status.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    return results


def resolve(results: dict) -> dict[str, str]:
    """proved / disproved / sketched (waits on open lemmas) / blocked / open / invalid."""
    status: dict[str, str] = {}

    def visit(tid: str, stack: set) -> str:
        if tid in status:
            return status[tid]
        if tid not in results:
            return "invalid"
        r = results[tid]
        if r["errors"]:
            status[tid] = "invalid"
        elif not r["proof"]:
            status[tid] = "open"
        else:
            stack = stack | {tid}
            dep_states = [("open" if d in stack else visit(d, stack)) for d in r["proof"]["deps"]]
            if any(s in ("disproved", "invalid", "blocked") for s in dep_states):
                status[tid] = "blocked"
            elif all(s == "proved" for s in dep_states):
                status[tid] = "proved" if r["proof"]["kind"] == "solution" else "disproved"
            else:
                status[tid] = "sketched"
        return status[tid]

    for tid in results:
        visit(tid, set())
    return status


# ----------------------------------------------------------------------------------------------
# policy
# ----------------------------------------------------------------------------------------------

def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=True,
                          check=True).stdout


def policy(base: str, author: str | None) -> dict:
    errors, review, ids = [], [], set()
    rows = [ln.split("\t") for ln in git("diff", "--name-status", "--no-renames",
                                          f"{base}...HEAD").splitlines() if ln]
    added = {p for s, p in rows if s == "A"}
    for status, path in rows:
        m_thm = re.match(r"^theorems/(T\d{4,})\.yaml$", path)
        m_sol = re.match(r"^solutions/(T\d{4,})\.(lean|md)$", path)
        if m_thm:
            tid = m_thm.group(1)
            ids.add(tid)
            if status == "D":
                errors.append(f"{path}: theorems cannot be deleted")
            elif status == "M":
                old = yaml.safe_load(git("show", f"{base}:{path}")) or {}
                new = load_yaml(ROOT / path)
                if any(str(old.get(f, "")).strip() != str(new.get(f, "")).strip()
                       for f in FORMAL_FIELDS):
                    errors.append(f"{path}: formal statements are immutable; propose a new theorem")
                else:
                    review.append(f"{path}: metadata edit")
            elif status == "A" and author:
                proposer = (load_yaml(ROOT / path).get("proposer") or "")
                if proposer != author:
                    errors.append(f"{path}: `proposer` must be your GitHub username ({author})")
        elif m_sol:
            tid, ext = m_sol.groups()
            ids.add(tid)
            if status != "A":
                errors.append(f"{path}: accepted proofs are immutable")
                continue
            if ext == "lean" and f"solutions/{tid}.md" not in added:
                errors.append(f"{path}: add solutions/{tid}.md with your explanation")
            if ext == "md":
                if f"solutions/{tid}.lean" not in added:
                    errors.append(f"{path}: has no matching solutions/{tid}.lean")
                if author:
                    sol, _ = load_solution(tid)
                    who = (sol or {}).get("meta", {}).get("author")
                    if who != author:
                        errors.append(f"{path}: `author` must be your GitHub username ({author})")
        elif re.match(r"^(missions|definitions)/", path):
            if path.startswith("definitions/") and status != "A":
                errors.append(f"{path}: definitions are immutable once statements depend on them")
            review.append(f"{path}: mission core changes are reviewed by a moderator")
        else:
            review.append(f"{path}: maintainer change")
    out = {"errors": errors, "review": review, "ids": sorted(ids),
           "automerge": not errors and not review and bool(rows)}
    BUILD.mkdir(exist_ok=True)
    (BUILD / "policy.json").write_text(json.dumps(out, indent=2))
    return out


def verify(base: str, author: str | None) -> int:
    pol = policy(base, author)
    results = check()
    lines, failed = ["## Lean4All verification", ""], bool(pol["errors"])
    for e in pol["errors"]:
        lines.append(f"- ❌ {e}")
    for tid in pol["ids"]:
        r = results.get(tid)
        if r is None:
            continue
        errs = r["errors"] + r["proof_errors"]
        if errs:
            failed = True
            lines.append(f"- ❌ **{tid}**")
            lines += [f"  ```\n  {e.strip()}\n  ```".replace("\n", "\n  ") for e in errs]
        else:
            deps = (r["proof"] or {}).get("deps") or []
            extra = f" (uses {', '.join(deps)})" if deps else ""
            lines.append(f"- ✅ **{tid}**: {r['status']}{extra}")
    for rv in pol["review"]:
        lines.append(f"- 👀 {rv}")
    lines += ["", "Result: " + ("**failed**" if failed else
              "**passed**" + (" — eligible for auto-merge" if pol["automerge"] else
                              " — needs maintainer review"))]
    summary = "\n".join(lines)
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(summary + "\n")
    (BUILD / "verify.md").write_text(summary)
    return 1 if failed else 0


# ----------------------------------------------------------------------------------------------
# site
# ----------------------------------------------------------------------------------------------

def git_dates(path: str) -> tuple[str | None, str | None]:
    """(first commit author date, author name) for a file, if it is committed."""
    try:
        out = git("log", "--diff-filter=A", "--follow", "--format=%aI", "--", path).split()
    except subprocess.CalledProcessError:
        return None, None
    return (out[-1] if out else None), None


def load_informal(tid: str, card: dict) -> dict | None:
    """Qwen's read-back of the statement (informal/<ID>.json), if present and current."""
    path = ROOT / "informal" / f"{tid}.json"
    if not path.exists():
        return None
    try:
        from informalize import formal_hash  # local module; imported lazily to avoid a cycle
        data = json.loads(path.read_text(encoding="utf-8"))
        data["stale"] = data.get("hash") != formal_hash(card)
        return data
    except Exception:  # noqa: BLE001
        return None


def repo_slug() -> str:
    if os.environ.get("GITHUB_REPOSITORY"):
        return os.environ["GITHUB_REPOSITORY"]
    cfg = load_yaml(ROOT / "lean4all.yaml")
    return cfg.get("repo", "")


def site(lean: bool) -> None:
    results = check(lean=lean)
    cards, _ = load_cards()
    missions, _ = load_missions()
    cfg = load_yaml(ROOT / "lean4all.yaml")
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    used_by: dict[str, list[str]] = {t: [] for t in cards}
    for tid, r in results.items():
        for d in (r["proof"] or {}).get("deps", []):
            used_by.setdefault(d, []).append(tid)

    theorems, activity = [], []
    for tid, card in cards.items():
        r = results[tid]
        sol, _ = load_solution(tid)
        created = git_dates(f"theorems/{tid}.yaml")[0] or str(card.get("created") or now)
        t = {
            "id": tid, "title": card.get("title", tid), "description": card.get("description", ""),
            "title_ko": card.get("title_ko"), "description_ko": card.get("description_ko"),
            "preamble": preamble_of(card), "statement": (card.get("statement") or "").strip(),
            "lean": f"{preamble_of(card)}\n\n{lean_signature(card, tid)} := by\n  sorry",
            "template": solution_template(card), "tags": card.get("tags") or [],
            "source": card.get("source"), "mission": card.get("mission"),
            "proposer": card.get("proposer"), "created": created, "status": r["status"],
            "errors": r["errors"], "proof_errors": r["proof_errors"],
            "used_by": sorted(used_by.get(tid, [])), "proof": None,
            "informal": load_informal(tid, card),
        }
        if sol and r["proof"]:
            date = git_dates(f"solutions/{tid}.lean")[0] or now
            t["proof"] = {**r["proof"], "code": sol["code"], "explanation": sol["explanation"],
                          "author": sol["meta"].get("author"), "agent": sol["meta"].get("agent"),
                          "date": date}
            activity.append({"date": date, "kind": r["proof"]["kind"], "theorem": tid,
                             "user": sol["meta"].get("author"), "agent": sol["meta"].get("agent")})
        activity.append({"date": created, "kind": "proposed", "theorem": tid,
                         "user": card.get("proposer")})
        theorems.append(t)
    by_id = {t["id"]: t for t in theorems}

    def closure(roots: list[str]) -> list[str]:
        seen, todo = [], list(roots)
        while todo:
            x = todo.pop(0)
            if x in seen or x not in by_id:
                continue
            seen.append(x)
            todo += (by_id[x]["proof"] or {}).get("deps", [])
        return seen

    mission_list = []
    for mid, m in missions.items():
        ms = m.get("milestones") or []
        roots = [m.get("goal")] + [x.get("theorem") for x in ms if x.get("theorem")]
        roots += [t["id"] for t in theorems if t["mission"] == mid]
        members = closure([x for x in roots if x])
        for x in members:
            by_id[x].setdefault("missions", []).append(mid)
        goal_status = by_id.get(m.get("goal"), {}).get("status", "open")
        people = {by_id[x]["proof"]["author"] for x in members if by_id[x]["proof"]}
        people |= {by_id[x]["proposer"] for x in members if by_id[x]["proposer"]}
        last = max([by_id[x]["proof"]["date"] for x in members if by_id[x]["proof"]] +
                   [by_id[x]["created"] for x in members] or [now])
        created = git_dates(f"missions/{mid}.yaml")[0] or str(m.get("created") or now)
        mission_list.append({
            **{k: m.get(k) for k in ("id", "title", "title_ko", "type", "tags", "captain", "summary",
                                    "summary_ko", "description", "description_ko", "source", "goal",
                                    "reviewed", "blueprint")},
            "milestones": ms, "theorems": members, "created": created, "updated": last,
            "completed": goal_status in ("proved", "disproved"), "goal_status": goal_status,
            "contributors": sorted(p for p in people if p),
        })
        activity.append({"date": created, "kind": "mission", "mission": mid,
                         "user": m.get("captain")})

    users: dict[str, dict] = {}

    def user(name: str) -> dict:
        return users.setdefault(name, {"name": name, "proved": 0, "sketched": 0, "disproved": 0,
                                       "proposed": 0, "imported": 0, "captained": 0, "agents": []})
    for t in theorems:
        if t["proof"] and t["proof"]["author"]:
            u = user(t["proof"]["author"])
            key = {"proved": "proved", "disproved": "disproved"}.get(t["status"], "sketched")
            u[key] += 1
            ag = t["proof"].get("agent")
            if ag and ag not in u["agents"]:
                u["agents"].append(ag)
        if t["proposer"]:
            u = user(t["proposer"])
            u["proposed"] += 1
            u["imported"] += len([x for x in t["used_by"] if by_id[x]["proof"] and
                                  by_id[x]["proof"]["author"] != t["proposer"]])
    for m in mission_list:
        if m["captain"]:
            user(m["captain"])["captained"] += 1
    for u in users.values():
        u["score"] = 10 * u["proved"] + 10 * u["disproved"] + 3 * u["sketched"] + 2 * u["imported"] + u["proposed"]

    blueprints = []
    for path in sorted((ROOT / "blueprints").glob("*/blueprint.json")):
        bp = json.loads(path.read_text(encoding="utf-8"))
        for it in bp["items"]:
            th = by_id.get(it.get("theorem") or "")
            it["status"] = th["status"] if th else None
        formal = [it for it in bp["items"] if it.get("theorem")]
        bp["counts"] = {"results": sum(1 for it in bp["items"] if it.get("lean") is not None or it.get("theorem")
                                       or it["kind"] in ("theorem", "lemma", "proposition", "corollary", "claim",
                                                         "conjecture", "fact", "observation")),
                        "formalized": len(formal),
                        "proved": sum(1 for it in formal if it["status"] in ("proved", "disproved"))}
        blueprints.append(bp)

    counts = {s: sum(1 for t in theorems if t["status"] == s)
              for s in ("proved", "disproved", "sketched", "blocked", "open", "invalid")}
    data = {
        "generated": now, "repo": repo_slug(), "branch": cfg.get("branch", "main"),
        "title": cfg.get("title", "Lean4All"), "tagline": cfg.get("tagline", ""),
        "toolchain": (ROOT / "lean-toolchain").read_text().strip(),
        "mathlib": cfg.get("mathlib", ""),
        "auth": cfg.get("auth") or None,
        "stats": {"missions": len(mission_list), "theorems": len(theorems), **counts,
                  "contributors": len(users)},
        "missions": mission_list, "theorems": theorems,
        "blueprints": [{k: bp.get(k) for k in ("id", "arxiv", "title", "title_ko", "authors", "mission", "status",
                                               "generated", "counts", "url", "issue")} for bp in blueprints],
        "users": sorted(users.values(), key=lambda u: -u["score"]),
        "activity": sorted(activity, key=lambda a: a["date"], reverse=True)[:200],
    }

    shutil.rmtree(SITE_OUT, ignore_errors=True)
    shutil.copytree(SITE_SRC, SITE_OUT)
    (SITE_OUT / "data.json").write_text(json.dumps(data, ensure_ascii=False))
    stamp = re.sub(r"\D", "", now)[:14]  # cache-bust app.css / app.js on every build
    index = (SITE_OUT / "index.html").read_text(encoding="utf-8")
    index = index.replace('href="app.css"', f'href="app.css?v={stamp}"')
    index = index.replace('src="i18n.js"', f'src="i18n.js?v={stamp}"')
    (SITE_OUT / "index.html").write_text(index.replace('src="app.js"', f'src="app.js?v={stamp}"'))
    api = SITE_OUT / "api"
    (api / "theorems").mkdir(parents=True)
    (api / "missions").mkdir(parents=True)
    (api / "missions.json").write_text(json.dumps(
        [{k: m[k] for k in ("id", "title", "type", "tags", "summary", "goal", "completed",
                             "goal_status", "theorems")} for m in mission_list], ensure_ascii=False))
    (api / "theorems.json").write_text(json.dumps(
        [{k: t[k] for k in ("id", "title", "status", "tags", "statement", "mission")}
         for t in theorems], ensure_ascii=False))
    for t in theorems:
        (api / "theorems" / f"{t['id']}.json").write_text(json.dumps(t, ensure_ascii=False))
    for m in mission_list:
        (api / "missions" / f"{m['id']}.json").write_text(json.dumps(m, ensure_ascii=False))
    (api / "blueprints").mkdir(parents=True)
    for bp in blueprints:
        (api / "blueprints" / f"{bp['id']}.json").write_text(json.dumps(bp, ensure_ascii=False))
        md = ROOT / "blueprints" / bp["id"] / "BLUEPRINT.md"
        if md.exists():
            (SITE_OUT / "blueprints" / bp["id"]).mkdir(parents=True, exist_ok=True)
            shutil.copy(md, SITE_OUT / "blueprints" / bp["id"] / "BLUEPRINT.md")
    for doc in ("start.md", "start.ko.md", "SKILL.md", "CONTRIBUTING.md", "CONTRIBUTING.ko.md"):
        shutil.copy(ROOT / doc, SITE_OUT / doc)
    (SITE_OUT / ".nojekyll").write_text("")
    print(f"site written to {SITE_OUT.relative_to(ROOT)}/ — {counts}")


# ----------------------------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gen")
    sub.add_parser("check")
    for name in ("policy", "verify"):
        p = sub.add_parser(name)
        p.add_argument("--base", default="origin/main")
        p.add_argument("--author", default=None)
    p = sub.add_parser("site")
    p.add_argument("--no-lean", action="store_true", help="reuse build/status.json")
    p = sub.add_parser("template")
    p.add_argument("id")
    a = ap.parse_args()

    if a.cmd == "gen":
        g = gen()
        bad = {k: v for k, v in {**g["card_errors"], **g["sol_errors"]}.items() if v}
        print(json.dumps(bad, indent=2) if bad else "ok")
        return 1 if bad else 0
    if a.cmd == "check":
        res = check()
        for tid, r in res.items():
            errs = r["errors"] + r["proof_errors"]
            print(f"{tid}  {r['status']:<9} {'; '.join(e.splitlines()[0] for e in errs)}")
        return 0
    if a.cmd == "policy":
        print(json.dumps(policy(a.base, a.author), indent=2))
        return 0
    if a.cmd == "verify":
        return verify(a.base, a.author)
    if a.cmd == "site":
        site(lean=not a.no_lean)
        return 0
    if a.cmd == "template":
        card = load_yaml(THEOREMS / f"{a.id}.yaml")
        print(solution_template(card), end="")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
