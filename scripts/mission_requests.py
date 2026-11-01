#!/usr/bin/env python3
"""Turn mission proposals (GitHub issues titled "[Mission] …") into missions and theorem cards.

Proposals come from the site's "Launch a mission" page (signed-in visitors) or from the issue form
.github/ISSUE_TEMPLATE/propose-mission.yml. For each new proposal this script:
  1. reads the issue form fields; the issue author becomes captain and proposer,
  2. checks the mission id, the fields, and the goal statement against the theorem-card rules,
  3. compiles the statement against Mathlib,
  4. writes missions/<id>.yaml (reviewed: false) and theorems/T####.yaml.
If the proposal comes with a source (files attached to the issue, or a link), its type is checked
and its mission pages are published at once, marked "preparing": one mission per 5 pages plus one
for the whole source. `--work` then fills them in one part at a time in the background with the
arXiv pipeline (scripts/arxiv_blueprint.py): results, shared definitions, Lean statements and a
blueprint. The Lean goal statement is then optional. See scripts/source_files.py.
scripts/informal-bot.sh commits the result with "closes #N", which closes the issue.
A proposal is tried at most twice. If LEAN4ALL_BOT_TOKEN is set, failures are explained in a
comment on the issue.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lean4all as L  # noqa: E402
import source_files as S  # noqa: E402

REPO = os.environ.get("LEAN4ALL_REPO", "dichro67s/lean4all")
STATE = Path(os.environ.get("LEAN4ALL_MISSION_STATE", Path.home() / ".local/state/lean4all-missions.json"))
TOKEN = os.environ.get("LEAN4ALL_BOT_TOKEN", "")
UA = {"User-Agent": "lean4all-missions/1.0 (https://github.com/dichro67s/lean4all)",
      "Accept": "application/vnd.github+json"}
TYPES = ["Research Paper", "Textbook", "Open Problem", "Classic"]
MAX_PER_RUN = 3
LIMITS = {"title": 200, "summary": 400, "tags": 200, "source title": 300, "source url": 500,
          "goal description": 4000, "goal statement (lean)": 3000, "source file": 4000, "pages": 40}


def api(path: str, data: dict | None = None, method: str | None = None) -> dict | list:
    headers = dict(UA)
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    req = urllib.request.Request(f"https://api.github.com{path}", headers=headers, method=method,
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
        raise ValueError("A title and a goal statement (or a source file or link) are required.")
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


def module_for(mid: str) -> str:
    base = "Src" + "".join(w[:1].upper() + w[1:] for w in mid.split("-") if w)
    return base if not (L.DEFINITIONS / f"{base}.lean").exists() else base + "2"


def source_url(f: dict) -> str:
    """The link to extract from: given, and no file and no Lean goal (then it's only a reference)."""
    if f.get("source file") or f.get("goal statement (lean)"):
        return ""
    return f.get("source url", "").strip()


# ----------------------------------------------------------------------------------------------
# Proposals with a source: publish the mission pages at once, fill them in later
# ----------------------------------------------------------------------------------------------
# A source (attached files or a link) is split into parts of PART_PAGES pages. Right away, one
# "preparing" mission per part is published (plus a mission for the whole that lists the parts),
# and each part becomes a job. `--work` then takes one job at a time: it reads those pages, writes
# the blueprint and Lean statements, and turns the part's mission into a real one.

PART_PAGES = 5
MAX_BOOK_PAGES = 300
SOURCES = Path(os.environ.get("LEAN4ALL_SOURCES", Path.home() / ".local/share/lean4all-sources"))
JOBS = STATE.parent / "lean4all-jobs.json"
dump_yaml = lambda d: yaml.safe_dump(d, sort_keys=False, allow_unicode=True, width=100)  # noqa: E731


def load_jobs() -> list[dict]:
    return json.loads(JOBS.read_text()) if JOBS.exists() else []


def save_jobs(jobs: list[dict]) -> None:
    JOBS.parent.mkdir(parents=True, exist_ok=True)
    JOBS.write_text(json.dumps(jobs, indent=1))


def common_fields(iss: dict) -> tuple[dict, str, str, str]:
    """Checks shared by every proposal with a source. Returns (fields, mission id, captain, title)."""
    import arxiv_blueprint as B
    f = fields(iss.get("body") or "")
    for k, n in LIMITS.items():
        if len(f.get(k, "")) > n:
            raise ValueError(f"`{k}` is longer than {n} characters.")
    mid, login = f.get("mission id", "").strip(), iss["user"]["login"]
    if not L.MISSION_RE.match(mid) or len(mid) > 60:
        raise ValueError("The mission ID must use lowercase letters, digits and dashes (at most 60).")
    taken = lambda x: (L.MISSIONS / f"{x}.yaml").exists() or (B.BLUEPRINTS / x).exists() \
        or any(j["mission"] == x or j.get("parent") == x for j in load_jobs())  # noqa: E731
    if taken(mid):
        raise ValueError(f"A mission called `{mid}` already exists. Please file a new proposal with another ID.")
    title = f.get("title", "")
    if not title:
        raise ValueError("A title is required.")
    return f, mid, login, title


def prepare_source(iss: dict, links: list[str] | None = None) -> tuple[str, list[str]]:
    """Publish 'preparing' missions for the source and queue a job per part. Returns (mission id, part ids)."""
    import arxiv_blueprint as B
    f, mid, login, title = common_fields(iss)
    num = iss["number"]
    url = "" if links else source_url(f)
    mtype = f.get("type") if f.get("type") in TYPES else "Textbook"
    tags = [t.strip() for t in f.get("tags", "").split(",") if t.strip()][:8] or ["Mathematics"]
    stitle = f.get("source title") or title
    src_url = f.get("source url") or iss["html_url"]
    hint = "\n".join(x for x in (f.get("goal description", ""), f.get("goal statement (lean)", "")) if x)
    base = {"type": mtype, "tags": tags, "captain": login, "reviewed": False}
    job = {"issue": num, "captain": login, "title": title, "stitle": stitle, "url": src_url, "type": mtype,
           "tags": [] if tags == ["Mathematics"] else tags, "summary": f.get("summary", ""), "hint": hint, "tries": 0}

    aid = None
    if url and re.search(r"arxiv\.org/|^(arxiv:)?\s*\d{4}\.\d{4,5}", url, re.I):
        try:
            aid = B.parse_id(url)
        except ValueError:
            aid = None
    if aid:   # a paper: one part, read from arXiv when its turn comes
        B.fetch_meta(aid)   # fails now (not hours later) if the id doesn't exist
        chunks, offset, folder = [None], 0, None
    else:
        files = [S.download(u) for u in links] if links else [S.fetch_url(url)]
        parts = S.collect(files)                      # checks every file's real type
        total = S.page_count(parts)
        folder = SOURCES / f"{mid}-{num}"
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)
        for i, (name, _, data) in enumerate(parts):
            (folder / f"{i:03d}-{Path(name).name}").write_bytes(data)
        cut = re.search(r"already cut by the site to pages (\d+)", f.get("source file", ""), re.I)
        if total is None:                             # LaTeX or page photos: one part
            chunks, offset = [None], 0
        else:
            offset = int(cut.group(1)) - 1 if cut else 0
            a, b = (1, total) if cut or not f.get("pages") else S.parse_pages(f["pages"], total, MAX_BOOK_PAGES)
            if b - a + 1 > MAX_BOOK_PAGES:
                raise S.SourceError(f"The source has {b - a + 1} pages; at most {MAX_BOOK_PAGES} can be queued at "
                                    "once. Give a page range.")
            chunks = [(s, min(s + PART_PAGES - 1, b)) for s in range(a, b + 1, PART_PAGES)]

    def pages_of(c):   # page numbers of the original document
        return f"{c[0] + offset}-{c[1] + offset}" if c else ""
    single = len(chunks) == 1
    ids = [mid] if single else [f"{mid}-p{c[0] + offset}-{c[1] + offset}" for c in chunks]
    jobs = load_jobs()
    written = []
    try:
        for pid, c in zip(ids, chunks):
            pg = pages_of(c)
            m = {"id": pid, "title": title if single else f"{title} (pp. {pg})",
                 "title_ko": None if single else f"{title} ({pg}쪽)", **base,
                 "summary": (f"Pages {pg} of {stitle}. " if pg else f"{stitle}. ") +
                            "Being prepared: the server is reading the source and writing a blueprint and "
                            "Lean statements for it.",
                 "summary_ko": (f"{stitle}의 {pg}쪽. " if pg else f"{stitle}. ") +
                               "준비 중: 서버가 자료를 읽고 블루프린트와 Lean 명제를 쓰고 있습니다.",
                 "status": "preparing", "part_of": None if single else mid, "pages": pg or None,
                 "source": {"title": f"{stitle}, pp. {pg}" if pg else stitle, "url": src_url}}
            (L.MISSIONS / f"{pid}.yaml").write_text(dump_yaml({k: v for k, v in m.items() if v is not None}), encoding="utf-8")
            written.append(pid)
            jobs.append({**job, "mission": pid, "parent": None if single else mid, "dir": str(folder) if folder else None,
                         "pages": f"{c[0]}-{c[1]}" if c else "", "orig": pg, "arxiv": aid})
        if not single:
            span = f"{pages_of(chunks[0]).split('-')[0]}-{pages_of(chunks[-1]).split('-')[1]}"
            whole = {"id": mid, "title": title, **base,
                     "summary": f"{stitle}, pages {span}, in {len(ids)} parts of {PART_PAGES} pages.",
                     "summary_ko": f"{stitle}, {span}쪽을 {PART_PAGES}쪽씩 {len(ids)}부분으로 나눈 미션입니다.",
                     "status": "series", "parts": ids, "pages": span,
                     "source": {"title": stitle, "url": src_url}}
            (L.MISSIONS / f"{mid}.yaml").write_text(dump_yaml(whole), encoding="utf-8")
            written.append(mid)
        _, merrs = L.load_missions()
        bad = {k: v for k, v in merrs.items() if k in written and v}
        if bad:
            raise ValueError("The mission files are invalid: " + json.dumps(bad))
    except Exception:
        for pid in written:
            (L.MISSIONS / f"{pid}.yaml").unlink(missing_ok=True)
        if folder:
            shutil.rmtree(folder, ignore_errors=True)
        raise
    save_jobs(jobs)
    return mid, ids


def work_one(log=print) -> str | None:
    """Fill in the oldest queued part. Returns a commit message, or None if there was nothing to do."""
    import arxiv_blueprint as B
    jobs = load_jobs()
    if not jobs:
        return None
    job = jobs[0]
    mid = job["mission"]
    path = L.MISSIONS / f"{mid}.yaml"
    if not path.exists():   # removed meanwhile (e.g. by a moderator): drop the job
        save_jobs(jobs[1:])
        return None
    prepared = yaml.safe_load(path.read_text())
    log(f"part {mid} (issue #{job['issue']}, pages {job['orig'] or 'all'}): reading")
    meta = {"arxiv": None, "title": prepared["title"], "authors": [], "abstract": job["summary"], "categories": [],
            "url": job["url"], "published": "", "slug": mid, "module": module_for(mid),
            "label": job["stitle"] + (f", pp. {job['orig']}" if job["orig"] else ""),
            "type": job["type"], "tags": job["tags"]}
    status, note = "ready", ""
    try:
        if job.get("arxiv"):
            am = B.fetch_meta(job["arxiv"])
            meta.update({k: am[k] for k in ("arxiv", "authors", "categories", "published", "url")},
                        abstract=job["summary"] or am["abstract"], label=am["label"], tags=job["tags"] or am["tags"])
            with tempfile.TemporaryDirectory() as tmp:
                kind, text = B.download_source(job["arxiv"], Path(tmp))
        else:
            files = [(p.name.split("-", 1)[1], p.read_bytes()) for p in sorted(Path(job["dir"]).iterdir())]
            kind, text = S.read(S.collect(files), job["pages"], log=log)
        if len(re.sub(r"\s", "", text)) < 100:
            raise S.SourceError("no text could be read from these pages")
        log(f"  {kind}: {len(text):,} characters")
        path.unlink()   # run_source writes the real mission file
        try:
            B.run_source(meta, kind, text, job["captain"], job["issue"], log, hint=job["hint"])
        except RuntimeError as e:
            if "no theorem-like" not in str(e):
                raise
            status, note = "empty", "No theorems, lemmas or definitions were found on these pages."
    except S.SourceError as e:
        status, note = "failed", str(e)
    except Exception as e:  # noqa: BLE001  model or Lean trouble: try once more later
        if not path.exists():
            path.write_text(dump_yaml(prepared), encoding="utf-8")
        job["tries"] = job.get("tries", 0) + 1
        log(f"  failed ({type(e).__name__}: {e}); try {job['tries']} of 2")
        if job["tries"] < 2:
            save_jobs(jobs[1:] + [job])   # to the back of the queue
            return None
        status, note = "failed", f"The server ran into an error twice ({type(e).__name__})."
    made = sorted(p.stem for p in L.THEOREMS.glob("T*.yaml") if (yaml.safe_load(p.read_text()) or {}).get("mission") == mid)
    if status == "ready" and not made:
        status, note = "empty", "The server could not write a Lean statement that compiles for any result on these pages."
    m = yaml.safe_load(path.read_text()) if path.exists() and status == "ready" else dict(prepared)
    m["status"] = status
    m["title"] = prepared["title"]
    for k in ("title_ko", "part_of", "pages"):   # keep the part's own title and place in the source
        if prepared.get(k):
            m[k] = prepared[k]
    if status != "ready" and (B.BLUEPRINTS / mid / "blueprint.json").exists():
        m["blueprint"] = mid   # what was extracted is still worth seeing
    if status != "ready":
        m.pop("goal", None)
        m["summary"] = prepared["summary"].split(" Being prepared")[0] + " " + note
        m["summary_ko"] = prepared.get("summary_ko", "").split(" 준비 중")[0] + " " + {
            "empty": "이 부분에서는 Lean 명제를 만들지 못했습니다.",
            "failed": "이 부분을 처리하지 못했습니다."}[status]
    path.write_text(dump_yaml(m), encoding="utf-8")
    log(f"  {mid}: {status}, {len(made)} statement(s)")
    rest = jobs[1:]
    if job.get("dir") and not any(j.get("dir") == job["dir"] for j in rest):
        shutil.rmtree(job["dir"], ignore_errors=True)
    save_jobs(rest)
    left = sum(1 for j in rest if j["issue"] == job["issue"])
    return (f"Mission {mid}: {len(made)} Lean statement(s)" + ("" if status == "ready" else f" ({status})") + "\n\n"
            f"Filled in from {meta['label']} (issue #{job['issue']}); {left} part(s) of this source still queued.\n"
            + (f"{note}\n" if note else ""))


def comment(num: int, text: str) -> None:
    if not TOKEN:
        return
    try:
        api(f"/repos/{REPO}/issues/{num}/comments", {"body": text})
    except Exception as e:  # noqa: BLE001
        print(f"could not comment on #{num}: {e}")


def main() -> int:
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    issues = api(f"/repos/{REPO}/issues?state=open&per_page=50&sort=created&direction=asc")   # first come, first served
    done, lines = [], []
    for iss in issues:
        if "pull_request" in iss or not iss["title"].lower().startswith("[mission]"):
            continue
        num = iss["number"]
        tries = state.get(str(num), 0)
        if len(done) >= MAX_PER_RUN:
            continue
        links, f = [], fields(iss.get("body") or "")
        url = source_url(f)
        if url:
            links = [url]                   # remembered like attachments, so an edited link is tried again
            if state.get(f"{num}:links") == links:
                continue
            if tries >= 99:
                tries = 0
        elif f.get("source file"):
            links = S.attachment_links(iss, api(f"/repos/{REPO}/issues/{num}/comments?per_page=100"),
                                       REPO.split("/")[0])
            if not links:                   # the file hasn't been attached yet; check again next run
                if TOKEN and not state.get(f"{num}:nudged"):
                    comment(num, "Lean4All is waiting for the source file. Drag it into a comment on this issue "
                                 "(or into the Source file box when editing the issue). Accepted: PDF, DjVu, "
                                 "LaTeX (.tex), PNG, JPEG, or a .zip of those. Nothing happens until it's here.")
                    state[f"{num}:nudged"] = 1
                    STATE.parent.mkdir(parents=True, exist_ok=True)
                    STATE.write_text(json.dumps(state))
                continue
            if state.get(f"{num}:links") == links:
                continue                    # these files were already rejected; wait for new ones
            if tries >= 99:
                tries = 0                   # new files after a rejection: try again
        if tries >= 2:
            continue
        state[str(num)] = tries + 1
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(state))
        try:
            if links:
                mid, part_ids = prepare_source(iss, None if url else links)
                tid = ""
                n = len(part_ids)
                comment(num, f"Lean4All published the mission `{mid}`"
                             + (f" in {n} parts of {PART_PAGES} pages" if n > 1 else "") + ". "
                             "Its pages are marked \"preparing\" for now: the server fills them in one part at a "
                             "time in the background (each part usually takes 5 to 15 minutes, longer for a scan). "
                             "Follow it on the mission page; this issue is done.")
            else:
                mid, tid = build(iss)
        except S.SourceError as e:
            state[str(num)], state[f"{num}:links"] = 99, links
            STATE.write_text(json.dumps(state))
            print(f"issue #{num} file rejected: {e}")
            again = ("Edit the Source URL in this issue, or attach the file in a new comment, and it will be tried again."
                     if url else "Attach a corrected file in a new comment on this issue and it will be tried again.")
            comment(num, f"Lean4All could not use the {'linked' if url else 'attached'} file.\n\n{e}\n\n{again} "
                         "Accepted: PDF, DjVu, LaTeX (.tex), PNG, JPEG, or a .zip of those.")
            continue
        except ValueError as e:
            state[str(num)] = 99   # the proposal itself is wrong; don't retry
            if links:              # ...unless its files or link change (otherwise this repeats every run)
                state[f"{num}:links"] = links
            STATE.write_text(json.dumps(state))
            print(f"issue #{num} rejected: {str(e).splitlines()[0]}")
            comment(num, f"Lean4All could not publish this proposal.\n\n{e}\n\n"
                         "You can file a corrected proposal from the site or with the issue form.")
            if TOKEN:   # the proposal itself is wrong: close it, so its status is clear on the site
                try:
                    api(f"/repos/{REPO}/issues/{num}", {"state": "closed", "state_reason": "not_planned"}, "PATCH")
                except Exception as err:  # noqa: BLE001
                    print(f"could not close #{num}: {err}")
            continue
        except Exception as e:  # noqa: BLE001
            print(f"issue #{num} failed: {e}")
            if links and tries + 1 >= 2:
                comment(num, "Lean4All could not turn the attached file into a mission after two tries "
                             f"({type(e).__name__}). A moderator will take a look.")
            continue
        print(f"issue #{num}: mission {mid}, goal {tid or '(blueprint only)'}")
        done.append(num)
        uid = iss["user"].get("id")
        lines.append((mid, tid, num, iss["user"]["login"], uid))
    if lines:
        msg = "Mission proposals: " + ", ".join(m for m, *_ in lines)
        body = "\n".join(f"{m} (goal {t or 'being prepared from the source'}), proposed by @{u} (closes #{n})" for m, t, n, u, _ in lines)
        trailers = "\n".join(sorted({f"Co-authored-by: {u} <{i}+{u}@users.noreply.github.com>" for *_, u, i in lines}))
        (L.BUILD / "mission-commit-message.txt").write_text(f"{msg}\n\n{body}\n\n{trailers}\n")
    return 0


def work_main() -> int:
    msg = work_one()
    if msg:
        (L.BUILD / "part-commit-message.txt").write_text(msg)
    return 0


if __name__ == "__main__":
    sys.exit(work_main() if "--work" in sys.argv else main())
