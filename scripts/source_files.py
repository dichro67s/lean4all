#!/usr/bin/env python3
"""Source files attached to mission proposals: find them, check their type, and read their text.

A proposer attaches a textbook or paper to their "[Mission]" GitHub issue (in the issue form, or by
dragging it into a comment). This module:
  1. finds attachment links written by the issue author or the repository owner,
  2. downloads them and checks the real file type from the first bytes, not the name,
  3. reads the text: PDF text layer (pdftotext), DjVu text layer (djvutxt), LaTeX as is, and pages
     with no text (scans, photos) through the vision model.

Accepted: PDF, DjVu, LaTeX (.tex), PNG, JPEG, and a .zip holding those (GitHub does not accept
.djvu or .tex attachments directly).

  python3 scripts/source_files.py book.pdf --pages 12-30     # print the text the pipeline would see
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from informalize import MODEL, URL  # noqa: E402

UA = {"User-Agent": "lean4all-sources/1.0 (https://github.com/dichro67s/lean4all)"}
MAX_FILE = 30 * 1024 * 1024        # GitHub allows 25 MB attachments; leave some room
MAX_UNZIPPED = 250 * 1024 * 1024    # the site zips files too big for GitHub; they may unpack large
MAX_MEMBER = 200 * 1024 * 1024
MAX_PAGES = 60                     # pages read from a PDF or DjVu
MAX_SCAN_PAGES = 30                # pages sent to the vision model
MAX_IMAGES = 30
KINDS = ("pdf", "djvu", "tex", "png", "jpeg")
LABELS = {"pdf": "PDF", "djvu": "DjVu", "tex": "LaTeX", "png": "PNG image", "jpeg": "JPEG image", "zip": "ZIP"}

# github.com/user-attachments/files/<n>/<name>, …/assets/<uuid>, and the older <owner>/<repo>/files/<n>/<name>
ATTACH_RE = re.compile(r"https://github\.com/(?:user-attachments/(?:files|assets)/[\w.-]+(?:/[^\s)\]\"'<>]+)?"
                       r"|[\w.-]+/[\w.-]+/files/\d+/[^\s)\]\"'<>]+)")


class SourceError(ValueError):
    """The attached file can't be used. The message is shown to the proposer."""


# ----------------------------------------------------------------------------------------------
# Finding and downloading
# ----------------------------------------------------------------------------------------------

def attachment_links(issue: dict, comments: list[dict], owner: str) -> list[str]:
    """Attachment URLs in the issue body and in comments by the issue author or the repo owner."""
    allowed = {issue["user"]["login"].lower(), owner.lower()}
    texts = [issue.get("body") or ""] + [c.get("body") or "" for c in comments
                                         if (c.get("user") or {}).get("login", "").lower() in allowed]
    seen, out = set(), []
    for t in texts:
        for u in ATTACH_RE.findall(t):
            if u not in seen:
                seen.add(u)
                out.append(u)
    return out


def download(url: str) -> tuple[str, bytes]:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read(MAX_FILE + 1)
        name = Path(urllib.request.url2pathname(r.geturl().split("?")[0])).name
    if len(data) > MAX_FILE:
        raise SourceError(f"`{Path(url).name}` is larger than {MAX_FILE // 2**20} MB.")
    return name or Path(url).name, data


# ----------------------------------------------------------------------------------------------
# File types
# ----------------------------------------------------------------------------------------------

def sniff(data: bytes) -> str | None:
    """The real type from the first bytes: pdf, djvu, png, jpeg, zip, tex, or None."""
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:8] == b"AT&TFORM" and data[12:15] == b"DJV":
        return "djvu"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:4] == b"PK\x03\x04":
        return "zip"
    if b"\x00" not in data[:65536]:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("latin-1")
        if re.search(r"\\(documentclass|begin\{|section|newtheorem|input\{)", text):
            return "tex"
    return None


def unpack(name: str, data: bytes) -> list[tuple[str, str, bytes]]:
    """[(name, kind, bytes)] for one downloaded file; a zip is opened and each member checked."""
    kind = sniff(data)
    if kind in KINDS:
        return [(name, kind, data)]
    if kind != "zip":
        raise SourceError(f"`{name}` is not a PDF, DjVu, LaTeX, PNG or JPEG file "
                          "(checked from its contents, not its name).")
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise SourceError(f"`{name}` is a damaged zip file.") from e
    members = [i for i in zf.infolist() if not i.is_dir() and not Path(i.filename).name.startswith(".")
               and "__MACOSX" not in i.filename]
    if len(members) > 200 or sum(i.file_size for i in members) > MAX_UNZIPPED:
        raise SourceError(f"`{name}` holds too many or too large files.")
    out = []
    for i in members:
        if i.file_size > MAX_MEMBER:
            raise SourceError(f"`{i.filename}` in `{name}` is larger than {MAX_MEMBER // 2**20} MB.")
        b = zf.read(i)
        k = sniff(b)
        if k in KINDS:
            out.append((i.filename, k, b))
        elif Path(i.filename).suffix.lower() in (".sty", ".cls", ".bib", ".bbl", ".eps", ".txt", ".md"):
            continue    # LaTeX support files: harmless, not read
        else:
            raise SourceError(f"`{i.filename}` in `{name}` is not a PDF, DjVu, LaTeX, PNG or JPEG file.")
    if not out:
        raise SourceError(f"`{name}` contains no PDF, DjVu, LaTeX, PNG or JPEG file.")
    return out


def collect(files: list[tuple[str, bytes]]) -> list[tuple[str, str, bytes]]:
    """Check every downloaded file and decide what to read. Raises SourceError with a clear reason."""
    parts = [p for name, data in files for p in unpack(name, data)]
    kinds = {k for _, k, _ in parts}
    if "tex" in kinds:
        return [p for p in parts if p[1] == "tex"]          # LaTeX beats any PDF/scan of the same text
    docs = [p for p in parts if p[1] in ("pdf", "djvu")]
    if len(docs) > 1:
        raise SourceError("Please attach one document (PDF or DjVu). Use the page range to choose the part "
                          "to formalize.")
    if docs:
        return docs
    if len(parts) > MAX_IMAGES:
        raise SourceError(f"Please attach at most {MAX_IMAGES} page images.")
    return parts                                            # page photos, in the order given


# ----------------------------------------------------------------------------------------------
# Reading text
# ----------------------------------------------------------------------------------------------

def parse_pages(spec: str, total: int) -> tuple[int, int]:
    """'12-30' / '12' / '' -> (first, last), 1-based and inclusive, checked against the length."""
    spec = (spec or "").strip().replace("–", "-").replace("~", "-")
    if not spec:
        if total > MAX_PAGES:
            raise SourceError(f"The file has {total} pages. Please give a page range of at most {MAX_PAGES} pages "
                              "(e.g. `45-80`) in a new proposal.")
        return 1, total
    m = re.fullmatch(r"(\d+)\s*(?:-\s*(\d+))?", spec)
    if not m:
        raise SourceError(f"`{spec}` is not a page range like `45-80`.")
    a, b = int(m.group(1)), int(m.group(2) or m.group(1))
    if not 1 <= a <= b:
        raise SourceError(f"`{spec}` is not a valid page range.")
    if a > total:
        raise SourceError(f"The file has only {total} pages.")
    b = min(b, total)
    if b - a + 1 > MAX_PAGES:
        raise SourceError(f"Please choose at most {MAX_PAGES} pages (you asked for {b - a + 1}).")
    return a, b


def need(tool: str, what: str) -> str:
    path = shutil.which(tool)
    if not path:
        raise SourceError(f"The Lean4All server can't read {what} files yet. Please attach a PDF instead.")
    return path


OCR_SYSTEM = ("Transcribe this page of a mathematics book or paper. Keep theorem, lemma, definition and proof "
              "labels and numbers exactly as printed. Write all mathematics in LaTeX between $…$. "
              "Output only the transcription.")


def ocr(png: bytes, mime: str = "image/png") -> str:
    body = {"model": MODEL, "temperature": 0, "max_tokens": 4000, "messages": [
        {"role": "system", "content": OCR_SYSTEM},
        {"role": "user", "content": [{"type": "image_url", "image_url": {
            "url": f"data:{mime};base64,{base64.b64encode(png).decode()}"}}]}]}
    req = urllib.request.Request(f"{URL}/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["choices"][0]["message"]["content"] or ""


def ocr_pages(render, first: int, last: int, log) -> str:
    """render(page) -> PNG bytes. Reads at most MAX_SCAN_PAGES pages through the vision model."""
    if last - first + 1 > MAX_SCAN_PAGES:
        raise SourceError(f"These pages are scanned images. Please choose at most {MAX_SCAN_PAGES} pages for a scan.")
    out = []
    for p in range(first, last + 1):
        log(f"  reading scanned page {p}")
        out.append(f"[page {p}]\n{ocr(render(p))}")
    return "\n\n".join(out)


def scanned(text: str, pages: int) -> bool:
    return len(re.sub(r"\s", "", text)) < 200 * pages


def read_pdf(data: bytes, pages: str, work: Path, log) -> tuple[str, str]:
    pdf = work / "source.pdf"
    pdf.write_bytes(data)
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=60)
    m = re.search(r"^Pages:\s+(\d+)", info.stdout, re.M)
    if info.returncode != 0 or not m:
        raise SourceError("The PDF could not be opened (damaged or password-protected).")
    a, b = parse_pages(pages, int(m.group(1)))
    text = subprocess.run(["pdftotext", "-layout", "-f", str(a), "-l", str(b), str(pdf), "-"],
                          capture_output=True, text=True, timeout=300).stdout
    if not scanned(text, b - a + 1):
        return "file-pdf", text

    def render(p: int) -> bytes:
        subprocess.run(["pdftoppm", "-r", "150", "-png", "-f", str(p), "-l", str(p), "-singlefile",
                        str(pdf), str(work / "page")], check=True, timeout=120)
        return (work / "page.png").read_bytes()
    return "file-scan", ocr_pages(render, a, b, log)


def read_djvu(data: bytes, pages: str, work: Path, log) -> tuple[str, str]:
    djvu = work / "source.djvu"
    djvu.write_bytes(data)
    n = subprocess.run([need("djvused", "DjVu"), "-e", "n", str(djvu)], capture_output=True, text=True, timeout=60)
    if n.returncode != 0 or not n.stdout.strip().isdigit():
        raise SourceError("The DjVu file could not be opened.")
    a, b = parse_pages(pages, int(n.stdout.strip()))
    text = subprocess.run([need("djvutxt", "DjVu"), f"--page={a}-{b}", str(djvu)],
                          capture_output=True, text=True, timeout=300).stdout
    if not scanned(text, b - a + 1):
        return "file-djvu", text

    def render(p: int) -> bytes:
        out = work / "page.tif"
        subprocess.run([need("ddjvu", "DjVu"), "-format=tiff", f"-page={p}", "-scale=150", str(djvu), str(out)],
                       check=True, timeout=120)
        from PIL import Image
        buf = io.BytesIO()
        Image.open(out).save(buf, "PNG")
        return buf.getvalue()
    return "file-scan", ocr_pages(render, a, b, log)


def read_tex(parts: list[tuple[str, str, bytes]], work: Path) -> tuple[str, str]:
    from arxiv_blueprint import find_main_tex, flatten
    src = work / "tex"
    for name, _, data in parts:
        p = (src / name).resolve()
        if src.resolve() not in p.parents:
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    main = find_main_tex(src)
    if main is None:   # chapter files without a preamble: read them all in order
        return "file-latex", "\n\n".join(p.read_text(encoding="utf-8", errors="replace")
                                        for p in sorted(src.rglob("*.tex")))
    return "file-latex", flatten(main, src)


def read(parts: list[tuple[str, str, bytes]], pages: str = "", log=print) -> tuple[str, str]:
    """Text of the collected parts: (kind, text). kind: file-latex, file-pdf, file-djvu or file-scan."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        kind = parts[0][1]
        if kind == "tex":
            return read_tex(parts, work)
        if kind == "pdf":
            return read_pdf(parts[0][2], pages, work, log)
        if kind == "djvu":
            return read_djvu(parts[0][2], pages, work, log)
        texts = []
        for i, (name, k, data) in enumerate(parts, 1):
            log(f"  reading image {i}/{len(parts)}")
            texts.append(f"[image {i}: {name}]\n{ocr(data, 'image/png' if k == 'png' else 'image/jpeg')}")
        return "file-scan", "\n\n".join(texts)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--pages", default="")
    a = ap.parse_args()
    try:
        parts = collect([(Path(f).name, Path(f).read_bytes()) for f in a.files])
        print("files:", ", ".join(f"{n} ({LABELS[k]})" for n, k, _ in parts), file=sys.stderr)
        kind, text = read(parts, a.pages, log=lambda m: print(m, file=sys.stderr))
    except SourceError as e:
        print(f"rejected: {e}", file=sys.stderr)
        return 1
    print(f"kind: {kind}, {len(text):,} chars", file=sys.stderr)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
