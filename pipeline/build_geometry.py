"""Build simplified municipal boundaries (TopoJSON) from the 国土数値情報 行政区域データ N03.

    bash pipeline/build_geometry.sh                  # download (cached in data/raw/n03), rebuild everything
    python3 -m pipeline.build_geometry --only 07,13  # rebuild some prefectures only (skips the national layer)
    python3 -m pipeline.build_geometry --record      # write size and SHA256 of the 47 zips into sources.json

Input: N03-20210101 (boundaries as of 2021-01-01, the edition closest to the 2020 census),
one zip per prefecture. Each zip holds a GeoJSON (UTF-8, JGD2011 lon/lat) with one feature
per polygon piece; N03_007 is the 5-digit municipality code.

Output (all deterministic; the same inputs give the same bytes):
    public/data/geo/pref/<pp>.topo.json   object `areas`, properties {code (5 digits), name}
    public/data/geo/japan.topo.json       object `prefectures`, properties {code (2 digits), name}

Rules applied to the N03 polygons:
  * IPSS treats the 20 designated cities as ward areas, so ward polygons stay wards.
  * The 13 Fukushima 浜通り municipalities are dissolved into ONE feature with the IPSS code 07999.
  * Polygons with no IPSS area (the Northern Territories, unassigned areas with no code) are removed.
    The removals are listed in docs/geometry-reconcile.md and the build fails if that list is out of date.
  * `name` is the IPSS name for the code (index.json), so the map and the data never disagree.

Every mapshaper import uses `snap`: N03 draws a border shared by two municipalities (and, in the
national layer, by two prefectures) with vertices that differ by about 1 cm, so without snapping the
two sides become separate arcs, are simplified independently and leave gaps and overlaps.

Simplification: mapshaper `-simplify <p>% keep-shapes` (weighted Visvalingam, topology kept).
Start at 5% per prefecture and 2% for the national layer and go down a fixed ladder until the file
fits its size budget; the chosen percentage is printed for every file.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from pipeline import check_codes, fetch_sources

ROOT = check_codes.ROOT
RAW_DIR = os.path.join(ROOT, "data", "raw", "n03")
WORK_DIR = os.path.join(RAW_DIR, "work")
GEO_DIR = check_codes.GEO_DIR
PUBLIC_DATA = os.path.join(ROOT, "public", "data")

EDITION = "N03-20210101"
URL_PATTERN = "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2021/N03-20210101_{pp}_GML.zip"
LANDING_PAGE = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2021.html"
AGREEMENT_PAGE = "https://nlftp.mlit.go.jp/ksj/other/agreement.html"
SOURCES_KEY = "n03"

HAMADORI_CODE = "07999"
# The 13 Fukushima municipalities that IPSS reports as one area (浜通り地域).
HAMADORI_N03_CODES = frozenset({
    "07204",  # いわき市
    "07209",  # 相馬市
    "07212",  # 南相馬市
    "07541",  # 広野町
    "07542",  # 楢葉町
    "07543",  # 富岡町
    "07544",  # 川内村
    "07545",  # 大熊町
    "07546",  # 双葉町
    "07547",  # 浪江町
    "07548",  # 葛尾村
    "07561",  # 新地町
    "07564",  # 飯舘村
})

PREF_START_PERCENT = 5.0
NATIONAL_START_PERCENT = 2.0
# Descending ladder of retained-vertex percentages; a build never goes below the last rung.
LADDER = [8, 6, 5, 4, 3, 2.5, 2, 1.5, 1.2, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05, 0.03, 0.02]
QUANTIZATION = 10000   # TopoJSON grid steps per axis (about 70 m for Hokkaido, 20 m for a small prefecture)
BUDGET = 300_000       # bytes per file
BIG_BUDGET = 600_000   # Hokkaido and Okinawa (many islands)
BIG_PREFS = frozenset({"01", "47"})


# -- sources ------------------------------------------------------------------

def pref_codes() -> List[str]:
    return check_codes.PREF_CODES


def zip_name(pp: str) -> str:
    return f"{EDITION}_{pp}_GML.zip"


def default_entries() -> List[Dict[str, Any]]:
    return [{"file": zip_name(pp), "url": URL_PATTERN.format(pp=pp)} for pp in pref_codes()]


def n03_entries(data: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    data = data if data is not None else fetch_sources.load_sources()
    section = data.get(SOURCES_KEY)
    return list(section["sources"]) if section else default_entries()


def record_hashes() -> None:
    """Download what is missing, then write size and SHA256 of every zip into sources.json."""
    data = fetch_sources.load_sources()
    entries = default_entries()
    for entry in entries:
        dest = fetch_sources.safe_dest(RAW_DIR, entry["file"])
        if not os.path.exists(dest):
            fetch_sources.download(entry["url"], dest)
        entry["bytes"] = os.path.getsize(dest)
        entry["sha256"] = fetch_sources.sha256_of(dest)
        print(f"recorded    {entry['file']}  {entry['bytes']} bytes  {entry['sha256']}")
    data[SOURCES_KEY] = {
        "note": (
            "Municipal boundaries for the map. Raw zips are NOT committed: pipeline/build_geometry.py downloads "
            "them to data/raw/n03 (git-ignored) and checks the SHA256 below. Run "
            "`python3 -m pipeline.build_geometry --record` after a deliberate source update."
        ),
        "publisher": "Ministry of Land, Infrastructure, Transport and Tourism (MLIT), National Land Numerical Information",
        "title": "Administrative Area Data (N03), 2021-01-01 edition",
        "license": (
            "Site terms for National Land Numerical Information (government standard terms, compatible with CC BY 4.0); "
            "attribution required, state that the data was processed. See docs/sources.md."
        ),
        "landing_page": LANDING_PAGE,
        "terms_page": AGREEMENT_PAGE,
        "sources": entries,
    }
    fetch_sources.save_sources(data)


def fetch_all(entries: Iterable[Dict[str, Any]]) -> None:
    failed = False
    for entry in entries:
        try:
            status = fetch_sources.fetch_one(entry, raw_dir=RAW_DIR)
        except (fetch_sources.HashMismatch, fetch_sources.UnsafeFileName, fetch_sources.DownloadTooLarge, OSError) as exc:
            print(f"FAILED      {entry['file']}: {exc}", file=sys.stderr)
            failed = True
            continue
        print(f"{status:<11} {entry['file']}")
    if failed:
        raise SystemExit("could not fetch every N03 zip (see above)")


def read_n03_features(zip_path: str) -> List[dict]:
    """The GeoJSON features of one N03 zip. Member names use Windows backslashes inside the zip."""
    with zipfile.ZipFile(zip_path) as zf:
        members = [n for n in zf.namelist() if n.lower().endswith(".geojson")]
        if len(members) != 1:
            raise ValueError(f"{zip_path}: expected one .geojson member, found {members}")
        return json.loads(zf.read(members[0]))["features"]


# -- planning which polygons to keep ------------------------------------------

def n03_name(props: Dict[str, Any]) -> str:
    """Display name of an N03 polygon: ward polygons carry the designated city in N03_003."""
    city, name = props.get("N03_003"), props.get("N03_004") or ""
    return f"{city}{name}" if city and city.endswith("市") else name


@dataclass
class Plan:
    kept: List[dict] = field(default_factory=list)                  # GeoJSON features with {code, name}
    removed: Dict[str, Tuple[str, int]] = field(default_factory=dict)   # N03 code -> (name, polygon pieces)
    merged: Dict[str, Tuple[str, int]] = field(default_factory=dict)    # N03 code -> (name, polygon pieces)
    unassigned: Dict[str, int] = field(default_factory=dict)        # prefecture name -> pieces with no code


def plan_features(features: Iterable[dict], ipss_names: Dict[str, str],
                  hamadori: frozenset = HAMADORI_N03_CODES) -> Plan:
    """Decide, polygon piece by polygon piece, what goes into the municipal layer.

    ipss_names maps every IPSS area code to its name. Pieces that belong to the same IPSS code are
    dissolved later by mapshaper; here they only get the IPSS code and name.
    """
    plan = Plan()
    for f in features:
        props = f["properties"]
        code = props.get("N03_007")
        if not code:
            pref = props.get("N03_001") or "?"
            plan.unassigned[pref] = plan.unassigned.get(pref, 0) + 1
            continue
        code = str(code)
        if code in hamadori and HAMADORI_CODE in ipss_names:
            name, pieces = plan.merged.get(code, (n03_name(props), 0))
            plan.merged[code] = (name, pieces + 1)
            out_code = HAMADORI_CODE
        elif code in ipss_names:
            out_code = code
        else:
            name, pieces = plan.removed.get(code, (n03_name(props), 0))
            plan.removed[code] = (name, pieces + 1)
            continue
        plan.kept.append({
            "type": "Feature",
            "properties": {"code": out_code, "name": ipss_names[out_code]},
            "geometry": f["geometry"],
        })
    return plan


def verify_against_document(plan: Plan, doc: check_codes.Reconcile, ipss_names: Dict[str, str],
                            covered: Set[str]) -> List[str]:
    """Problems between what the build saw and what docs/geometry-reconcile.md says."""
    problems = []
    if set(plan.removed) != set(doc.removed):
        problems.append(f"removed polygons {sorted(plan.removed)} != documented {sorted(doc.removed)}")
    if set(plan.merged) != set(doc.merged):
        problems.append(f"merged municipalities {sorted(plan.merged)} != documented {sorted(doc.merged)}")
    documented_prefs = {pref for pref in plan.unassigned
                        if any("所属未定地" in label and pref in label for label in doc.removed_labels)}
    for pref in sorted(set(plan.unassigned) - documented_prefs):
        problems.append(f"unassigned areas (no code) in {pref} are not documented in section B")
    for label in doc.removed_labels:
        if "所属未定地" in label and not any(pref in label for pref in plan.unassigned):
            problems.append(f"section B documents '{label}' but the data has no such unassigned area")
    missing = {c for c in ipss_names if c not in covered}
    if missing != set(doc.no_polygon):
        problems.append(f"IPSS areas without a polygon {sorted(missing)} != documented {sorted(doc.no_polygon)}")
    return problems


# -- mapshaper ------------------------------------------------------------------

def mapshaper(*args: str) -> str:
    """Run the local mapshaper CLI (devDependency) and return its log; raise with the log on failure."""
    env = dict(os.environ, NODE_OPTIONS="--max-old-space-size=8192")
    proc = subprocess.run(
        ["npx", "--no-install", "mapshaper", *args],
        cwd=ROOT, env=env, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"mapshaper {' '.join(args)}\n{proc.stdout}\n{proc.stderr}")
    return proc.stdout + proc.stderr


def ladder_from(start: float) -> List[float]:
    return [p for p in LADDER if p <= start]


def write_json(path: str, obj: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def simplify_to_budget(src_args: List[str], out_path: str, object_name: str, start: float, budget: int) -> Tuple[float, int]:
    """Run -simplify down the ladder until `out_path` fits `budget`. Returns (percent, bytes)."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    last = (0.0, 0)
    for pct in ladder_from(start):
        mapshaper(
            *src_args,
            "-simplify", f"{pct}%", "keep-shapes",
            "-rename-layers", object_name,
            "-o", out_path, "format=topojson", f"quantization={QUANTIZATION}", "force",
        )
        size = os.path.getsize(out_path)
        last = (pct, size)
        if size <= budget:
            return last
    raise RuntimeError(f"{out_path}: {last[1]} bytes at {last[0]}% still exceeds {budget}")


# -- build ----------------------------------------------------------------------

def load_ipss() -> Tuple[Dict[str, str], Dict[str, str]]:
    """({area code: name}, {prefecture code: prefecture name}) from the committed IPSS outputs."""
    names = {a["code"]: a["name"] for a in check_codes.read_index()}
    prefs = {}
    for pp in pref_codes():
        with open(os.path.join(PUBLIC_DATA, "areas", f"{pp}.json"), encoding="utf-8") as fh:
            prefs[pp] = json.load(fh)[0]["prefName"]
    return names, prefs


def build_prefecture(pp: str, pref_name: str, ipss_names: Dict[str, str]) -> Tuple[Plan, Set[str], Tuple[float, int], int]:
    """Prepare, dissolve and simplify one prefecture. Returns (plan, covered codes, (percent, bytes), features)."""
    features = read_n03_features(os.path.join(RAW_DIR, zip_name(pp)))
    plan = plan_features(features, ipss_names)
    prepared = os.path.join(WORK_DIR, "prepared", f"{pp}.geojson")
    dissolved = os.path.join(WORK_DIR, "dissolved", f"{pp}.geojson")
    union = os.path.join(WORK_DIR, "pref", f"{pp}.geojson")
    write_json(prepared, {"type": "FeatureCollection", "features": plan.kept})
    os.makedirs(os.path.dirname(dissolved), exist_ok=True)
    os.makedirs(os.path.dirname(union), exist_ok=True)

    # One feature per IPSS code (the 13 hamadori municipalities share 07999).
    mapshaper("-i", prepared, "snap", "-dissolve", "code", "copy-fields=name", "-o", dissolved, "format=geojson", "force")
    # The prefecture outline for the national layer: the union of the kept municipal polygons.
    mapshaper(
        "-i", dissolved, "snap", "-dissolve",
        "-each", f"code='{pp}', name='{pref_name}'",
        "-o", union, "format=geojson", "force",
    )

    out = os.path.join(GEO_DIR, "pref", f"{pp}.topo.json")
    budget = BIG_BUDGET if pp in BIG_PREFS else BUDGET
    chosen = simplify_to_budget(["-i", dissolved, "snap"], out, check_codes.PREF_OBJECT, PREF_START_PERCENT, budget)
    covered = {f["properties"]["code"] for f in plan.kept}
    return plan, covered, chosen, len(covered)


def build_national() -> Tuple[float, int]:
    files = [os.path.join(WORK_DIR, "pref", f"{pp}.geojson") for pp in pref_codes()]
    out = os.path.join(GEO_DIR, "japan.topo.json")
    return simplify_to_budget(["-i", *files, "combine-files", "snap", "-merge-layers"], out, check_codes.JAPAN_OBJECT,
                              NATIONAL_START_PERCENT, BUDGET)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--record", action="store_true", help="write size and SHA256 of the zips into sources.json")
    parser.add_argument("--only", help="comma-separated prefecture codes (rebuild those; skips the national layer and the final check)")
    parser.add_argument("--skip-download", action="store_true", help="use data/raw/n03 as it is")
    args = parser.parse_args(argv)

    if args.record:
        record_hashes()
        return 0

    if shutil.which("npx") is None or not os.path.exists(os.path.join(ROOT, "node_modules", ".bin", "mapshaper")):
        raise SystemExit("mapshaper is not installed: run `npm ci` first")

    entries = n03_entries()
    if not args.skip_download:
        fetch_all(entries)

    ipss_names, pref_names = load_ipss()
    wanted = args.only.split(",") if args.only else pref_codes()
    unknown = [pp for pp in wanted if pp not in pref_codes()]
    if unknown:
        raise SystemExit(f"unknown prefecture codes: {unknown}")

    total = Plan()
    covered_all: Set[str] = set()
    rows = []
    for pp in wanted:
        plan, covered, (pct, size), n = build_prefecture(pp, pref_names[pp], ipss_names)
        covered_all |= covered
        total.removed.update(plan.removed)   # N03 codes are unique to their prefecture
        total.merged.update(plan.merged)
        for pref, pieces in plan.unassigned.items():
            total.unassigned[pref] = total.unassigned.get(pref, 0) + pieces
        rows.append((pp, pref_names[pp], n, pct, size))
        print(f"{pp} {pref_names[pp]:<5} {n:>4} areas  {pct:>5}%  {size:>8} bytes", flush=True)

    if args.only:
        return 0

    pct, size = build_national()
    print(f"japan.topo.json  {pct}%  {size} bytes")

    doc = check_codes.read_reconcile()
    problems = verify_against_document(total, doc, ipss_names, covered_all)
    print(f"removed (no IPSS area): {sorted(total.removed)}  unassigned pieces: {total.unassigned}")
    print(f"merged into {HAMADORI_CODE}: {sorted(total.merged)}")
    if problems:
        for p in problems:
            print("PROBLEM:", p, file=sys.stderr)
        return 1
    return check_codes.main()


if __name__ == "__main__":
    sys.exit(main())
