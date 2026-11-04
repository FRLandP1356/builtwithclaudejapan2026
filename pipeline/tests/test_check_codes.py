"""Tests for the municipal boundary layers (public/data/geo) and pipeline.check_codes.

Two groups:
  * synthetic tests of the reconcile-document parser and the comparison logic;
  * checks of the shipped TopoJSON against index.json (the real build output).
The shipped-output tests need no raw downloads: they read only committed files.
"""
import json
import os
import re
import unittest

from pipeline import build_geometry as bg
from pipeline import check_codes as cc

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEO = os.path.join(ROOT, "public", "data", "geo")
AREAS = os.path.join(ROOT, "public", "data", "areas")

PREF_CODES = [f"{i:02d}" for i in range(1, 48)]
HAMADORI_CODE = "07999"
HAMADORI_N03_CODES = [
    "07204", "07209", "07212", "07541", "07542", "07543", "07544",
    "07545", "07546", "07547", "07548", "07561", "07564",
]
# Hokkaido and Okinawa have many islands and may use the larger budget.
BIG_PREFS = {"01", "47"}
BUDGET = 300_000
BIG_BUDGET = 600_000

SAMPLE_DOC = """# t

## A. 境界のない社人研の地域

| コード | 名前 | 理由 | 対応 |
|---|---|---|---|
| 99001 | 仮の町 | 例 | 例 |

## B. 社人研にない境界

| コード | 名前 | 理由 | 対応 |
|---|---|---|---|
| 01695 | 色丹村 | 北方領土 | 取り除いた |
| なし | 所属未定地 | コードなし | 取り除いた |

## C. 浜通り

| コード | 名前 | 理由 | 対応 |
|---|---|---|---|
| 07204 | いわき市 | まとめた | 07999 |
"""


class TestParseReconcile(unittest.TestCase):
    def test_sections_and_codes(self):
        doc = cc.parse_reconcile(SAMPLE_DOC)
        self.assertEqual(set(doc.no_polygon), {"99001"})
        self.assertEqual(set(doc.removed), {"01695"})
        self.assertEqual(set(doc.merged), {"07204"})

    def test_non_code_rows_are_kept_as_labels_not_codes(self):
        doc = cc.parse_reconcile(SAMPLE_DOC)
        self.assertTrue(any("所属未定地" in label for label in doc.removed_labels))
        self.assertNotIn("なし", doc.removed)

    def test_header_and_separator_rows_are_ignored(self):
        doc = cc.parse_reconcile(SAMPLE_DOC)
        self.assertNotIn("コード", doc.no_polygon)
        self.assertNotIn("---", doc.no_polygon)


class TestCompare(unittest.TestCase):
    def doc(self, no_polygon=()):
        return cc.Reconcile(
            no_polygon={c: "x" for c in no_polygon}, removed={}, removed_labels={}, merged={}
        )

    def test_clean(self):
        r = cc.compare({"a1", "a2"}, {"a1", "a2"}, self.doc())
        self.assertEqual(r.problems(), [])

    def test_undocumented_missing_polygon_is_reported(self):
        r = cc.compare({"a1", "a2"}, {"a1"}, self.doc())
        self.assertEqual(r.missing_polygon, ["a2"])
        self.assertTrue(r.problems())

    def test_documented_missing_polygon_is_allowed(self):
        r = cc.compare({"a1", "a2"}, {"a1"}, self.doc(no_polygon=["a2"]))
        self.assertEqual(r.problems(), [])

    def test_stale_documented_exception_is_reported(self):
        # documented as missing, but the polygon exists
        r = cc.compare({"a1", "a2"}, {"a1", "a2"}, self.doc(no_polygon=["a2"]))
        self.assertEqual(r.stale_exceptions, ["a2"])
        self.assertTrue(r.problems())

    def test_polygon_without_area_is_reported(self):
        r = cc.compare({"a1"}, {"a1", "zz"}, self.doc())
        self.assertEqual(r.extra_polygon, ["zz"])
        self.assertTrue(r.problems())


class TestPlanFeatures(unittest.TestCase):
    """The pure part of the build: which N03 polygon pieces are kept, merged or removed."""

    IPSS = {"01101": "札幌市中央区", "07201": "福島市", "07999": "浜通り地域"}

    @staticmethod
    def piece(code, name, city=None, pref="福島県"):
        return {
            "type": "Feature",
            "properties": {"N03_001": pref, "N03_002": None, "N03_003": city, "N03_004": name, "N03_007": code},
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
        }

    def test_kept_pieces_carry_the_ipss_code_and_name(self):
        plan = bg.plan_features([self.piece("07201", "福島市"), self.piece("01101", "中央区", city="札幌市")], self.IPSS)
        self.assertEqual(
            [f["properties"] for f in plan.kept],
            [{"code": "07201", "name": "福島市"}, {"code": "01101", "name": "札幌市中央区"}],
        )

    def test_hamadori_municipalities_all_get_07999(self):
        pieces = [self.piece(c, "n") for c in sorted(bg.HAMADORI_N03_CODES)] + [self.piece("07204", "いわき市")]
        plan = bg.plan_features(pieces, self.IPSS)
        self.assertEqual({f["properties"]["code"] for f in plan.kept}, {"07999"})
        self.assertEqual({f["properties"]["name"] for f in plan.kept}, {"浜通り地域"})
        self.assertEqual(sorted(plan.merged), sorted(bg.HAMADORI_N03_CODES))
        self.assertEqual(plan.merged["07204"][1], 2)  # two pieces of いわき市
        self.assertEqual(plan.removed, {})

    def test_exactly_13_hamadori_codes(self):
        self.assertEqual(len(bg.HAMADORI_N03_CODES), 13)
        self.assertTrue(all(c.startswith("07") and len(c) == 5 for c in bg.HAMADORI_N03_CODES))

    def test_polygon_without_an_ipss_area_is_removed_and_counted(self):
        plan = bg.plan_features([self.piece("01695", "色丹村", pref="北海道")] * 3, self.IPSS)
        self.assertEqual(plan.kept, [])
        self.assertEqual(plan.removed, {"01695": ("色丹村", 3)})

    def test_pieces_with_no_code_are_unassigned_by_prefecture(self):
        plan = bg.plan_features(
            [self.piece(None, "所属未定地", pref="東京都"), self.piece(None, "所属未定地", pref="東京都"),
             self.piece(None, "所属未定地", pref="愛知県")],
            self.IPSS,
        )
        self.assertEqual(plan.kept, [])
        self.assertEqual(plan.unassigned, {"東京都": 2, "愛知県": 1})

    def test_hamadori_is_not_merged_when_ipss_has_no_such_area(self):
        plan = bg.plan_features([self.piece("07204", "いわき市")], {"07201": "福島市"})
        self.assertEqual(plan.merged, {})
        self.assertEqual(sorted(plan.removed), ["07204"])

    def test_n03_name_adds_the_designated_city_only_for_wards(self):
        self.assertEqual(bg.n03_name({"N03_003": "札幌市", "N03_004": "北区"}), "札幌市北区")
        self.assertEqual(bg.n03_name({"N03_003": "伊達郡", "N03_004": "桑折町"}), "桑折町")
        self.assertEqual(bg.n03_name({"N03_003": None, "N03_004": "福島市"}), "福島市")

    def test_ladder_only_goes_down_from_the_start(self):
        ladder = bg.ladder_from(5)
        self.assertEqual(ladder[0], 5)
        self.assertEqual(ladder, sorted(ladder, reverse=True))
        self.assertEqual(bg.ladder_from(2)[0], 2)


class TestVerifyAgainstDocument(unittest.TestCase):
    """The build refuses to finish when docs/geometry-reconcile.md disagrees with what it saw."""

    UNASSIGNED_PREFS = ["東京都", "愛知県", "沖縄県", "千葉県", "鹿児島県", "福岡県", "和歌山県"]

    def setUp(self):
        self.doc = cc.read_reconcile()
        self.names = {a["code"]: a["name"] for a in cc.read_index()}

    def plan_like_the_document(self):
        plan = bg.Plan()
        plan.removed = {c: ("x", 1) for c in self.doc.removed}
        plan.merged = {c: ("x", 1) for c in self.doc.merged}
        plan.unassigned = {pref: 1 for pref in self.UNASSIGNED_PREFS}
        return plan

    def test_a_plan_that_matches_the_document_has_no_problems(self):
        problems = bg.verify_against_document(self.plan_like_the_document(), self.doc, self.names, set(self.names))
        self.assertEqual(problems, [])

    def test_an_undocumented_removal_is_a_problem(self):
        plan = self.plan_like_the_document()
        plan.removed["99999"] = ("x", 1)
        problems = bg.verify_against_document(plan, self.doc, self.names, set(self.names))
        self.assertTrue(any("removed" in p for p in problems), problems)

    def test_an_undocumented_unassigned_prefecture_is_a_problem(self):
        plan = self.plan_like_the_document()
        plan.unassigned["北海道"] = 1
        problems = bg.verify_against_document(plan, self.doc, self.names, set(self.names))
        self.assertTrue(any("北海道" in p for p in problems), problems)

    def test_a_missing_polygon_is_a_problem_unless_documented(self):
        covered = set(self.names) - {"01101"}
        problems = bg.verify_against_document(self.plan_like_the_document(), self.doc, self.names, covered)
        self.assertTrue(any("01101" in p for p in problems), problems)


class TestShippedGeometry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(ROOT, "public", "data", "index.json"), encoding="utf-8") as fh:
            cls.index = json.load(fh)
        cls.doc = cc.read_reconcile()

    # -- prefecture layer ---------------------------------------------------
    def test_prefecture_layer_has_47(self):
        props = cc.read_prefectures()
        self.assertEqual(len(props), 47)
        self.assertEqual([p["code"] for p in props], PREF_CODES)

    def test_prefecture_names_match_ipss_pref_names(self):
        names = {}
        for pp in PREF_CODES:
            with open(os.path.join(AREAS, f"{pp}.json"), encoding="utf-8") as fh:
                names[pp] = json.load(fh)[0]["prefName"]
        got = {p["code"]: p["name"] for p in cc.read_prefectures()}
        self.assertEqual(got, names)

    def test_prefecture_layer_object_name_and_geometry(self):
        topo = cc.read_topology(os.path.join(GEO, "japan.topo.json"))
        self.assertEqual(list(topo["objects"]), ["prefectures"])
        for g in topo["objects"]["prefectures"]["geometries"]:
            self.assertIn(g["type"], ("Polygon", "MultiPolygon"))
            self.assertTrue(g["arcs"], g["properties"])

    # -- municipal layers ---------------------------------------------------
    def test_all_47_prefecture_files_present_and_non_empty(self):
        for pp in PREF_CODES:
            path = os.path.join(GEO, "pref", f"{pp}.topo.json")
            self.assertTrue(os.path.exists(path), path)
            topo = cc.read_topology(path)
            self.assertEqual(list(topo["objects"]), ["areas"], pp)
            self.assertGreater(len(topo["objects"]["areas"]["geometries"]), 0, pp)

    def test_every_leaf_area_has_a_polygon(self):
        polygon_codes = {c for codes in cc.read_pref_codes().values() for c in codes}
        index_codes = {a["code"] for a in self.index}
        missing = sorted(index_codes - polygon_codes)
        undocumented = [c for c in missing if c not in self.doc.no_polygon]
        self.assertEqual(undocumented, [], "IPSS areas without a polygon and not in docs/geometry-reconcile.md")

    def test_documented_exceptions_are_real(self):
        polygon_codes = {c for codes in cc.read_pref_codes().values() for c in codes}
        index_codes = {a["code"] for a in self.index}
        report = cc.compare(index_codes, polygon_codes, self.doc)
        self.assertEqual(report.problems(), [])

    def test_no_polygon_without_an_ipss_area(self):
        polygon_codes = {c for codes in cc.read_pref_codes().values() for c in codes}
        index_codes = {a["code"] for a in self.index}
        self.assertEqual(sorted(polygon_codes - index_codes), [])

    def test_every_feature_code_is_a_5_digit_string(self):
        for pp, codes in cc.read_pref_codes().items():
            for c in codes:
                self.assertIsInstance(c, str, (pp, c))
                self.assertRegex(c, r"^\d{5}$", (pp, c))

    def test_feature_codes_start_with_the_file_prefecture(self):
        for pp, codes in cc.read_pref_codes().items():
            for c in codes:
                self.assertEqual(c[:2], pp, (pp, c))

    def test_no_duplicate_codes(self):
        for pp, codes in cc.read_pref_codes().items():
            self.assertEqual(len(codes), len(set(codes)), pp)

    def test_every_feature_has_name_and_arcs(self):
        for pp in PREF_CODES:
            topo = cc.read_topology(os.path.join(GEO, "pref", f"{pp}.topo.json"))
            for g in topo["objects"]["areas"]["geometries"]:
                self.assertEqual(sorted(g["properties"]), ["code", "name"], (pp, g["properties"]))
                self.assertTrue(g["properties"]["name"], (pp, g["properties"]))
                self.assertIn(g["type"], ("Polygon", "MultiPolygon"), (pp, g["properties"]))
                self.assertTrue(g["arcs"], (pp, g["properties"]))

    def test_names_match_index(self):
        names = {a["code"]: a["name"] for a in self.index}
        for pp, props in cc.read_pref_properties().items():
            for p in props:
                self.assertEqual(p["name"], names[p["code"]], (pp, p))

    # -- Fukushima 浜通り -----------------------------------------------------
    def test_hamadori_is_one_feature_exactly_once(self):
        all_codes = [c for codes in cc.read_pref_codes().values() for c in codes]
        self.assertEqual(all_codes.count(HAMADORI_CODE), 1)
        self.assertIn(HAMADORI_CODE, cc.read_pref_codes()["07"])

    def test_hamadori_member_codes_are_not_separate_features(self):
        all_codes = set(c for codes in cc.read_pref_codes().values() for c in codes)
        self.assertEqual(sorted(all_codes & set(HAMADORI_N03_CODES)), [])

    def test_fukushima_has_47_features(self):
        # 59 N03 municipalities - 13 hamadori + 1 merged area = 47
        self.assertEqual(len(cc.read_pref_codes()["07"]), 47)

    def test_reconcile_doc_lists_the_13_hamadori_municipalities(self):
        self.assertEqual(sorted(self.doc.merged), sorted(HAMADORI_N03_CODES))

    # -- sizes ----------------------------------------------------------------
    def test_japan_topology_within_budget(self):
        size = os.path.getsize(os.path.join(GEO, "japan.topo.json"))
        self.assertLessEqual(size, BUDGET, f"japan.topo.json is {size} bytes")

    def test_prefecture_files_within_budget(self):
        for pp in PREF_CODES:
            size = os.path.getsize(os.path.join(GEO, "pref", f"{pp}.topo.json"))
            limit = BIG_BUDGET if pp in BIG_PREFS else BUDGET
            self.assertLessEqual(size, limit, f"{pp}.topo.json is {size} bytes")


class TestReconcileDocument(unittest.TestCase):
    def test_document_exists_and_has_all_three_sections(self):
        with open(cc.RECONCILE_MD, encoding="utf-8") as fh:
            text = fh.read()
        for letter in "ABC":
            self.assertRegex(text, rf"(?m)^## {letter}\.", letter)

    def test_removed_northern_territories_are_documented(self):
        doc = cc.read_reconcile()
        self.assertEqual(
            sorted(doc.removed),
            ["01695", "01696", "01697", "01698", "01699", "01700"],
        )

    def test_unassigned_areas_are_documented(self):
        doc = cc.read_reconcile()
        self.assertTrue(any("所属未定地" in label for label in doc.removed_labels))


if __name__ == "__main__":
    unittest.main()
