"""Tests for the facility population-threshold table (MLIT chart, metro areas excluded)."""
import json
import os
import re
import unittest

from pipeline import build_facilities

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TYPES_TS = os.path.join(ROOT, "src", "engine", "types.ts")

# Facilities the app treats as "essential" (Task 6 uses this flag).
ESSENTIAL_IDS = {
    "clinic",
    "post_office",
    "grocery",
    "general_hospital",
    "bank",
    "nursing_home",
    "day_care",
    "home_help",
}


def by_id():
    return {f["id"]: f for f in build_facilities.build()}


def facility_interface_fields():
    """Read the field names and TypeScript types of `interface Facility` from the shared types file."""
    with open(TYPES_TS, encoding="utf-8") as fh:
        text = fh.read()
    match = re.search(r"export interface Facility \{(.*?)\n\}", text, re.S)
    assert match, "interface Facility not found in src/engine/types.ts"
    fields = {}
    for line in match.group(1).splitlines():
        line = line.split("//")[0].strip()
        m = re.match(r"(\w+)\s*:\s*(\w+);?$", line)
        if m:
            fields[m.group(1)] = m.group(2)
    return fields


class TestTranscribedValues(unittest.TestCase):
    def test_clinic(self):
        self.assertEqual(by_id()["clinic"]["p50"], 500)

    def test_hospital(self):
        h = by_id()["general_hospital"]
        self.assertEqual((h["p50"], h["p80"]), (5500, 27500))

    def test_cinema(self):
        c = by_id()["cinema"]
        self.assertEqual((c["p50"], c["p80"]), (87500, 175000))

    def test_single_value_rows_have_equal_p50_p80(self):
        f = by_id()
        for key in ("clinic", "post_office", "grocery", "restaurant", "hotel", "department_store"):
            self.assertEqual(f[key]["p50"], f[key]["p80"], key)

    def test_values_read_from_the_chart_image(self):
        expected = {
            "dental_clinic": (500, 2500),
            "stationery_books": (1500, 2500),
            "nursing_home": (500, 4500),
            "bank": (6500, 9500),
            "day_care": (6500, 9500),
            "home_help": (8500, 27500),
            "care_health_facility": (9500, 22500),
            "emergency_hospital": (17500, 37500),
            "university": (125000, 175000),
            "regional_support_hospital": (97500, 225000),
            "critical_care_center": (175000, 275000),
            "advanced_hospital": (225000, 375000),
            "shopping_center": (77500, 92500),
            "department_store": (275000, 275000),
        }
        f = by_id()
        for key, (p50, p80) in expected.items():
            self.assertEqual((f[key]["p50"], f[key]["p80"]), (p50, p80), key)

    def test_every_chart_row_is_present(self):
        # 48 facility rows are printed in the chart on page 3 of the MLIT PDF.
        self.assertEqual(len(build_facilities.build()), 48)

    def test_names_are_the_printed_japanese_labels(self):
        f = by_id()
        self.assertEqual(f["clinic"]["name"], "一般診療所")
        self.assertEqual(f["general_hospital"]["name"], "一般病院")
        self.assertEqual(f["day_care"]["name"], "通所・短期入所介護事業")


class TestInvariants(unittest.TestCase):
    def test_all_have_source(self):
        for f in build_facilities.build():
            self.assertTrue(f["source"].strip(), f["id"])
            self.assertIn("三大都市圏を除く", f["source"], f["id"])
            self.assertIn("https://www.mlit.go.jp/common/001042019.pdf", f["source"], f["id"])

    def test_p50_le_p80(self):
        for f in build_facilities.build():
            self.assertLessEqual(f["p50"], f["p80"], f["id"])

    def test_p50_positive(self):
        for f in build_facilities.build():
            self.assertGreater(f["p50"], 0, f["id"])

    def test_ids_unique_ascii_slugs(self):
        ids = [f["id"] for f in build_facilities.build()]
        self.assertEqual(len(ids), len(set(ids)))
        for i in ids:
            self.assertRegex(i, r"^[a-z][a-z0-9_]*$")

    def test_names_unique_and_non_empty(self):
        names = [f["name"] for f in build_facilities.build()]
        self.assertEqual(len(names), len(set(names)))
        self.assertTrue(all(n.strip() for n in names))

    def test_essential_set(self):
        essential = {f["id"] for f in build_facilities.build() if f["essential"]}
        self.assertEqual(essential, ESSENTIAL_IDS)

    def test_excludes_metro_is_true(self):
        for f in build_facilities.build():
            self.assertIs(f["excludesMetro"], True, f["id"])


class TestJsonFile(unittest.TestCase):
    def load(self):
        with open(build_facilities.OUT_PATH, encoding="utf-8") as fh:
            return json.load(fh)

    def test_committed_json_matches_build(self):
        self.assertEqual(self.load(), build_facilities.build())

    def test_json_is_compact_utf8_without_escapes(self):
        with open(build_facilities.OUT_PATH, "rb") as fh:
            raw = fh.read()
        text = raw.decode("utf-8")
        self.assertIn("一般診療所", text)  # ensure_ascii=False
        self.assertNotIn("\\u", text)
        self.assertNotIn('": ', text)  # compact separators
        self.assertNotIn('", "', text)
        self.assertNotIn("\n ", text)

    def test_json_conforms_to_facility_interface(self):
        fields = facility_interface_fields()
        self.assertEqual(
            set(fields), {"id", "name", "p50", "p80", "essential", "excludesMetro", "source"}
        )
        rows = self.load()
        self.assertIsInstance(rows, list)
        self.assertGreater(len(rows), 0)
        for row in rows:
            self.assertEqual(set(row), set(fields), row.get("id"))
            for key, ts_type in fields.items():
                value = row[key]
                if ts_type == "string":
                    self.assertIsInstance(value, str, key)
                elif ts_type == "number":
                    self.assertIsInstance(value, (int, float), key)
                    self.assertNotIsInstance(value, bool, key)
                elif ts_type == "boolean":
                    self.assertIsInstance(value, bool, key)
                elif ts_type == "true":
                    self.assertIs(value, True, key)
                else:
                    self.fail(f"unhandled TypeScript type {ts_type!r} for {key}")


if __name__ == "__main__":
    unittest.main()
