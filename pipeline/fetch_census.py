"""Download the 2025 census table used by pipeline.build_actual into data/raw (git-ignored), and check its SHA256.

    python3 -m pipeline.fetch_census            # download if missing, verify
    python3 -m pipeline.fetch_census --force    # download again

The file is the e-Stat download of table 2-7 of the 2025 Population Census, Basic Complete Tabulation on Population etc.,
the "imputed values for unknown" reference version (published 2026-09-29; statInfId 000040506659): sex x age (5-year groups)
x municipality, with the people whose age was not stated allocated to ages by the statistics bureau (the same convention as the
2020 base population IPSS used). The raw-count version (statInfId 000040506431) leaves them in an "unknown" column. Government statistics, e-Stat
terms of use (CC BY 4.0 compatible) apply; the app shows the figures with their source.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import urllib.request
from typing import Optional, List

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "data", "raw")
FILE = "census2025_age5_hokan.xlsx"
URL = "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040506659&fileKind=0"
SHA256 = "d6bac1f5d20e5bd2b0a67d02716a05f5000233096c789c5b4be8345257ffe124"
BYTES = 8564534
MAX_BYTES = BYTES + max(64 * 1024, BYTES // 100)


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    req = urllib.request.Request(URL, headers={"User-Agent": "town-2100 data pipeline (research; public statistics)"})
    got = 0
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            got += len(chunk)
            if got > MAX_BYTES:
                out.close()
                os.remove(tmp)
                raise RuntimeError(f"download is larger than the recorded size ({BYTES} bytes); aborted")
            out.write(chunk)
    digest = sha256_of(tmp)
    if digest != SHA256:
        os.remove(tmp)
        raise RuntimeError(f"SHA256 mismatch: got {digest}, expected {SHA256}")
    os.replace(tmp, dest)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    dest = os.path.join(RAW_DIR, FILE)
    if os.path.exists(dest) and not args.force:
        ok = sha256_of(dest) == SHA256
        print(f"{FILE}: {'ok' if ok else 'SHA256 MISMATCH'}")
        return 0 if ok else 1
    download(dest)
    print(f"{FILE}: downloaded, SHA256 ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
