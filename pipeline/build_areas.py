"""Build the per-prefecture area data used by the app from the IPSS workbooks.

    python3 -m pipeline.fetch_sources     # once: download the IPSS Excel files into data/raw
    python3 -m pipeline.build_areas       # writes public/data/** and test/fixtures/sample_areas.json

Inputs (data/raw, read with the stdlib-only pipeline.xlsx_min):
  suikei_kekka.xlsx    projection results 2020 (census) .. 2050 by sex and 5-year age group
  katei_suvr.xlsx      survival rates, one row per area and 5-year period
  katei_nmigr.xlsx     net migration rates, same layout
  katei_cwr_0-4sr.xlsx child-women ratio and sex ratio at age 0-4, one row per period

IPSS marks each row with a "市などの別" code in column 1:
  a = prefecture, 0 = ward (incl. Tokyo's 23 wards), 1 = designated-city total,
  2 = other city, 3 = town/village, 9 = Hamadori aggregate (Fukushima).
Areas the engine computes ("leaf areas") are kinds 0, 2, 3 and 9: 1,884 of them.
Kinds 1 and a are not leaf areas, but their member lists go into groups.json.

Output shapes (see src/engine/types.ts):
  public/data/areas/<pp>.json   Area[] for prefecture <pp>, compact JSON
  public/data/groups.json       { cities: {cityCode: wardCodes}, prefs: {pp: leafCodes} }
  public/data/index.json        [{code, name, prefCode, kind}] for all leaf areas
  test/fixtures/sample_areas.json   six areas copied from the generated data (engine tests)

Floats are rounded to 6 significant digits; populations stay integers.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Tuple

from pipeline import xlsx_min

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "data", "raw")
OUT_DIR = os.path.join(ROOT, "public", "data")
FIXTURE_PATH = os.path.join(ROOT, "test", "fixtures", "sample_areas.json")

SOURCE_FILES = {
    "results": "suikei_kekka.xlsx",
    "suvr": "katei_suvr.xlsx",
    "nmigr": "katei_nmigr.xlsx",
    "cwr": "katei_cwr_0-4sr.xlsx",
}

# Column layout of the workbooks (0-based). Rows before FIRST_DATA_ROW are headers.
FIRST_DATA_ROW = 6
COL_CODE, COL_KIND, COL_PREF, COL_NAME, COL_YEAR, COL_TOTAL = 0, 1, 2, 3, 4, 5
MALE_RESULT_COLS = range(28, 48)  # ages 0-4 ... 95+
FEMALE_RESULT_COLS = range(50, 70)
MALE_RATE_COLS = range(5, 24)  # 19 transitions: 0-4->5-9 ... 85-89->90-94, 90+->95+
FEMALE_RATE_COLS = range(25, 44)
COL_CWR, COL_SEX_RATIO = 5, 6

BASE_YEAR = 2020
OFFICIAL_YEARS = [2025, 2030, 2035, 2040, 2045, 2050]
PERIOD_STARTS = [2020, 2025, 2030, 2035, 2040, 2045]  # assumption tables are keyed by period START year,
# except the child-women table, which is keyed by the period END year (2025..2050).

LEAF_KINDS = {"0": "ward", "2": "city", "3": "town", "9": "hamadori"}

# Areas copied (in this order) into the test fixture.
SAMPLE_CODES = ["30206", "30201", "13101", "01101", "13402", "30427"]


def round6(value: float) -> Any:
    """Round to 6 significant digits; integral results become ints (shorter JSON, no '-0.0')."""
    rounded = float("%.6g" % value)
    return int(rounded) if rounded.is_integer() else rounded


def ipss_code(raw: str) -> str:
    """IPSS drops the leading zero of codes (Hokkaido '1000'); restore the 5-digit form."""
    return str(int(raw)).zfill(5)


def _number(text: Optional[str]) -> Optional[float]:
    """Cell text -> number, or None for missing / non-numeric cells such as '***'."""
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _integer(text: Optional[str], what: str) -> int:
    value = _number(text)
    if value is None or not value.is_integer():
        raise ValueError(f"expected an integer population for {what}, got {text!r}")
    return int(value)


def _data_rows(path: str) -> Iterator[Tuple[Dict[int, str], int]]:
    """Yield (row, start_year) for every data row. 'start_year' is the leading year of '2020年' or '2020年→2025年'."""
    for number, row in xlsx_min.rows(path):
        if number < FIRST_DATA_ROW or COL_CODE not in row or COL_YEAR not in row:
            continue
        yield row, int(row[COL_YEAR][:4])


# ---------------------------------------------------------------- readers


@dataclass
class Results:
    meta: Dict[str, Dict[str, Any]] = field(default_factory=dict)  # code5 -> kind/pref/name, in sheet order
    pops: Dict[str, Dict[int, Tuple[List[int], List[int], int]]] = field(default_factory=dict)  # code5 -> year -> (M, F, total)


def read_results(path: str) -> Results:
    res = Results()
    for row, year in _data_rows(path):
        code = ipss_code(row[COL_CODE])
        kind = row[COL_KIND]
        if code not in res.meta:
            res.meta[code] = {"kind": kind, "prefName": row.get(COL_PREF), "name": row.get(COL_NAME)}
        total = _integer(row.get(COL_TOTAL), f"{code} {year} total")
        if kind in LEAF_KINDS:
            male = [_integer(row.get(c), f"{code} {year} male col {c}") for c in MALE_RESULT_COLS]
            female = [_integer(row.get(c), f"{code} {year} female col {c}") for c in FEMALE_RESULT_COLS]
            if sum(male) + sum(female) != total:
                raise ValueError(f"{code} {year}: age cells add up to {sum(male) + sum(female)}, total says {total}")
        else:
            male = female = []
        res.pops.setdefault(code, {})[year] = (male, female, total)
    return res


Rates = Dict[Tuple[str, int], Tuple[List[Optional[float]], List[Optional[float]]]]


def read_rates(path: str) -> Rates:
    """(code5, period start year) -> (male rates, female rates); a cell without a value is None."""
    out: Rates = {}
    for row, year in _data_rows(path):
        out[(ipss_code(row[COL_CODE]), year)] = (
            [_number(row.get(c)) for c in MALE_RATE_COLS],
            [_number(row.get(c)) for c in FEMALE_RATE_COLS],
        )
    return out


def read_child_women(path: str) -> Dict[Tuple[str, int], Tuple[Optional[float], Optional[float]]]:
    """(code5, period END year) -> (child-women ratio, sex ratio at 0-4)."""
    out: Dict[Tuple[str, int], Tuple[Optional[float], Optional[float]]] = {}
    for row, year in _data_rows(path):
        out[(ipss_code(row[COL_CODE]), year)] = (_number(row.get(COL_CWR)), _number(row.get(COL_SEX_RATIO)))
    return out


# ---------------------------------------------------------------- assembly


def _assumptions(code: str, surv: Rates, mig: Rates, cwr: Dict[Tuple[str, int], Tuple[Any, Any]]) -> Optional[List[Dict[str, Any]]]:
    """Six periods (2020->25 ... 2045->50), or None when any of the inputs is missing.

    The 13 villages whose net migration rates are '***' (no assumption published) get None.
    """
    periods: List[Dict[str, Any]] = []
    for start in PERIOD_STARTS:
        s = surv.get((code, start))
        g = mig.get((code, start))
        c = cwr.get((code, start + 5))  # keyed by END year
        if s is None or g is None or c is None:
            return None
        values = s[0] + s[1] + g[0] + g[1] + list(c)
        if any(v is None for v in values):
            return None
        periods.append(
            {
                "surv": {"M": [round6(v) for v in s[0]], "F": [round6(v) for v in s[1]]},
                "mig": {"M": [round6(v) for v in g[0]], "F": [round6(v) for v in g[1]]},
                "cwr": round6(c[0]),
                "sexRatio": round6(c[1]),
            }
        )
    return periods


@dataclass
class BuildResult:
    areas: List[Dict[str, Any]]  # leaf areas in IPSS row order
    groups: Dict[str, Dict[str, List[str]]]  # {"cities": ..., "prefs": ...}
    index: List[Dict[str, str]]
    aggregate_official: Dict[str, Dict[int, int]]  # IPSS total rows (kinds 1 and a): code5 -> year -> total. For checks only.


def build_groups(res: Results) -> Dict[str, Dict[str, List[str]]]:
    """Group membership from IPSS row order.

    A designated-city row (kind 1) is listed immediately before its wards (kind 0), so a ward
    belongs to the most recent kind-1 row. The code cannot be used for this (Kawasaki's wards are
    14131.. but Kawasaki is 14130, not 14100). Tokyo's 23 wards follow a prefecture row, so they
    belong to no city. Prefectures list their leaf areas (wards, not the city total).
    """
    cities: Dict[str, List[str]] = {}
    prefs: Dict[str, List[str]] = {}
    current_city: Optional[str] = None
    for code, meta in res.meta.items():
        kind = meta["kind"]
        if kind == "1":
            current_city = code
            cities[code] = []
            continue
        if kind == "0" and current_city is not None:
            if code[:2] != current_city[:2]:
                raise ValueError(f"ward {code} listed under city {current_city} of another prefecture")
            cities[current_city].append(code)
        else:
            current_city = None
        if kind in LEAF_KINDS:
            prefs.setdefault(code[:2], []).append(code)
    return {"cities": cities, "prefs": prefs}


def build(raw_dir: str = RAW_DIR) -> BuildResult:
    res = read_results(os.path.join(raw_dir, SOURCE_FILES["results"]))
    surv = read_rates(os.path.join(raw_dir, SOURCE_FILES["suvr"]))
    mig = read_rates(os.path.join(raw_dir, SOURCE_FILES["nmigr"]))
    cwr = read_child_women(os.path.join(raw_dir, SOURCE_FILES["cwr"]))

    areas: List[Dict[str, Any]] = []
    for code, meta in res.meta.items():
        kind = LEAF_KINDS.get(meta["kind"])
        if kind is None:
            continue
        by_year = res.pops[code]
        assumptions = _assumptions(code, surv, mig, cwr)
        area: Dict[str, Any] = {
            "code": code,
            "name": meta["name"],
            "prefCode": code[:2],
            "prefName": meta["prefName"],
            "kind": kind,
            "base": {"M": by_year[BASE_YEAR][0], "F": by_year[BASE_YEAR][1]},
            "official": {y: by_year[y][2] for y in OFFICIAL_YEARS},
        }
        if assumptions is None:
            area["officialAges"] = {y: {"M": by_year[y][0], "F": by_year[y][1]} for y in OFFICIAL_YEARS}
        area["assumptions"] = assumptions
        areas.append(area)

    aggregates = {
        code: {y: pops[y][2] for y in [BASE_YEAR] + OFFICIAL_YEARS}
        for code, pops in res.pops.items()
        if res.meta[code]["kind"] in ("1", "a")
    }
    index = [{"code": a["code"], "name": a["name"], "prefCode": a["prefCode"], "kind": a["kind"]} for a in areas]
    return BuildResult(areas=areas, groups=build_groups(res), index=index, aggregate_official=aggregates)


# ---------------------------------------------------------------- output


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def write_outputs(result: BuildResult, out_dir: str = OUT_DIR, fixture_path: str = FIXTURE_PATH) -> List[str]:
    """Write areas/<pp>.json, groups.json, index.json and the test fixture. Returns the paths written."""
    written: List[str] = []
    by_pref: Dict[str, List[Dict[str, Any]]] = {}
    for area in result.areas:
        by_pref.setdefault(area["prefCode"], []).append(area)
    for pref, areas in sorted(by_pref.items()):
        path = os.path.join(out_dir, "areas", f"{pref}.json")
        _write(path, _dumps(areas))
        written.append(path)
    for name, obj in (("groups.json", result.groups), ("index.json", result.index)):
        path = os.path.join(out_dir, name)
        _write(path, _dumps(obj))
        written.append(path)

    by_code = {a["code"]: a for a in result.areas}
    sample = [by_code[c] for c in SAMPLE_CODES]
    _write(fixture_path, "[\n" + ",\n".join(_dumps(a) for a in sample) + "\n]\n")
    written.append(fixture_path)
    return written


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw-dir", default=RAW_DIR)
    parser.add_argument("--out-dir", default=OUT_DIR)
    parser.add_argument("--fixture", default=FIXTURE_PATH)
    args = parser.parse_args(argv)

    missing = [f for f in SOURCE_FILES.values() if not os.path.exists(os.path.join(args.raw_dir, f))]
    if missing:
        print(f"missing in {args.raw_dir}: {', '.join(missing)}; run `python3 -m pipeline.fetch_sources` first", file=sys.stderr)
        return 1
    result = build(args.raw_dir)
    paths = write_outputs(result, args.out_dir, args.fixture)
    null_count = sum(1 for a in result.areas if a["assumptions"] is None)
    print(f"{len(result.areas)} areas ({null_count} without assumptions), {len(paths)} files written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
