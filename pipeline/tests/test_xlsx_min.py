"""Tests for the minimal xlsx reader, using the real IPSS file in data/raw."""
import os
import unittest

from pipeline import xlsx_min

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SUIKEI = os.path.join(ROOT, "data", "raw", "suikei_kekka.xlsx")


class TestXlsxMin(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.path.exists(SUIKEI):
            raise FileNotFoundError(
                f"{SUIKEI} is missing: run `python3 -m pipeline.fetch_sources` first"
            )

    def test_reads_hokkaido_2020_total(self):
        found = None
        for number, row in xlsx_min.rows(SUIKEI):
            if number == 6:
                found = row
                break
        self.assertIsNotNone(found, "row 6 not found")
        self.assertEqual(found[0], "1000")
        self.assertEqual(found[2], "北海道")
        self.assertEqual(found[4], "2020年")
        self.assertEqual(found[5], "5224614")

    def test_sheets_lists_name_and_target(self):
        sheets = xlsx_min.sheets(SUIKEI)
        self.assertGreaterEqual(len(sheets), 1)
        name, target = sheets[0]
        self.assertIsInstance(name, str)
        self.assertTrue(target.endswith(".xml"))


if __name__ == "__main__":
    unittest.main()
