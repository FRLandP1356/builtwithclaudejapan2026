"""Tests for pipeline.build_areas, run against the real IPSS files in data/raw."""
import json
import os
import re
import tempfile
import unittest

from pipeline import build_areas, xlsx_min

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, "data", "raw")
PUBLIC_DATA = os.path.join(ROOT, "public", "data")
FIXTURE = os.path.join(ROOT, "test", "fixtures", "sample_areas.json")

NO_ASSUMPTION_NAMES = {
    "檜枝岐村", "利島村", "御蔵島村", "青ヶ島村", "粟島浦村", "平谷村", "野迫川村",
    "下北山村", "上北山村", "北山村", "三島村", "座間味村", "渡名喜村",
}
SAMPLE_CODES = ["30206", "30201", "13101", "01101", "13402", "30427"]
OFFICIAL_YEARS = [2025, 2030, 2035, 2040, 2045, 2050]


def total(pop):
    return sum(pop["M"]) + sum(pop["F"])


_BUILT = []


def build_once():
    """Parsing the four workbooks takes a while: do it once per test run."""
    if not _BUILT:
        missing = [f for f in build_areas.SOURCE_FILES.values() if not os.path.exists(os.path.join(RAW, f))]
        if missing:
            raise FileNotFoundError(f"{missing} missing in {RAW}: run `python3 -m pipeline.fetch_sources` first")
        _BUILT.append(build_areas.build(RAW))
    return _BUILT[0]


class TestBuildAreas(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = build_once()
        cls.areas = cls.result.areas
        cls.by_code = {a["code"]: a for a in cls.areas}

    # ---- the five tests named in the brief ----

    def test_leaf_area_count(self):
        self.assertEqual(len(self.areas), 1884)
        self.assertEqual(len(self.by_code), 1884, "area codes must be unique")
        kinds = {a["kind"] for a in self.areas}
        self.assertEqual(kinds, {"ward", "city", "town", "hamadori"})

    def test_codes_are_5_digits(self):
        for a in self.areas:
            self.assertRegex(a["code"], r"^\d{5}$")
            self.assertEqual(a["prefCode"], a["code"][:2])
        self.assertEqual(self.by_code["01101"]["name"], "札幌市中央区")
        self.assertEqual(self.by_code["01101"]["prefCode"], "01")
        self.assertEqual(self.by_code["01101"]["prefName"], "北海道")
        self.assertEqual(self.by_code["01101"]["kind"], "ward")
        # leading zero comes back for the single-digit prefectures too
        self.assertEqual(self.by_code["07364"]["name"], "檜枝岐村")

    def test_tanabe(self):
        a = self.by_code["30206"]
        self.assertEqual(a["name"], "田辺市")
        self.assertEqual(a["prefName"], "和歌山県")
        self.assertEqual(a["kind"], "city")
        # The IPSS workbook prints 42,309 for 2050 (the age cells add up to the same). The 42,311 quoted
        # in the plan is Tanabe city's own population vision (draft, Jan 2025), 2 people higher: we carry IPSS.
        self.assertEqual(a["official"][2050], 42309)
        self.assertAlmostEqual(a["official"][2050], 42311, delta=2)
        self.assertEqual(total(a["base"]), 69870)
        self.assertEqual(len(a["base"]["M"]), 20)
        self.assertEqual(len(a["base"]["F"]), 20)
        self.assertEqual(sorted(a["official"]), OFFICIAL_YEARS)
        self.assertEqual(len(a["assumptions"]), 6)
        self.assertNotIn("officialAges", a)

    def test_no_assumption_areas(self):
        nulls = [a for a in self.areas if a["assumptions"] is None]
        self.assertEqual(len(nulls), 13)
        self.assertEqual({a["name"] for a in nulls}, NO_ASSUMPTION_NAMES)
        for a in nulls:
            self.assertEqual(sorted(a["officialAges"]), OFFICIAL_YEARS, a["name"])
            for year, pop in a["officialAges"].items():
                self.assertEqual(len(pop["M"]), 20)
                self.assertEqual(len(pop["F"]), 20)
                self.assertEqual(total(pop), a["official"][year], f"{a['name']} {year}")
        # everyone else carries no officialAges
        for a in self.areas:
            if a["assumptions"] is not None:
                self.assertNotIn("officialAges", a)

    def test_national_official_2050(self):
        all_total = sum(a["official"][2050] for a in self.areas)
        self.assertAlmostEqual(all_total, 104686386, delta=100)
        with_assumptions = sum(a["official"][2050] for a in self.areas if a["assumptions"] is not None)
        self.assertAlmostEqual(with_assumptions, 104683128, delta=20)
        self.assertEqual(len([a for a in self.areas if a["assumptions"] is not None]), 1871)

    # ---- shape of the assumptions ----

    def test_assumption_shape_and_column_mapping(self):
        a = self.by_code["30206"]
        for p in a["assumptions"]:
            self.assertEqual(set(p), {"surv", "mig", "cwr", "sexRatio"})
            for key in ("surv", "mig"):
                self.assertEqual(len(p[key]["M"]), 19)
                self.assertEqual(len(p[key]["F"]), 19)
            for v in p["surv"]["M"] + p["surv"]["F"]:
                self.assertTrue(0.0 < v <= 1.0, v)
            for v in p["mig"]["M"] + p["mig"]["F"]:
                self.assertTrue(-1.0 < v < 1.0, v)
            self.assertTrue(0.05 < p["cwr"] < 0.6, p["cwr"])
            self.assertTrue(95 < p["sexRatio"] < 115, p["sexRatio"])

    def test_cwr_is_keyed_by_period_end_year(self):
        # The child-women table is keyed by the END year of a period (2025..2050): period
        # 2020->2025 must carry the "2025年" row. Scan the workbook directly, not via build_areas.
        for ipss_code, code in (("30206", "30206"), ("1101", "01101")):
            raw = {}
            for number, row in xlsx_min.rows(os.path.join(RAW, "katei_cwr_0-4sr.xlsx")):
                if number >= 6 and row.get(0) == ipss_code:
                    raw[row[4]] = (float(row[5]), float(row[6]))
            periods = self.by_code[code]["assumptions"]
            for p in range(6):
                cwr, sex_ratio = raw[f"{2025 + 5 * p}年"]
                self.assertEqual(periods[p]["cwr"], build_areas.round6(cwr), (code, p))
                self.assertEqual(periods[p]["sexRatio"], build_areas.round6(sex_ratio), (code, p))
        tanabe = self.by_code["30206"]["assumptions"]
        self.assertNotEqual(tanabe[0]["cwr"], tanabe[5]["cwr"])

    def test_survival_and_migration_are_keyed_by_period_start_year(self):
        # Male = columns 5..23, female = columns 25..43 (0-based); rows read "2020年→2025年" etc.
        for name, key in (("katei_suvr.xlsx", "surv"), ("katei_nmigr.xlsx", "mig")):
            raw = {}
            for number, row in xlsx_min.rows(os.path.join(RAW, name)):
                if number >= 6 and row.get(0) == "30206":
                    raw[row[4]] = (
                        [float(row[c]) for c in range(5, 24)],
                        [float(row[c]) for c in range(25, 44)],
                    )
            periods = self.by_code["30206"]["assumptions"]
            for p in range(6):
                male, female = raw[f"{2020 + 5 * p}年→{2025 + 5 * p}年"]
                self.assertEqual(periods[p][key]["M"], [build_areas.round6(v) for v in male], (key, p))
                self.assertEqual(periods[p][key]["F"], [build_areas.round6(v) for v in female], (key, p))

    def test_floats_have_at_most_six_significant_digits(self):
        for code in SAMPLE_CODES:
            a = self.by_code[code]
            if a["assumptions"] is None:
                continue
            for p in a["assumptions"]:
                values = p["surv"]["M"] + p["surv"]["F"] + p["mig"]["M"] + p["mig"]["F"] + [p["cwr"], p["sexRatio"]]
                for v in values:
                    self.assertEqual(float("%.6g" % v), v)

    def test_populations_are_integers(self):
        for code in SAMPLE_CODES:
            a = self.by_code[code]
            for v in a["base"]["M"] + a["base"]["F"] + list(a["official"].values()):
                self.assertIsInstance(v, int)

    def test_official_totals_match_age_detail(self):
        # sum of the 40 age cells equals the printed total, for every area and year
        for a in self.areas:
            if a["assumptions"] is None:
                for year, pop in a["officialAges"].items():
                    self.assertEqual(total(pop), a["official"][year])

    # ---- groups and index ----

    def test_groups_cities(self):
        cities = self.result.groups["cities"]
        self.assertEqual(len(cities), 20)
        self.assertEqual(cities["01100"], [f"011{n:02d}" for n in range(1, 11)])
        # Kawasaki's wards are 141xx but the city is 14130 (not 14100 = Yokohama): membership follows row order
        self.assertEqual(cities["14130"][0], "14131")
        self.assertEqual(len(cities["14130"]), 7)
        self.assertEqual(len(cities["14100"]), 18)
        members = [w for ws in cities.values() for w in ws]
        self.assertEqual(len(members), len(set(members)), "a ward belongs to one city only")
        for w in members:
            self.assertEqual(self.by_code[w]["kind"], "ward")
        # Tokyo's 23 wards are wards but belong to no designated city
        tokyo_wards = [a["code"] for a in self.areas if a["prefCode"] == "13" and a["kind"] == "ward"]
        self.assertEqual(len(tokyo_wards), 23)
        self.assertTrue(set(tokyo_wards).isdisjoint(members))

    def test_group_totals_equal_ipss_aggregate_rows(self):
        # IPSS prints a total row for each designated city (kind 1) and prefecture (kind a);
        # the group member lists must add up to exactly those rows, in 2020 and 2050.
        agg = self.result.aggregate_official
        for city, wards in self.result.groups["cities"].items():
            self.assertEqual(sum(self.by_code[w]["official"][2050] for w in wards), agg[city][2050], city)
        for pref, codes in self.result.groups["prefs"].items():
            self.assertEqual(sum(self.by_code[c]["official"][2050] for c in codes), agg[pref + "000"][2050], pref)

    def test_groups_prefs(self):
        prefs = self.result.groups["prefs"]
        self.assertEqual(sorted(prefs), [f"{n:02d}" for n in range(1, 48)])
        everyone = [c for codes in prefs.values() for c in codes]
        self.assertEqual(sorted(everyone), sorted(self.by_code), "every leaf area is in exactly one prefecture")
        self.assertIn("07999", prefs["07"])  # Hamadori aggregate
        self.assertNotIn("01100", prefs["01"])  # the Sapporo aggregate is not a leaf area
        for pref, codes in prefs.items():
            for c in codes:
                self.assertTrue(c.startswith(pref))

    def test_index(self):
        index = self.result.index
        self.assertEqual(len(index), 1884)
        self.assertEqual(set(index[0]), {"code", "name", "prefCode", "kind"})
        by_code = {i["code"]: i for i in index}
        self.assertEqual(by_code["30206"], {"code": "30206", "name": "田辺市", "prefCode": "30", "kind": "city"})
        self.assertEqual(by_code["07999"]["kind"], "hamadori")
        self.assertEqual(by_code["07999"]["name"], "浜通り地域")


class TestWriteOutputs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = build_once()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = os.path.join(cls.tmp.name, "data")
        cls.fixture = os.path.join(cls.tmp.name, "fixtures", "sample_areas.json")
        build_areas.write_outputs(cls.result, cls.out, cls.fixture)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_one_file_per_prefecture(self):
        names = sorted(os.listdir(os.path.join(self.out, "areas")))
        self.assertEqual(names, [f"{n:02d}.json" for n in range(1, 48)])
        total_areas = 0
        for name in names:
            with open(os.path.join(self.out, "areas", name), encoding="utf-8") as fh:
                text = fh.read()
            self.assertNotIn("\n", text, "files are compact (no pretty-printing)")
            areas = json.loads(text)
            total_areas += len(areas)
            for a in areas:
                self.assertTrue(re.fullmatch(r"\d{5}", a["code"]))
                self.assertEqual(a["prefCode"] + ".json", name)
        self.assertEqual(total_areas, 1884)

    def test_groups_and_index_files(self):
        with open(os.path.join(self.out, "groups.json"), encoding="utf-8") as fh:
            groups = json.load(fh)
        self.assertEqual(groups, json.loads(json.dumps(self.result.groups)))
        with open(os.path.join(self.out, "index.json"), encoding="utf-8") as fh:
            index = json.load(fh)
        self.assertEqual(len(index), 1884)

    def test_sample_fixture(self):
        with open(self.fixture, encoding="utf-8") as fh:
            sample = json.load(fh)
        self.assertEqual([a["code"] for a in sample], SAMPLE_CODES)
        by_code = {a["code"]: a for a in self.result.areas}
        for a in sample:
            self.assertEqual(a, json.loads(json.dumps(by_code[a["code"]])))
        self.assertIsNone(sample[4]["assumptions"])  # Aogashima
        self.assertIsNone(sample[5]["assumptions"])  # Kitayama village


@unittest.skipUnless(os.path.isdir(PUBLIC_DATA), "generated data not present yet")
class TestCommittedOutputs(unittest.TestCase):
    """The files committed under public/ and test/ must equal a fresh build."""

    @classmethod
    def setUpClass(cls):
        cls.result = build_once()

    def test_committed_files_are_up_to_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "data")
            fixture = os.path.join(tmp, "sample_areas.json")
            build_areas.write_outputs(self.result, out, fixture)
            for rel in sorted(
                os.path.join("areas", n) for n in os.listdir(os.path.join(out, "areas"))
            ) + ["groups.json", "index.json"]:
                with open(os.path.join(out, rel), "rb") as fresh, open(os.path.join(PUBLIC_DATA, rel), "rb") as kept:
                    self.assertEqual(fresh.read(), kept.read(), f"{rel} is stale: run python3 -m pipeline.build_areas")
            with open(fixture, "rb") as fresh, open(FIXTURE, "rb") as kept:
                self.assertEqual(fresh.read(), kept.read(), "sample_areas.json is stale")


if __name__ == "__main__":
    unittest.main()
