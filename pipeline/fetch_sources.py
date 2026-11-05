"""Download the IPSS source workbooks listed in pipeline/sources.json.

Files go to data/raw (git-ignored). Each file is verified against the SHA256
recorded in sources.json so a rebuild reads exactly the data this project used.

    python3 -m pipeline.fetch_sources            # download missing files, verify hashes
    python3 -m pipeline.fetch_sources --force    # re-download everything
    python3 -m pipeline.fetch_sources --record   # write hashes/sizes into sources.json

The IPSS server answers 403 unless the request carries a browser-like
User-Agent, so one is sent.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.request
from typing import Any, Callable, Dict, List, Optional

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_JSON = os.path.join(ROOT, "pipeline", "sources.json")
RAW_DIR = os.path.join(ROOT, "data", "raw")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
CHUNK = 1 << 20
# Download size cap. sources.json records the size of every file ("bytes"); a download is aborted as
# soon as it has delivered more than that plus a tolerance of max(64 KiB, 1% of the recorded size).
# The tolerance only absorbs a server that re-wraps the same file; a different file is caught by the
# SHA256 check anyway. With no recorded size (--record, or a new entry) the cap is an absolute ceiling.
SIZE_TOLERANCE_MIN = 64 * 1024
SIZE_TOLERANCE_PERCENT = 1
MAX_UNRECORDED_BYTES = 256 * 1024 * 1024


class HashMismatch(Exception):
    pass


class DownloadTooLarge(Exception):
    """The server sent more bytes than sources.json records (plus the tolerance); the download was aborted."""


class UnsafeFileName(ValueError):
    """A destination file name from sources.json is not a plain base name inside the raw-data directory."""


def safe_dest(raw_dir: str, name: Any) -> str:
    """Return raw_dir/name after checking that name is a plain base name.

    Rejected (UnsafeFileName): non-strings, '', '.', '..', NUL, and anything containing a path
    separator ('/' or '\\', whatever the OS). The resolved path (symlinks followed) must also stay
    inside raw_dir, so an existing symlink in raw_dir cannot redirect a write elsewhere.
    Nothing is created or written here.
    """
    if not isinstance(name, str) or not name:
        raise UnsafeFileName(f"destination file name must be a non-empty string, got {name!r}")
    if "\x00" in name:
        raise UnsafeFileName(f"destination file name contains a NUL byte: {name!r}")
    if name in (".", ".."):
        raise UnsafeFileName(f"destination file name must not be {name!r}")
    if "/" in name or "\\" in name or os.path.basename(name) != name:
        raise UnsafeFileName(f"destination file name must be a plain base name, got {name!r}")
    root = os.path.realpath(raw_dir)
    resolved = os.path.realpath(os.path.join(raw_dir, name))
    if resolved == root or os.path.commonpath([root, resolved]) != root:
        raise UnsafeFileName(f"destination {name!r} resolves outside the raw-data directory ({resolved})")
    return os.path.join(raw_dir, name)


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def size_limit(expected_bytes: Optional[int]) -> int:
    """Most bytes a download may deliver: the recorded size plus the tolerance, or the ceiling if none is recorded."""
    if isinstance(expected_bytes, int) and not isinstance(expected_bytes, bool) and expected_bytes > 0:
        return expected_bytes + max(SIZE_TOLERANCE_MIN, expected_bytes * SIZE_TOLERANCE_PERCENT // 100)
    return MAX_UNRECORDED_BYTES


def download(url: str, dest: str, expected_bytes: Optional[int] = None, opener: Optional[Callable[..., Any]] = None) -> None:
    """Download url to dest atomically (temp file in the same directory, then rename).

    The transfer is aborted with DownloadTooLarge, and the partial file deleted, as soon as it would
    exceed size_limit(expected_bytes): a declared Content-Length over the limit aborts before any body
    is read, and the body is read in pieces that never go past limit + 1 byte. `opener` replaces
    urllib.request.urlopen (used by the tests to feed a fake stream).
    """
    limit = size_limit(expected_bytes)
    open_url = opener or urllib.request.urlopen
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dest), suffix=".part")
    try:
        with os.fdopen(fd, "wb") as out, open_url(req, timeout=120) as resp:
            headers = getattr(resp, "headers", None)
            declared = headers.get("Content-Length") if headers is not None else None
            if declared and declared.strip().isdigit() and int(declared) > limit:
                raise DownloadTooLarge(f"{url}: server announces {int(declared)} bytes, limit is {limit}")
            received = 0
            while True:
                block = resp.read(min(CHUNK, limit - received + 1))
                if not block:
                    break
                received += len(block)
                if received > limit:
                    raise DownloadTooLarge(f"{url}: more than {limit} bytes received (recorded size {expected_bytes})")
                out.write(block)
        os.replace(tmp, dest)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def fetch_one(entry: Dict[str, Any], raw_dir: str = RAW_DIR, force: bool = False) -> str:
    """Make sure entry['file'] exists in raw_dir and matches entry['sha256'].

    Returns one of "cached", "downloaded", "unverified" (no hash recorded yet).
    Raises HashMismatch (and removes the bad file) if the content differs, DownloadTooLarge (nothing
    is kept) if the server sends more than entry['bytes'] plus the tolerance, and UnsafeFileName
    (before anything is written) if entry['file'] is not a plain base name inside raw_dir.
    """
    dest = safe_dest(raw_dir, entry["file"])
    expected: Optional[str] = entry.get("sha256")
    status = "cached"
    if force or not os.path.exists(dest) or (expected and sha256_of(dest) != expected):
        download(entry["url"], dest, expected_bytes=entry.get("bytes"))
        status = "downloaded"
    actual = sha256_of(dest)
    if expected and actual != expected:
        os.remove(dest)
        raise HashMismatch(f"{entry['file']}: expected {expected}, got {actual}")
    return status if expected else "unverified"


def load_sources(path: str = SOURCES_JSON) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save_sources(data: Dict[str, Any], path: str = SOURCES_JSON) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="re-download even if the file exists")
    parser.add_argument("--record", action="store_true", help="write SHA256 and size into sources.json")
    args = parser.parse_args(argv)

    data = load_sources()
    failed = False
    for entry in data["sources"]:
        if args.record:
            # Recording trusts what the server sends now; do not compare with the old hash.
            dest = safe_dest(RAW_DIR, entry["file"])
            if args.force or not os.path.exists(dest):
                download(entry["url"], dest)
            entry["sha256"] = sha256_of(dest)
            entry["bytes"] = os.path.getsize(dest)
            print(f"recorded    {entry['file']}  {entry['bytes']} bytes  {entry['sha256']}")
            continue
        try:
            status = fetch_one(entry, force=args.force)
        except HashMismatch as exc:
            print(f"MISMATCH    {exc}", file=sys.stderr)
            failed = True
            continue
        except (UnsafeFileName, DownloadTooLarge, OSError) as exc:
            print(f"FAILED      {entry['file']}: {exc}", file=sys.stderr)
            failed = True
            continue
        print(f"{status:<11} {entry['file']}")
        if status == "unverified":
            print("            (no hash recorded; run with --record)", file=sys.stderr)
    if args.record:
        save_sources(data)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
