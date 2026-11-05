"""Minimal read-only .xlsx reader (stdlib only: zipfile + ElementTree).

Only what the IPSS population files need: list sheets, stream rows as
{column index (0-based): cell text}. Shared strings are resolved; numbers are
returned as the raw text stored in the file (no float conversion).
"""
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Dict, Iterator, List, Tuple

_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
_CELL_REF = re.compile(r"([A-Z]+)(\d+)")


def _col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n - 1


def _sheet_entries(zf: zipfile.ZipFile) -> List[Tuple[str, str]]:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    targets = {r.get("Id"): r.get("Target") for r in rels.iter(f"{{{_PKG_REL}}}Relationship")}
    out: List[Tuple[str, str]] = []
    sheets_el = workbook.find(f"{{{_MAIN}}}sheets")
    if sheets_el is None:
        return out
    for sheet in sheets_el:
        rid = sheet.get(f"{{{_REL}}}id")
        out.append((sheet.get("name") or "", targets[rid]))
    return out


def _shared_strings(zf: zipfile.ZipFile) -> List[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    strings: List[str] = []
    for si in root.iter(f"{{{_MAIN}}}si"):
        parts: List[str] = []
        for child in si:
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "t":  # plain text
                parts.append(child.text or "")
            elif tag == "r":  # rich-text run (skip phonetic hints, which are rPh)
                t = child.find(f"{{{_MAIN}}}t")
                parts.append((t.text or "") if t is not None else "")
        strings.append("".join(parts))
    return strings


def _part_name(target: str) -> str:
    return target[1:] if target.startswith("/") else "xl/" + target


def sheets(path: str) -> List[Tuple[str, str]]:
    """Return [(sheet name, relationship target)] in workbook order."""
    with zipfile.ZipFile(path) as zf:
        return _sheet_entries(zf)


def rows(path: str, sheet_index: int = 0) -> Iterator[Tuple[int, Dict[int, str]]]:
    """Stream (row_number, {col_index: text}) for one sheet.

    Row numbers are 1-based as in Excel, column indexes 0-based (A=0).
    Empty cells are omitted from the dict.
    """
    with zipfile.ZipFile(path) as zf:
        entries = _sheet_entries(zf)
        if not 0 <= sheet_index < len(entries):
            raise IndexError(f"sheet_index {sheet_index} out of range ({len(entries)} sheets)")
        shared = _shared_strings(zf)
        part = _part_name(entries[sheet_index][1])
        row_tag = f"{{{_MAIN}}}row"
        cell_tag = f"{{{_MAIN}}}c"
        v_tag = f"{{{_MAIN}}}v"
        is_tag = f"{{{_MAIN}}}is"
        t_tag = f"{{{_MAIN}}}t"
        auto_row = 0
        with zf.open(part) as fh:
            for _event, el in ET.iterparse(fh):
                if el.tag != row_tag:
                    continue
                auto_row += 1
                number = int(el.get("r") or auto_row)
                cells: Dict[int, str] = {}
                next_col = 0
                for c in el:
                    if c.tag != cell_tag:
                        continue
                    ref = c.get("r")
                    m = _CELL_REF.match(ref) if ref else None
                    col = _col_index(m.group(1)) if m else next_col
                    next_col = col + 1
                    ctype = c.get("t")
                    if ctype == "inlineStr":
                        node = c.find(is_tag)
                        text = "".join(t.text or "" for t in node.iter(t_tag)) if node is not None else ""
                    else:
                        v = c.find(v_tag)
                        if v is None or v.text is None:
                            continue
                        text = shared[int(v.text)] if ctype == "s" else v.text
                    cells[col] = text
                yield number, cells
                el.clear()
