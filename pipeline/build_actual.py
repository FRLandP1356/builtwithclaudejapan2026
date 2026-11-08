"""Add the 2025 census (an actual count) to the app's area files, and write the data for the "answer check" page.

    python3 -m pipeline.fetch_sources     # as before
    python3 -m pipeline.build_areas       # as before
    python3 -m pipeline.fetch_census      # downloads the 2025 census table into data/raw (SHA256-checked)
    python3 -m pipeline.build_actual      # writes public/data/actual2025.json and public/data/checks.json

Inputs:
  data/raw/census2025_age5_hokan.xlsx
      e-Stat, 2025 Population Census, "Basic Complete Tabulation on Population etc." (published 2026-09-29), reference
      version with imputed values for unknown (statInfId 000040506659), table 2-7: sex x age (5-year groups) x municipality,
      all nationalities. People whose age was not stated are already allocated to ages by the statistics bureau, the same
      convention as the 2020 base population of the IPSS projection. (The raw-count version keeps 3.29 million people in an
      "unknown" column; spreading them in proportion over all ages instead was tried and rejected: they are mostly young
      adults, and the result distorted the age structure.)
  pipeline/inputs/ipss2018_total.csv
      IPSS "Regional Population Projections for Japan" 2018 estimate (heisei 30), result table 1 (total population
      2015-2045 by municipality), copied to CSV once from the published .xls.

Output shapes:
  public/data/actual2025.json   { version, date, areas: { code: { "M": [20], "F": [20] } } }  the 2025-10-01 count of every area
                                that can be matched, in the same 20 age groups as "base" (0-4 ... 90-94, 95+). The loader
                                attaches it to each area as `actual`. Ages marked "unknown" in the census are spread over the
                                known ages in proportion only if any are left (none are in the imputed version), so the sums equal the published totals. public/data/areas/*.json is
                                not touched (a test compares it with a fresh build_areas run).
  public/data/checks.json       { version, census, ipss23, ipss18, towns: [[code, census2020, ipss23_2025, census2025,
                                ipss18_2020, ipss18_2025], ...] }   null where a value does not exist for that town.

Areas that cannot be matched have no entry in actual2025.json: the seven wards of Hamamatsu (the city changed its wards in 2024, so the
2025 table has other wards). The Hamadori aggregate (07999) is the sum of the 13 municipalities IPSS projects together.
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import sys
from typing import Dict, List, Optional, Tuple

from pipeline import xlsx_min

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_CENSUS = os.path.join(ROOT, "data", "raw", "census2025_age5_hokan.xlsx")
IPSS18_CSV = os.path.join(ROOT, "pipeline", "inputs", "ipss2018_total.csv")
AREAS_GLOB = os.path.join(ROOT, "public", "data", "areas", "*.json")
CHECKS_PATH = os.path.join(ROOT, "public", "data", "checks.json")
ACTUAL_PATH = os.path.join(ROOT, "public", "data", "actual2025.json")

# The 13 municipalities in Fukushima's Hamadori that IPSS projects as one area (code 07999 in the app).
HAMADORI_CODE = "07999"
HAMADORI_MEMBERS = [
    "07204", "07209", "07212", "07541", "07542", "07543", "07544",
    "07545", "07546", "07547", "07548", "07561", "07564",
]

# Columns of table 2-7 (0-based): 0 nationality, 1 sex, 7 2025 municipality code, 8 name, 9 total,
# 10..29 ages 0-4 ... 95-99, 30 age 100+, 31 age unknown.
COL_NAT, COL_SEX, COL_CODE, COL_NAME, COL_TOTAL, COL_AGE0, COL_AGE_LAST, COL_UNKNOWN = 0, 1, 7, 8, 9, 10, 30, 31

NATIONAL_CODE = "00000"


def _num(text: Optional[str]) -> int:
    """A census cell as an int; '-', '', '…' and other marks mean 0."""
    if text is None:
        return 0
    try:
        return int(round(float(text)))
    except ValueError:
        return 0


def pack_ages(cells: List[int]) -> List[int]:
    """The 21 census groups (0-4 ... 95-99, 100+) -> the app's 20 (0-4 ... 90-94, 95+)."""
    if len(cells) != 21:
        raise ValueError(f"expected 21 age groups, got {len(cells)}")
    return cells[:19] + [cells[19] + cells[20]]


def scale_to_total(vec: List[int], total: int) -> List[int]:
    """Scale a vector of counts so it sums to `total`, with whole numbers (largest remainder).

    Used to spread the people whose age is unknown over the known ages in proportion. An all-zero vector with a
    positive total cannot be scaled and raises ValueError.
    """
    s = sum(vec)
    if total < 0 or any(v < 0 for v in vec):
        raise ValueError("negative count")
    if s == 0:
        if total == 0:
            return list(vec)
        raise ValueError("cannot spread a total over an all-zero vector")
    exact = [v * total / s for v in vec]
    floors = [int(x) for x in exact]
    short = total - sum(floors)
    order = sorted(range(len(vec)), key=lambda i: (exact[i] - floors[i], i), reverse=True)
    for i in order[:short]:
        floors[i] += 1
    return floors


def read_census(path: str) -> Dict[str, dict]:
    """code -> {name, total, M, F}. Only the all-nationalities rows on 2025 boundaries (not the 'old: ...' year-2000 rows)."""
    rec: Dict[str, dict] = {}
    for _, r in xlsx_min.rows(path):
        nat, sex, code, name = r.get(COL_NAT), r.get(COL_SEX), r.get(COL_CODE), r.get(COL_NAME)
        if not nat or not nat.startswith("0_") or not sex or not code or len(code) != 5 or not name:
            continue
        if "旧：" in name:
            continue
        s = sex[0]
        if s not in "012":
            continue
        total = _num(r.get(COL_TOTAL))
        ages = pack_ages([_num(r.get(c)) for c in range(COL_AGE0, COL_AGE_LAST + 1)])
        d = rec.setdefault(code, {"name": name.split("_", 1)[-1]})
        d[s] = {"total": total, "ages": ages}
    out: Dict[str, dict] = {}
    for code, d in rec.items():
        if not all(k in d for k in "012"):
            continue
        m = scale_to_total(d["1"]["ages"], d["1"]["total"])
        f = scale_to_total(d["2"]["ages"], d["2"]["total"])
        if sum(m) + sum(f) != d["0"]["total"]:
            raise ValueError(f"{code}: male + female {sum(m) + sum(f)} != total {d['0']['total']}")
        out[code] = {"name": d["name"], "total": d["0"]["total"], "M": m, "F": f}
    return out


def read_ipss18(path: str) -> Dict[str, dict]:
    """code -> {p2015, p2020, p2025} for the municipalities (kinds 0, 1, 2, 3); prefectures under 'pref:<code>'."""
    out: Dict[str, dict] = {}
    with open(path, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            out[row["code"] if row["kind"] != "a" else "pref:" + row["code"]] = {
                "kind": row["kind"],
                "p2015": int(row["p2015"]),
                "p2020": int(row["p2020"]),
                "p2025": int(row["p2025"]),
            }
    return out


def hamadori_actual(census: Dict[str, dict]) -> Optional[dict]:
    parts = [census.get(c) for c in HAMADORI_MEMBERS]
    if any(p is None for p in parts):
        return None
    return {
        "name": "浜通り地域",
        "total": sum(p["total"] for p in parts),
        "M": [sum(p["M"][i] for p in parts) for i in range(20)],
        "F": [sum(p["F"][i] for p in parts) for i in range(20)],
    }


def build(
    census: Dict[str, dict], ipss18: Dict[str, dict], area_files: List[str], checks_path: str, actual_path: str
) -> dict:
    """Write actual2025.json and checks.json from the area files (read only). Returns a summary."""
    census = dict(census)
    ham = hamadori_actual(census)
    if ham is not None:
        census[HAMADORI_CODE] = ham
    towns: List[list] = []
    actual_areas: Dict[str, dict] = {}
    matched = 0
    missing: List[str] = []
    sum_c20 = sum_p25 = sum_a25 = 0
    for path in sorted(area_files):
        with open(path, encoding="utf-8") as fh:
            areas = json.load(fh)
        for a in areas:
            code = a["code"]
            c20 = sum(a["base"]["M"]) + sum(a["base"]["F"])
            p25 = a["official"]["2025"]
            act = census.get(code)
            if act is not None:
                actual_areas[code] = {"M": act["M"], "F": act["F"]}
                matched += 1
            else:
                missing.append(code)
            old = ipss18.get(code)
            towns.append([
                code,
                c20,
                p25,
                act["total"] if act is not None else None,
                old["p2020"] if old else None,
                old["p2025"] if old else None,
            ])
            sum_c20 += c20
            sum_p25 += p25
            if act is not None:
                sum_a25 += act["total"]
    nat = census.get(NATIONAL_CODE)
    prefs18 = [v for k, v in ipss18.items() if k.startswith("pref:")]
    checks = {
        "version": 1,
        "census": {
            "date": "2025-10-01",
            "published": "2026-09-29",
            "national": nat["total"] if nat else None,
            "national2020": sum_c20,
            "title": "2025 Population Census, Basic Complete Tabulation on Population etc. (table 2-7)",
            "url": "https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&lid=000001491012",
        },
        "ipss23": {"national2025": sum_p25},
        "ipss18": {
            "national2020": sum(v["p2020"] for v in prefs18),
            "national2025": sum(v["p2025"] for v in prefs18),
            "url": "https://www.ipss.go.jp/pp-shicyoson/j/shicyoson18/2gaiyo_hyo/gaiyo.asp",
        },
        "towns": towns,
    }
    with open(checks_path, "w", encoding="utf-8") as fh:
        json.dump(checks, fh, ensure_ascii=False, separators=(",", ":"))
    with open(actual_path, "w", encoding="utf-8") as fh:
        json.dump({"version": 1, "date": "2025-10-01", "areas": actual_areas}, fh, ensure_ascii=False, separators=(",", ":"))
    return {"matched": matched, "missing": missing, "sumCensus2020": sum_c20, "sumIpss23_2025": sum_p25, "sumActual2025": sum_a25}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--census", default=RAW_CENSUS)
    ap.add_argument("--ipss18", default=IPSS18_CSV)
    ap.add_argument("--areas", default=AREAS_GLOB)
    ap.add_argument("--checks", default=CHECKS_PATH)
    ap.add_argument("--actual", default=ACTUAL_PATH)
    args = ap.parse_args(argv)
    if not os.path.exists(args.census):
        print(f"missing {args.census}; run `python3 -m pipeline.fetch_census` first", file=sys.stderr)
        return 1
    summary = build(read_census(args.census), read_ipss18(args.ipss18), glob.glob(args.areas), args.checks, args.actual)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
