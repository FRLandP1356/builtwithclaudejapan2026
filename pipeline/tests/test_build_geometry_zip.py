"""Zip-slip tests for build_geometry: archive member names are checked before anything is read.

All archives are crafted in memory; no raw downloads are needed.
"""
import contextlib
import io
import json
import os
import tempfile
import unittest
import zipfile
from unittest import mock

from pipeline import build_geometry as bg
from pipeline.tests.helpers import snapshot

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

    def test_symlink_to_a_prefix_sibling_directory_cannot_lead_outside(self):
        # extract-evil starts with the text of extract: a startswith() check would wrongly accept it.
        evil = os.path.join(self.tmp.name, "extract-evil")
        os.makedirs(evil)
        os.makedirs(self.dest)
        os.symlink(evil, os.path.join(self.dest, "link"))
        with self.assertRaises(bg.UnsafeArchiveMember):
            bg.safe_member_path(self.dest, "link/evil.geojson")
        with self.assertRaises(bg.UnsafeArchiveMember):
            bg.safe_member_path(self.dest, "link")

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
        before = snapshot(self.tmp.name)
        for evil in ["../evil.txt", "N03_GML/../../evil.txt", "/tmp/evil.txt", "..\\evil.txt", "C:\\evil.txt"]:
            with self.subTest(member=evil):
                with self.assertRaises(bg.UnsafeArchiveMember):
                    self.read(make_zip([evil]))
                self.assertEqual(snapshot(self.tmp.name), before, "nothing may be created, replaced or rewritten")

    def test_names_are_checked_before_anything_is_read(self):
        # With a hostile member present, neither the member count nor any zf.read() may come first.
        with mock.patch.object(zipfile.ZipFile, "read", side_effect=AssertionError("archive read before the names were checked")):
            with self.assertRaises(bg.UnsafeArchiveMember):
                self.read(make_zip(["../evil.txt"]))
        two_geojson = make_zip(["../evil.txt", "N03_GML/second.geojson"])
        with self.assertRaises(bg.UnsafeArchiveMember):      # not "expected one .geojson member"
            self.read(two_geojson)

    def test_the_extract_dir_argument_is_honoured(self):
        # "link" leads out of this extract_dir but means nothing under the default (WORK_DIR).
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        os.makedirs(self.extract_dir)
        os.symlink(outside, os.path.join(self.extract_dir, "link"))
        self.assertEqual(len(bg.read_n03_features(make_zip(["link/payload.txt"]))), 1)
        before = snapshot(self.tmp.name)
        with self.assertRaises(bg.UnsafeArchiveMember):
            bg.read_n03_features(make_zip(["link/payload.txt"]), extract_dir=self.extract_dir)
        self.assertEqual(snapshot(self.tmp.name), before)

    def test_hostile_name_on_the_geojson_member_itself_is_rejected(self):
        with self.assertRaises(bg.UnsafeArchiveMember):
            self.read(make_zip([], geojson_name="../../evil.geojson"))


class TestFetchAndRecordEntryPoints(unittest.TestCase):
    """fetch_all and record_hashes report a bad entry (FAILED, stop) instead of ending in a traceback."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.raw = os.path.join(self.tmp.name, "raw")
        self.src = os.path.join(self.tmp.name, "src.zip")
        with open(self.src, "wb") as fh:
            fh.write(b"z" * (bg.fetch_sources.SIZE_TOLERANCE_MIN + 200))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))    # the FAILED / recorded lines
        self.enterContext(contextlib.redirect_stderr(io.StringIO()))

    def entry(self, name, **extra):
        return dict({"file": name, "url": "file://" + self.src}, **extra)

    def patched(self, entries):
        stack = [
            mock.patch.object(bg, "RAW_DIR", self.raw),
            mock.patch.object(bg, "default_entries", return_value=entries),
            mock.patch.object(bg.fetch_sources, "load_sources", return_value={}),
        ]
        save = mock.patch.object(bg.fetch_sources, "save_sources")
        return stack, save

    def test_fetch_all_stops_on_an_unsafe_name(self):
        before = snapshot(self.tmp.name)
        with mock.patch.object(bg, "RAW_DIR", self.raw):
            with self.assertRaises(SystemExit):
                bg.fetch_all([self.entry("../escape.zip")])
        self.assertEqual(snapshot(self.tmp.name), before)

    def test_fetch_all_stops_on_a_download_that_is_too_large(self):
        with mock.patch.object(bg, "RAW_DIR", self.raw):
            with self.assertRaises(SystemExit):
                bg.fetch_all([self.entry("a.zip", bytes=100)])
        self.assertEqual(os.listdir(self.raw), [])

    def test_record_hashes_rejects_an_unsafe_name_without_writing_or_saving(self):
        before = snapshot(self.tmp.name)
        stack, save = self.patched([self.entry("../escape.zip")])
        with stack[0], stack[1], stack[2], save as saved:
            with self.assertRaises(SystemExit) as cm:
                bg.record_hashes()
        self.assertIn("NOT updated", str(cm.exception))
        self.assertEqual(snapshot(self.tmp.name), before)
        saved.assert_not_called()

    def test_record_hashes_reports_a_download_over_the_ceiling(self):
        stack, save = self.patched([self.entry("a.zip")])
        with stack[0], stack[1], stack[2], save as saved, \
                mock.patch.object(bg.fetch_sources, "MAX_UNRECORDED_BYTES", 500):
            with self.assertRaises(SystemExit):
                bg.record_hashes()
        saved.assert_not_called()

    def test_record_hashes_still_records_a_good_entry(self):
        entries = [self.entry("a.zip")]
        stack, save = self.patched(entries)
        with stack[0], stack[1], stack[2], save as saved:
            bg.record_hashes()
        saved.assert_called_once()
        recorded = saved.call_args[0][0][bg.SOURCES_KEY]["sources"]
        self.assertEqual(recorded[0]["bytes"], bg.fetch_sources.SIZE_TOLERANCE_MIN + 200)
        self.assertRegex(recorded[0]["sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
