"""Zip-slip tests for build_geometry: archive member names are checked before anything is read.

All archives are crafted in memory; no raw downloads are needed.
"""
import io
import json
import os
import tempfile
import unittest
import zipfile

from pipeline import build_geometry as bg

GEOJSON = json.dumps({"type": "FeatureCollection", "features": [{"properties": {"N03_007": "30201"}}]})


def make_zip(names, geojson_name="N03_GML/N03.geojson"):
    """An in-memory zip with the given member names (plus a valid GeoJSON member)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(zipfile.ZipInfo(geojson_name), GEOJSON)
        for n in names:
            zf.writestr(zipfile.ZipInfo(n), "payload")
    buf.seek(0)
    return buf


class TestSafeMemberPath(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dest = os.path.join(self.tmp.name, "extract")

    def test_rejected_names(self):
        bad = [
            "../evil.geojson", "a/../../evil.geojson", "a/b/../../../evil", "..",
            "/etc/passwd", "/abs/evil.geojson",
            "..\\evil.geojson", "dir\\..\\..\\evil", "\\evil", "C:\\evil.geojson", "c:evil",
            "", "nul\x00.geojson",
        ]
        for name in bad:
            with self.subTest(name=name):
                with self.assertRaises(bg.UnsafeArchiveMember):
                    bg.safe_member_path(self.dest, name)

    def test_symlink_inside_the_directory_cannot_lead_outside(self):
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        os.makedirs(self.dest)
        os.symlink(outside, os.path.join(self.dest, "link"))
        with self.assertRaises(bg.UnsafeArchiveMember):
            bg.safe_member_path(self.dest, "link/evil.geojson")

    def test_real_n03_names_pass_and_stay_inside(self):
        # Member names as they appear in the N03 zips: Windows backslashes, no leading separator.
        for name in ["N03-20210101_13_GML\\N03-21_13_210101.geojson", "N03_GML/N03.geojson", "dir/", "./a.txt", "a//b"]:
            with self.subTest(name=name):
                path = bg.safe_member_path(self.dest, name)
                root = os.path.realpath(self.dest)
                self.assertEqual(os.path.commonpath([root, path]), root)

    def test_nothing_is_created(self):
        bg.safe_member_path(self.dest, "a/b.txt")
        self.assertFalse(os.path.exists(self.dest))


class TestReadN03FeaturesRejectsHostileArchives(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.extract_dir = os.path.join(self.tmp.name, "extract")

    def read(self, buf):
        return bg.read_n03_features(buf, extract_dir=self.extract_dir)

    def test_clean_archive_is_read(self):
        feats = self.read(make_zip(["N03_GML/readme.txt"]))
        self.assertEqual(feats, [{"properties": {"N03_007": "30201"}}])

    def test_windows_style_geojson_member_is_read(self):
        feats = self.read(make_zip([], geojson_name="N03-20210101_30_GML\\N03-21_30_210101.geojson"))
        self.assertEqual(len(feats), 1)

    def test_zip_slip_members_reject_the_whole_archive(self):
        for evil in ["../evil.txt", "N03_GML/../../evil.txt", "/tmp/evil.txt", "..\\evil.txt", "C:\\evil.txt"]:
            with self.subTest(member=evil):
                with self.assertRaises(bg.UnsafeArchiveMember):
                    self.read(make_zip([evil]))
                self.assertFalse(os.path.exists(self.extract_dir), "nothing may be written")
                self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "evil.txt")))

    def test_hostile_name_on_the_geojson_member_itself_is_rejected(self):
        with self.assertRaises(bg.UnsafeArchiveMember):
            self.read(make_zip([], geojson_name="../../evil.geojson"))


if __name__ == "__main__":
    unittest.main()
