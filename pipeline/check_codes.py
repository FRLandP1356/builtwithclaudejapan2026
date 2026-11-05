"""Compare the IPSS area codes with the municipal polygons in public/data/geo.

    python3 -m pipeline.check_codes

Lists every mismatch in both directions and exits with status 1 when one is not
documented in docs/geometry-reconcile.md:

  * an IPSS area (public/data/index.json) that has no polygon,
  * a polygon whose code is not an IPSS area,
  * a documented exception (section A of the document) that is no longer true.

Only committed files are read (no raw downloads), so the check is cheap and also
runs as part of the unit tests.

docs/geometry-reconcile.md layout, parsed by `parse_reconcile`:

    ## A. ...   IPSS areas that have no polygon (allowed exceptions)
    ## B. ...   N03 polygons removed because IPSS has no such area
    ## C. ...   N03 municipalities merged into one IPSS area (Fukushima hamadori)

Each section holds a table whose first cell is a 5-digit code. A row whose first
cell is not a code (for example the unassigned areas, which have no code) is kept
as a label so that the build can still verify it exists.
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(ROOT, "public", "data", "index.json")
GEO_DIR = os.path.join(ROOT, "public", "data", "geo")
RECONCILE_MD = os.path.join(ROOT, "docs", "geometry-reconcile.md")

PREF_CODES = [f"{i:02d}" for i in range(1, 48)]
JAPAN_OBJECT = "prefectures"
PREF_OBJECT = "areas"

_CODE_RE = re.compile(r"^\d{5}$")
_SECTION_RE = re.compile(r"^##\s+([A-Z])\.")


# -- reading the shipped files ------------------------------------------------

def read_index(path: str = INDEX_PATH) -> List[dict]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def read_topology(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _properties(topo: dict, object_name: str) -> List[dict]:
    return [g.get("properties", {}) for g in topo["objects"][object_name]["geometries"]]


def read_prefectures(geo_dir: str = GEO_DIR) -> List[dict]:
    """Properties of the 47 prefecture polygons in japan.topo.json."""
    return _properties(read_topology(os.path.join(geo_dir, "japan.topo.json")), JAPAN_OBJECT)


def read_pref_properties(geo_dir: str = GEO_DIR) -> Dict[str, List[dict]]:
    """{prefecture code: properties of every municipal polygon in pref/<pp>.topo.json}."""
    out: Dict[str, List[dict]] = {}
    for pp in PREF_CODES:
        topo = read_topology(os.path.join(geo_dir, "pref", f"{pp}.topo.json"))
        out[pp] = _properties(topo, PREF_OBJECT)
    return out


def read_pref_codes(geo_dir: str = GEO_DIR) -> Dict[str, List[str]]:
    """{prefecture code: the `code` of every municipal polygon in its file}."""
    return {pp: [p["code"] for p in props] for pp, props in read_pref_properties(geo_dir).items()}


# -- the reconcile document ---------------------------------------------------

@dataclass
class Reconcile:
    no_polygon: Dict[str, str] = field(default_factory=dict)      # section A: code -> name
    removed: Dict[str, str] = field(default_factory=dict)         # section B: code -> name
    removed_labels: Dict[str, str] = field(default_factory=dict)  # section B rows without a code: name -> first cell
    merged: Dict[str, str] = field(default_factory=dict)          # section C: code -> name


def parse_reconcile(text: str) -> Reconcile:
    doc = Reconcile()
    section: Optional[str] = None
    for line in text.splitlines():
        m = _SECTION_RE.match(line)
        if m:
            section = m.group(1)
            continue
        if line.startswith("## "):
            section = None
            continue
        if section is None or not line.lstrip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2:
            continue
        first, name = cells[0], cells[1]
        if first == "コード" or set(first) <= set("-: ") or not first:
            continue  # header or separator row
        if _CODE_RE.match(first):
            target = {"A": doc.no_polygon, "B": doc.removed, "C": doc.merged}.get(section)
            if target is not None:
                target[first] = name
        elif section == "B":
            doc.removed_labels[name] = first
    return doc


def read_reconcile(path: str = RECONCILE_MD) -> Reconcile:
    with open(path, encoding="utf-8") as fh:
        return parse_reconcile(fh.read())


# -- comparison ---------------------------------------------------------------

@dataclass
class Report:
    missing_polygon: List[str]   # IPSS area, no polygon, not documented
    extra_polygon: List[str]     # polygon, no IPSS area
    stale_exceptions: List[str]  # documented as "no polygon" but a polygon exists or IPSS has no such area

    def problems(self) -> List[str]:
        out = []
        out += [f"IPSS area without polygon, not documented: {c}" for c in self.missing_polygon]
        out += [f"polygon without IPSS area: {c}" for c in self.extra_polygon]
        out += [f"documented exception is not true any more: {c}" for c in self.stale_exceptions]
        return out


def compare(index_codes: Set[str], polygon_codes: Set[str], doc: Reconcile) -> Report:
    index_codes, polygon_codes = set(index_codes), set(polygon_codes)
    missing = sorted(index_codes - polygon_codes)
    return Report(
        missing_polygon=[c for c in missing if c not in doc.no_polygon],
        extra_polygon=sorted(polygon_codes - index_codes),
        stale_exceptions=sorted(c for c in doc.no_polygon if c not in missing),
    )


def main() -> int:
    index = read_index()
    index_codes = {a["code"] for a in index}
    by_pref = read_pref_codes()
    polygon_codes = {c for codes in by_pref.values() for c in codes}
    doc = read_reconcile()
    report = compare(index_codes, polygon_codes, doc)

    print(f"IPSS areas: {len(index_codes)}   polygons: {len(polygon_codes)}")
    missing = sorted(index_codes - polygon_codes)
    print(f"IPSS areas without a polygon: {len(missing)}")
    for c in missing:
        mark = "documented" if c in doc.no_polygon else "NOT DOCUMENTED"
        print(f"  {c}  {mark}")
    extra = sorted(polygon_codes - index_codes)
    print(f"Polygons without an IPSS area: {len(extra)}")
    for c in extra:
        print(f"  {c}  NOT ALLOWED (remove it in the build)")
    for problem in report.problems():
        print("PROBLEM:", problem, file=sys.stderr)
    return 1 if report.problems() else 0


if __name__ == "__main__":
    sys.exit(main())
