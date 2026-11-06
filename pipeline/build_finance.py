"""Build public/data/finance.json: what municipalities spent per resident in fiscal 2024 (令和6年度, actuals).

    python3 -m pipeline.build_finance                 # download (cached in data/raw/finance), verify hashes, rebuild
    python3 -m pipeline.build_finance --skip-download # use data/raw/finance as it is
    python3 -m pipeline.build_finance --record        # write size and SHA256 of the two workbooks into sources.json

Input: the two overview workbooks "(1) 概況" of 総務省「令和6年度 市町村別決算状況調」, one for the 都市 (cities and the
23 special wards) and one for the 町村. Per municipality they give the 団体コード (6 digits: the 5-digit area code plus a
check digit), the 団体名, the 住民基本台帳登載人口 (as of 2025-01-01), the 面積 and the 歳出総額 (thousand yen).

Output (deterministic; the same inputs give the same bytes):
    municipalities  area code -> [thousand yen per resident, residents]   (歳出総額 / 住民基本台帳人口, rounded once to a
                    whole thousand yen, which is what the panel shows). All 1,741 entries of the source, including the
                    20 designated cities and the 13 municipalities of the app's 浜通り area, which the app has no area for;
                    the wards of the designated cities have no settlement of their own and so no entry.
    bands           seven population bands (5千人未満 ... 20万人以上): count, median and the 25th / 75th percentile of
                    the per-resident figure. Quartiles are the "exclusive" ones (Weibull, position (n+1)p): that is what
                    Python's statistics.quantiles(n=4) gives and what the research table (調査_コストと負担 2-3) used.
    national        the sum of all expenditures divided by the sum of all residents.
    published       the four 団体区分 values of 令和7年版 地方財政白書 第39表 (令和5年度), transcribed (the table is a
                    different year and a different classification; the panel shows it apart from the bands).

The parser reads the columns by their header text, checks every 団体コード's check digit, and compares the sums of the
parsed rows with the 全国計 row of each workbook, so a layout change or a mis-read row stops the build.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from pipeline import fetch_sources, xlsx_min

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "data", "raw", "finance")
OUT_PATH = os.path.join(ROOT, "public", "data", "finance.json")
SOURCES_KEY = "finance"

FISCAL_YEAR = 2024  # 令和6年度
POPULATION_DATE = "2025-01-01"  # the 住民基本台帳人口 date used by the survey
LANDING_PAGE = "https://www.soumu.go.jp/iken/zaisei/r06_shichouson.html"
TERMS_PAGE = "https://www.soumu.go.jp/menu_kyotsuu/policy/tyosaku.html"
WHITE_PAPER_PAGE = "https://www.soumu.go.jp/menu_seisaku/hakusyo/chihou/r07data/2025data/r07czb01-10.html"
WHITE_PAPER_CSV = "https://www.soumu.go.jp/menu_seisaku/hakusyo/chihou/r07data/2025data/csv/h-039.csv"

# (file name in data/raw/finance, url, description). The sizes and hashes live in pipeline/sources.json.
WORKBOOKS: Tuple[Tuple[str, str, str], ...] = (
    ("r06_city_overview.xlsx", "https://www.soumu.go.jp/main_content/001061669.xlsx",
     "令和6年度 市町村別決算状況調 1 都市別 (1) 概況"),
    ("r06_town_overview.xlsx", "https://www.soumu.go.jp/main_content/001061674.xlsx",
     "令和6年度 市町村別決算状況調 2 町村別 (1) 概況"),
)

# Lower edges of the population bands; the last band is open at the top. A band holds lo <= residents < next lo.
BAND_EDGES: Tuple[int, ...] = (0, 5000, 10000, 30000, 50000, 100000, 200000)

# 令和7年版 地方財政白書 第39表 団体区分別人口1人当たり決算額の状況, 歳出, 令和5年度, thousand yen.
# Read from the CSV h-039.csv on 2026-11-06 (WHITE_PAPER_CSV). The same table gives 市町村合計 535.
PUBLISHED_ROWS: Tuple[Tuple[str, int], ...] = (
    ("中都市", 454),
    ("小都市", 567),
    ("町村（人口1万人以上）", 581),
    ("町村（人口1万人未満）", 1237),
)
PUBLISHED_FISCAL_YEAR = 2023  # 令和5年度


class ParseError(ValueError):
    """A workbook does not have the layout this parser expects, or a row does not hold what it should."""


@dataclass(frozen=True)
class Municipality:
    code: str  # 5-digit area code
    name: str
    population: int  # 住民基本台帳人口 on POPULATION_DATE
    area_km2: float
    expenditure: int  # 歳出総額, thousand yen


@dataclass(frozen=True)
class Overview:
    rows: Tuple[Municipality, ...]
    #: (population, expenditure) of the workbook's 全国計 row, when it has one
    national: Optional[Tuple[int, int]]


def norm(text: str) -> str:
    """A header or name cell without any whitespace (line breaks, spaces and the full-width space)."""
    return re.sub(r"\s+", "", text)


def check_digit(code5: str) -> int:
    """The check digit of a 団体コード: weights 6,5,4,3,2 on the five digits, (11 - sum mod 11) mod 10."""
    return (11 - sum(int(d) * w for d, w in zip(code5, (6, 5, 4, 3, 2))) % 11) % 10


def _find_column(header_cells: Dict[int, str], wanted: str, prefix: bool = False) -> int:
    hits = [c for c, t in header_cells.items() if (norm(t).startswith(wanted) if prefix else norm(t) == wanted)]
    if len(hits) != 1:
        raise ParseError(f"header {wanted!r}: expected exactly one column, found {len(hits)}")
    return hits[0]


def _number(text: Optional[str], what: str, where: str) -> float:
    try:
        value = float(text.replace(",", "")) if text is not None else math.nan
    except ValueError:
        value = math.nan
    if not math.isfinite(value):
        raise ParseError(f"{where}: {what} is not a number: {text!r}")
    return value


def parse_overview(path: str) -> Overview:
    """Read one overview workbook (the first sheet): every municipality row and, if present, the 全国計 row."""
    all_rows = list(xlsx_min.rows(path, 0))
    header_at = next((i for i, (_n, cells) in enumerate(all_rows) if any(norm(t) == "団体コード" for t in cells.values())), None)
    if header_at is None:
        raise ParseError(f"{path}: no header row with 団体コード")
    # The header spans two rows (the second one holds sub-columns such as うち日本人).
    header_cells: Dict[int, str] = {}
    for _n, cells in all_rows[header_at:header_at + 2]:
        header_cells.update(cells)
    c_code = _find_column(header_cells, "団体コード")
    c_name = _find_column(header_cells, "団体名")
    c_pop = _find_column(header_cells, "住民基本台帳登載人口")
    c_area = _find_column(header_cells, "面積", prefix=True)
    c_exp = _find_column(header_cells, "歳出総額")

    rows: List[Municipality] = []
    national: Optional[Tuple[int, int]] = None
    seen = set()
    for number, cells in all_rows[header_at + 2:]:
        code = cells.get(c_code, "").strip()
        name = norm(cells.get(c_name, ""))
        where = f"{os.path.basename(path)} row {number}"
        if name == "全国計":
            if national is not None:
                raise ParseError(f"{where}: second 全国計 row")
            national = (int(_number(cells.get(c_pop), "population", where)), int(_number(cells.get(c_exp), "expenditure", where)))
            continue
        if not re.fullmatch(r"\d{6}", code):
            continue  # prefecture heading, subtotal, blank or note row
        if int(code[5]) != check_digit(code[:5]):
            raise ParseError(f"{where}: {code} has a wrong check digit")
        if code[:5] in seen:
            raise ParseError(f"{where}: {code[:5]} appears twice")
        seen.add(code[:5])
        population = _number(cells.get(c_pop), "population", where)
        expenditure = _number(cells.get(c_exp), "expenditure", where)
        area = _number(cells.get(c_area), "area", where)
        if population != int(population) or expenditure != int(expenditure):
            raise ParseError(f"{where}: population or expenditure is not a whole number")
        if population <= 0 or expenditure <= 0 or area <= 0:
            raise ParseError(f"{where}: {name} has a non-positive population, expenditure or area")
        if not name:
            raise ParseError(f"{where}: {code} has no name")
        rows.append(Municipality(code[:5], name, int(population), area, int(expenditure)))
    if not rows:
        raise ParseError(f"{path}: no municipality rows")
    return Overview(tuple(rows), national)


def check_against_national(overview: Overview, label: str) -> None:
    """The parsed rows must add up to the workbook's own 全国計 row (when it has one)."""
    if overview.national is None:
        return
    pop = sum(r.population for r in overview.rows)
    exp = sum(r.expenditure for r in overview.rows)
    if (pop, exp) != overview.national:
        raise ParseError(f"{label}: rows add up to {pop} residents and {exp} thousand yen, the 全国計 row says {overview.national}")


def round_half_up(x: float) -> int:
    """Round once to a whole number, halves upward (Python's round() would go to the even one)."""
    return int(math.floor(x + 0.5))


def quantile_exclusive(values: Sequence[float], p: float) -> float:
    """The p-quantile by position (n+1)p with linear interpolation: statistics.quantiles(method='exclusive')."""
    s = sorted(values)
    n = len(s)
    if n == 0:
        raise ValueError("no values")
    h = (n + 1) * p
    if h <= 1:
        return float(s[0])
    if h >= n:
        return float(s[-1])
    lo = int(math.floor(h))
    return s[lo - 1] + (s[lo] - s[lo - 1]) * (h - lo)


def band_index(population: float, edges: Sequence[int] = BAND_EDGES) -> int:
    """The band holding `population`: the last edge that is <= population."""
    index = 0
    for i, lo in enumerate(edges):
        if population >= lo:
            index = i
    return index


def per_capita(m: Municipality) -> float:
    return m.expenditure / m.population


def build_bands(rows: Sequence[Municipality], edges: Sequence[int] = BAND_EDGES) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for i, lo in enumerate(edges):
        hi = edges[i + 1] if i + 1 < len(edges) else None
        values = [per_capita(m) for m in rows if band_index(m.population, edges) == i]
        if not values:
            raise ParseError(f"no municipality in the band starting at {lo}")
        out.append({
            "min": lo,
            "max": hi,
            "n": len(values),
            "median": round_half_up(quantile_exclusive(values, 0.5)),
            "p25": round_half_up(quantile_exclusive(values, 0.25)),
            "p75": round_half_up(quantile_exclusive(values, 0.75)),
        })
    return out


def build(overviews: Sequence[Overview], edges: Sequence[int] = BAND_EDGES) -> Dict[str, Any]:
    """The finance.json document from the parsed workbooks."""
    rows = [m for o in overviews for m in o.rows]
    codes = [m.code for m in rows]
    if len(set(codes)) != len(codes):
        raise ParseError("a municipality is in both workbooks")
    total_pop = sum(m.population for m in rows)
    total_exp = sum(m.expenditure for m in rows)
    return {
        "fiscalYear": FISCAL_YEAR,
        "populationDate": POPULATION_DATE,
        "unit": "千円/人",
        "formula": "歳出総額 ÷ 住民基本台帳人口",
        "national": {"n": len(rows), "perCapita": round_half_up(total_exp / total_pop), "population": total_pop, "expenditure": total_exp},
        "bands": build_bands(rows, edges),
        "published": {
            "fiscalYear": PUBLISHED_FISCAL_YEAR,
            "rows": [{"label": label, "perCapita": value} for label, value in PUBLISHED_ROWS],
        },
        "municipalities": {m.code: [round_half_up(per_capita(m)), m.population] for m in sorted(rows, key=lambda r: r.code)},
    }


def dump(doc: Dict[str, Any]) -> str:
    """Compact UTF-8 JSON, one trailing newline."""
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"


def write(doc: Dict[str, Any], path: str = OUT_PATH) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = dump(doc)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return len(text.encode("utf-8"))


# ---------------------------------------------------------------------------------------------------------------
# Download and hashes (the same way as the other sources: pipeline/sources.json, data/raw git-ignored)
# ---------------------------------------------------------------------------------------------------------------

def default_entries() -> List[Dict[str, Any]]:
    return [{"file": f, "url": u, "description": d} for f, u, d in WORKBOOKS]


def finance_entries(data: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    data = data if data is not None else fetch_sources.load_sources()
    section = data.get(SOURCES_KEY)
    return list(section["sources"]) if section else default_entries()


def record_hashes() -> None:
    """Download what is missing, then write size and SHA256 of the workbooks into sources.json."""
    data = fetch_sources.load_sources()
    entries = default_entries()
    failed = False
    for entry in entries:
        try:
            dest = fetch_sources.safe_dest(RAW_DIR, entry["file"])
            if not os.path.exists(dest):
                fetch_sources.download(entry["url"], dest)
            entry["bytes"] = os.path.getsize(dest)
            entry["sha256"] = fetch_sources.sha256_of(dest)
        except (fetch_sources.UnsafeFileName, fetch_sources.DownloadTooLarge, OSError) as exc:
            print(f"FAILED      {entry['file']}: {exc}", file=sys.stderr)
            failed = True
            continue
        print(f"recorded    {entry['file']}  {entry['bytes']} bytes  {entry['sha256']}")
    if failed:
        raise SystemExit("could not record every workbook; sources.json was NOT updated (see above)")
    data[SOURCES_KEY] = {
        "note": (
            "Municipal expenditure per resident. The Excel workbooks are NOT committed: pipeline/build_finance.py "
            "downloads them to data/raw/finance (git-ignored) and checks the SHA256 below. Run "
            "`python3 -m pipeline.build_finance --record` after a deliberate source update."
        ),
        "publisher": "Ministry of Internal Affairs and Communications (MIC)",
        "title": "Reiwa 6 (FY2024) Municipal Settlement Overview (市町村別決算状況調), overview workbooks",
        "license": (
            "MIC site terms: Public Data License 1.0 (PDL1.0) unless a rights notice says otherwise; cite the source and "
            "state that the data was processed. See docs/sources.md."
        ),
        "landing_page": LANDING_PAGE,
        "terms_page": TERMS_PAGE,
        "sources": entries,
    }
    fetch_sources.save_sources(data)


def fetch_all(entries: Sequence[Dict[str, Any]]) -> None:
    failed = False
    for entry in entries:
        try:
            status = fetch_sources.fetch_one(dict(entry), raw_dir=RAW_DIR)
        except (fetch_sources.HashMismatch, fetch_sources.UnsafeFileName, fetch_sources.DownloadTooLarge, OSError) as exc:
            print(f"FAILED      {entry['file']}: {exc}", file=sys.stderr)
            failed = True
            continue
        print(f"{status:<11} {entry['file']}")
    if failed:
        raise SystemExit("could not fetch every workbook (see above)")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--record", action="store_true", help="write size and SHA256 of the workbooks into sources.json")
    parser.add_argument("--skip-download", action="store_true", help="use data/raw/finance as it is")
    args = parser.parse_args(argv)

    if args.record:
        record_hashes()
        return 0
    entries = finance_entries()
    if not args.skip_download:
        fetch_all(entries)
    overviews = []
    for entry in entries:
        overview = parse_overview(fetch_sources.safe_dest(RAW_DIR, entry["file"]))
        check_against_national(overview, entry["file"])
        overviews.append(overview)
    doc = build(overviews)
    size = write(doc)
    print(f"wrote {len(doc['municipalities'])} municipalities and {len(doc['bands'])} bands to "
          f"{os.path.relpath(OUT_PATH, ROOT)} ({size} bytes); national {doc['national']['perCapita']} thousand yen per resident")
    for b in doc["bands"]:
        print(f"  {b['min']:>7}- n={b['n']:>3} median {b['median']:>5}  {b['p25']:>5}-{b['p75']:>5}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
