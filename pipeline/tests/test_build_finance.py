"""Tests for pipeline.build_finance: the parser against a tiny synthetic workbook, the statistics, and (when the
downloaded workbooks are in data/raw/finance) the real data against the research table and the committed JSON."""
import json
import os
import random
import statistics
import tempfile
import unittest
import zipfile
from typing import Dict, List, Optional, Union
from xml.sax.saxutils import escape

from pipeline import build_finance as bf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COMMITTED = os.path.join(ROOT, "public", "data", "finance.json")

Cell = Union[str, int, float]


def col_letters(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(ord("A") + r) + s
    return s


def write_xlsx(path: str, rows: Dict[int, Dict[int, Cell]]) -> None:
    """A one-sheet workbook: {row number: {column index: text or number}}. Text is stored inline, numbers as <v>."""
    sheet_rows = []
    for number in sorted(rows):
        cells = []
        for col in sorted(rows[number]):
            value = rows[number][col]
            ref = f"{col_letters(col)}{number}"
            if isinstance(value, str):
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
            else:
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
        sheet_rows.append(f'<row r="{number}">{"".join(cells)}</row>')
    sheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        + "".join(sheet_rows)
        + "</sheetData></worksheet>"
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/></Relationships>'
    )
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", rels)
        zf.writestr("xl/worksheets/sheet1.xml", sheet)


def code6(code5: str) -> str:
    return code5 + str(bf.check_digit(code5))


# Column positions of the fixture (deliberately not the real ones: the parser must find them by header text).
C_CODE, C_NAME, C_POP, C_AREA, C_EXP = 2, 3, 4, 7, 9


def fixture_rows(data: List[tuple], national: Optional[tuple] = None, extra: Optional[Dict[int, Dict[int, Cell]]] = None) -> Dict[int, Dict[int, Cell]]:
    rows: Dict[int, Dict[int, Cell]] = {
        3: {C_NAME: "(1)都市別　ア概況"},
        10: {C_CODE: "団体\nコード", C_NAME: "団体名", C_POP: "住民基本台帳\n登載人口", C_AREA: "面積\n(令6.10.1現在)", C_EXP: "歳出総額"},
        11: {C_POP + 1: "うち日本人"},
        12: {C_POP: "(令7.1.1現在)"},
        13: {C_POP: "(人)", C_AREA: "(k㎡)", C_EXP: "(B)"},
        14: {C_NAME: "北　海　道"},
    }
    n = 15
    for code5, name, pop, area, exp in data:
        rows[n] = {C_CODE: code6(code5), C_NAME: name, C_POP: pop, C_AREA: area, C_EXP: exp, C_EXP + 1: 999}
        n += 1
    rows[n] = {C_CODE: "", C_NAME: "合　　　計", C_POP: sum(d[2] for d in data), C_EXP: sum(d[4] for d in data)}
    n += 1
    if national is not None:
        rows[n] = {C_CODE: "", C_NAME: "全国計", C_POP: national[0], C_EXP: national[1]}
        n += 1
    rows[n + 1] = {C_POP: "（注）1．合計、全国計は単純平均である。"}
    if extra:
        rows.update(extra)
    return rows


SAMPLE = [
    ("01100", "札幌市", 1955678, 1121.26, 1229157420),
    ("13101", "千代田区", 66680, 11.66, 70000000),
    ("30206", "田辺市", 67316, 1026.89, 45807592),
]


class TestParser(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def path(self, rows) -> str:
        p = os.path.join(self.tmp.name, "w.xlsx")
        write_xlsx(p, rows)
        return p

    def test_reads_the_rows_by_header_text_and_skips_headings_subtotals_and_notes(self):
        total = (sum(d[2] for d in SAMPLE), sum(d[4] for d in SAMPLE))
        ov = bf.parse_overview(self.path(fixture_rows(SAMPLE, national=total)))
        self.assertEqual([(m.code, m.name, m.population, m.area_km2, m.expenditure) for m in ov.rows], SAMPLE)
        self.assertEqual(ov.national, total)

    def test_the_code_is_the_first_five_digits_and_the_name_is_kept(self):
        ov = bf.parse_overview(self.path(fixture_rows(SAMPLE)))
        self.assertEqual(ov.rows[2].code, "30206")
        self.assertEqual(code6("30206")[:5], "30206")
        self.assertIsNone(ov.national)

    def test_a_workbook_without_a_national_row_is_accepted_but_one_with_wrong_sums_is_not(self):
        ov = bf.parse_overview(self.path(fixture_rows(SAMPLE)))
        bf.check_against_national(ov, "fixture")  # nothing to compare: no error
        wrong = (sum(d[2] for d in SAMPLE) + 1, sum(d[4] for d in SAMPLE))
        ov = bf.parse_overview(self.path(fixture_rows(SAMPLE, national=wrong)))
        with self.assertRaises(bf.ParseError):
            bf.check_against_national(ov, "fixture")
        wrong = (sum(d[2] for d in SAMPLE), sum(d[4] for d in SAMPLE) - 1)
        ov = bf.parse_overview(self.path(fixture_rows(SAMPLE, national=wrong)))
        with self.assertRaises(bf.ParseError):
            bf.check_against_national(ov, "fixture")

    def test_a_wrong_check_digit_stops_the_build(self):
        rows = fixture_rows(SAMPLE)
        bad = rows[15][C_CODE]
        rows[15][C_CODE] = bad[:5] + str((int(bad[5]) + 1) % 10)
        with self.assertRaisesRegex(bf.ParseError, "check digit"):
            bf.parse_overview(self.path(rows))

    def test_a_municipality_twice_stops_the_build(self):
        with self.assertRaisesRegex(bf.ParseError, "twice"):
            bf.parse_overview(self.path(fixture_rows(SAMPLE + [SAMPLE[0]])))

    def test_a_missing_or_doubled_header_stops_the_build(self):
        rows = fixture_rows(SAMPLE)
        del rows[10][C_EXP]
        with self.assertRaisesRegex(bf.ParseError, "歳出総額"):
            bf.parse_overview(self.path(rows))
        rows = fixture_rows(SAMPLE)
        rows[11][C_EXP + 3] = "歳出総額"
        with self.assertRaisesRegex(bf.ParseError, "歳出総額"):
            bf.parse_overview(self.path(rows))
        rows = fixture_rows(SAMPLE)
        del rows[10][C_CODE]
        with self.assertRaisesRegex(bf.ParseError, "団体コード"):
            bf.parse_overview(self.path(rows))

    def test_a_row_that_is_not_a_positive_whole_amount_stops_the_build(self):
        for index, value, pattern in [(C_POP, 0, "non-positive"), (C_EXP, 0, "non-positive"), (C_AREA, 0, "non-positive"),
                                      (C_POP, 10.5, "whole number"), (C_EXP, "-", "not a number"), (C_POP, "", "not a number")]:
            rows = fixture_rows(SAMPLE)
            rows[16][index] = value
            with self.subTest(column=index, value=value):
                with self.assertRaisesRegex(bf.ParseError, pattern):
                    bf.parse_overview(self.path(rows))

    def test_a_sheet_without_municipalities_stops_the_build(self):
        with self.assertRaisesRegex(bf.ParseError, "no municipality"):
            bf.parse_overview(self.path(fixture_rows([])))


class TestStatistics(unittest.TestCase):
    def test_check_digit_known_codes(self):
        self.assertEqual(bf.check_digit("01100"), 2)  # 札幌市 011002
        self.assertEqual(bf.check_digit("01202"), 5)  # 函館市 012025
        self.assertEqual(bf.check_digit("30206"), int(code6("30206")[5]))

    def test_round_half_up_rounds_once_and_halves_go_up(self):
        self.assertEqual(bf.round_half_up(0.5), 1)
        self.assertEqual(bf.round_half_up(2.5), 3)  # round() would give 2
        self.assertEqual(bf.round_half_up(680.4859), 680)
        self.assertEqual(bf.round_half_up(680.5), 681)

    def test_quantile_exclusive_matches_the_standard_library_quartiles(self):
        rng = random.Random(7)
        for n in (3, 4, 5, 9, 10, 51, 132):
            values = [rng.uniform(300, 3000) for _ in range(n)]
            q = statistics.quantiles(values, n=4, method="exclusive")
            for p, expected in zip((0.25, 0.5, 0.75), q):
                self.assertAlmostEqual(bf.quantile_exclusive(values, p), expected, places=9, msg=f"n={n} p={p}")
        # With very few values the standard library extrapolates past the data; this one stays inside it.
        self.assertEqual(bf.quantile_exclusive([10, 20], 0.25), 10)
        self.assertEqual(bf.quantile_exclusive([10, 20], 0.75), 20)
        self.assertEqual(bf.quantile_exclusive([5, 1, 3], 0.5), 3)
        self.assertEqual(bf.quantile_exclusive([10, 20, 30, 40], 0.5), 25)
        self.assertEqual(bf.quantile_exclusive([10, 20, 30, 40], 0.25), 12.5)
        with self.assertRaises(ValueError):
            bf.quantile_exclusive([], 0.5)

    def test_band_index_boundaries(self):
        cases = {0: 0, 1: 0, 4999: 0, 5000: 1, 9999: 1, 10000: 2, 29999: 2, 30000: 3, 49999: 3, 50000: 4,
                 99999: 4, 100000: 5, 199999: 5, 200000: 6, 3000000: 6}
        for population, expected in cases.items():
            self.assertEqual(bf.band_index(population), expected, population)

    def test_bands_count_and_summarise_each_band(self):
        def m(code, pop, per):  # a municipality spending `per` thousand yen per resident
            return bf.Municipality(code, "x", pop, 1.0, pop * per)

        rows = [m("00001", 100, 1000), m("00002", 4999, 2000), m("00003", 5000, 800), m("00004", 5001, 900),
                m("00005", 5002, 1000), m("00006", 5003, 1100), m("00007", 250000, 480)]
        bands = bf.build_bands(rows, edges=(0, 5000, 200000))
        self.assertEqual([(b["min"], b["max"], b["n"]) for b in bands], [(0, 5000, 2), (5000, 200000, 4), (200000, None, 1)])
        self.assertEqual((bands[0]["median"], bands[0]["p25"], bands[0]["p75"]), (1500, 1000, 2000))
        self.assertEqual((bands[1]["median"], bands[1]["p25"], bands[1]["p75"]), (950, 825, 1075))  # values 800..1100: median (900+1000)/2, quartiles at positions 1.25 and 3.75
        self.assertEqual((bands[2]["median"], bands[2]["p25"], bands[2]["p75"]), (480, 480, 480))

    def test_an_empty_band_stops_the_build(self):
        with self.assertRaises(bf.ParseError):
            bf.build_bands([bf.Municipality("00001", "x", 100, 1.0, 1000)], edges=(0, 5000))


class TestBuild(unittest.TestCase):
    def test_document_shape_and_values(self):
        rows = tuple(bf.Municipality(c, n, p, a, e) for c, n, p, a, e in SAMPLE)
        doc = bf.build([bf.Overview(rows[:2], None), bf.Overview(rows[2:], None)], edges=(0, 100000))
        self.assertEqual(doc["fiscalYear"], 2024)
        self.assertEqual(doc["populationDate"], "2025-01-01")
        self.assertEqual(doc["unit"], "千円/人")
        self.assertEqual(sorted(doc["municipalities"]), ["01100", "13101", "30206"])
        self.assertEqual(doc["municipalities"]["30206"], [680, 67316])  # 45,807,592 / 67,316 = 680.49
        self.assertEqual(doc["municipalities"]["01100"], [629, 1955678])
        total_pop = sum(r.population for r in rows)
        total_exp = sum(r.expenditure for r in rows)
        self.assertEqual(doc["national"], {"n": 3, "perCapita": bf.round_half_up(total_exp / total_pop), "population": total_pop, "expenditure": total_exp})

    def test_a_municipality_in_both_workbooks_stops_the_build(self):
        row = bf.Municipality("30206", "田辺市", 67316, 1026.89, 45807592)
        with self.assertRaises(bf.ParseError):
            bf.build([bf.Overview((row,), None), bf.Overview((row,), None)], edges=(0,))

    def test_the_output_is_compact_sorted_by_code_and_ends_with_one_newline(self):
        rows = tuple(bf.Municipality(c, n, p, a, e) for c, n, p, a, e in reversed(SAMPLE))
        text = bf.dump(bf.build([bf.Overview(rows, None)], edges=(0,)))
        self.assertTrue(text.endswith("}\n"))
        self.assertNotIn(": ", text)
        self.assertLess(text.index('"01100"'), text.index('"13101"'))
        self.assertLess(text.index('"13101"'), text.index('"30206"'))

    def test_the_published_rows_are_the_four_groups_of_the_white_paper_table(self):
        self.assertEqual(dict(bf.PUBLISHED_ROWS), {"中都市": 454, "小都市": 567, "町村（人口1万人以上）": 581, "町村（人口1万人未満）": 1237})
        self.assertEqual(bf.PUBLISHED_FISCAL_YEAR, 2023)


RAW_FILES = [os.path.join(bf.RAW_DIR, f) for f, _u, _d in bf.WORKBOOKS]
HAVE_RAW = all(os.path.exists(p) for p in RAW_FILES)


@unittest.skipUnless(HAVE_RAW, "data/raw/finance is empty: run `python3 -m pipeline.build_finance` first")
class TestRealData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.overviews = [bf.parse_overview(p) for p in RAW_FILES]
        for ov, p in zip(cls.overviews, RAW_FILES):
            bf.check_against_national(ov, os.path.basename(p))
        cls.doc = bf.build(cls.overviews)

    def test_both_workbooks_add_up_to_their_own_national_rows(self):
        self.assertEqual(self.overviews[0].national, (114139458, 61157309360))
        self.assertEqual(self.overviews[1].national, (10191232, 7951913768))
        self.assertEqual(len(self.overviews[0].rows) + len(self.overviews[1].rows), 1741)

    def test_the_seven_bands_reproduce_the_research_table(self):
        got = [(b["n"], b["median"], b["p25"], b["p75"]) for b in self.doc["bands"]]
        self.assertEqual(got, [(302, 1733, 1390, 2353), (241, 1001, 783, 1332), (447, 724, 561, 883), (237, 584, 473, 690),
                               (237, 502, 436, 599), (145, 473, 428, 556), (132, 477, 428, 530)])
        self.assertEqual(sum(b["n"] for b in self.doc["bands"]), 1741)

    def test_the_national_figure_and_a_town(self):
        self.assertEqual(self.doc["national"]["perCapita"], 556)
        self.assertEqual(self.doc["municipalities"]["30206"], [680, 67316])  # 田辺市

    def test_the_app_areas_are_covered_except_designated_city_wards_and_the_hamadori_area(self):
        areas = []
        areas_dir = os.path.join(ROOT, "public", "data", "areas")
        for f in sorted(os.listdir(areas_dir)):
            with open(os.path.join(areas_dir, f), encoding="utf-8") as fh:
                areas += json.load(fh)
        with open(os.path.join(ROOT, "public", "data", "groups.json"), encoding="utf-8") as fh:
            ward_codes = {w for ws in json.load(fh)["cities"].values() for w in ws}
        missing = {a["code"] for a in areas if a["code"] not in self.doc["municipalities"]}
        self.assertEqual(missing, ward_codes | {"07999"})
        self.assertEqual(len(ward_codes), 175)

    def test_the_committed_json_is_what_the_script_builds(self):
        with open(COMMITTED, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), bf.dump(self.doc))

    def test_the_file_is_small(self):
        self.assertLess(os.path.getsize(COMMITTED), 150 * 1024)


if __name__ == "__main__":
    unittest.main()
