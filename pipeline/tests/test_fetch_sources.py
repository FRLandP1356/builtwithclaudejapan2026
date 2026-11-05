"""Offline tests for fetch_sources: hash verification and caching (file:// URLs)."""
import hashlib
import json
import os
import pathlib
import tempfile
import unittest

from pipeline import fetch_sources


class TestFetchOne(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.src = pathlib.Path(self.tmp.name) / "src.bin"
        self.src.write_bytes(b"hello population")
        self.raw = os.path.join(self.tmp.name, "raw")
        self.digest = hashlib.sha256(b"hello population").hexdigest()

    def entry(self, sha256):
        return {"file": "out.bin", "url": self.src.as_uri(), "sha256": sha256}

    def test_downloads_then_caches(self):
        e = self.entry(self.digest)
        self.assertEqual(fetch_sources.fetch_one(e, self.raw), "downloaded")
        self.assertEqual(fetch_sources.fetch_one(e, self.raw), "cached")

    def test_mismatch_raises_and_removes_file(self):
        with self.assertRaises(fetch_sources.HashMismatch):
            fetch_sources.fetch_one(self.entry("0" * 64), self.raw)
        self.assertFalse(os.path.exists(os.path.join(self.raw, "out.bin")))

    def test_corrupt_cached_file_is_redownloaded(self):
        e = self.entry(self.digest)
        fetch_sources.fetch_one(e, self.raw)
        pathlib.Path(self.raw, "out.bin").write_bytes(b"corrupt")
        self.assertEqual(fetch_sources.fetch_one(e, self.raw), "downloaded")
        self.assertEqual(fetch_sources.sha256_of(os.path.join(self.raw, "out.bin")), self.digest)

    def test_missing_hash_is_reported_unverified(self):
        self.assertEqual(fetch_sources.fetch_one(self.entry(None), self.raw), "unverified")


class TestUnsafeFileNames(unittest.TestCase):
    """The destination name comes from sources.json: only a plain base name may be written."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = pathlib.Path(self.tmp.name)
        self.src = self.base / "src.bin"
        self.src.write_bytes(b"payload")
        self.raw = str(self.base / "raw")

    def entry(self, name):
        return {"file": name, "url": self.src.as_uri()}

    def test_rejected_names_raise_before_anything_is_written(self):
        bad = ["../escape.bin", "sub/../../escape.bin", "a/b.bin", "/abs.bin", "a\\b.bin", "..\\escape.bin",
               ".", "..", "", "nul\x00.bin", None, 7]
        for name in bad:
            with self.subTest(name=name):
                with self.assertRaises(fetch_sources.UnsafeFileName):
                    fetch_sources.fetch_one(self.entry(name), self.raw)
                self.assertFalse(os.path.exists(self.raw), "the raw directory must not even be created")
                self.assertFalse((self.base / "escape.bin").exists())

    def test_plain_base_names_are_accepted(self):
        for name in ["suikei_kekka.xlsx", "N03-20210101_01_GML.zip", "katei_cwr_0-4sr.xlsx", "..hidden", "a..b"]:
            with self.subTest(name=name):
                dest = fetch_sources.safe_dest(self.raw, name)
                self.assertEqual(dest, os.path.join(self.raw, name))

    def test_symlink_in_raw_dir_cannot_redirect_the_write(self):
        outside = self.base / "outside.bin"
        outside.write_bytes(b"precious")
        os.makedirs(self.raw)
        os.symlink(outside, os.path.join(self.raw, "link.bin"))
        with self.assertRaises(fetch_sources.UnsafeFileName):
            fetch_sources.fetch_one(self.entry("link.bin"), self.raw, force=True)
        self.assertEqual(outside.read_bytes(), b"precious")

    def test_a_normal_name_still_downloads(self):
        self.assertEqual(fetch_sources.fetch_one(self.entry("ok.bin"), self.raw), "unverified")
        self.assertEqual(pathlib.Path(self.raw, "ok.bin").read_bytes(), b"payload")


class TestSourcesJson(unittest.TestCase):
    def test_four_ipss_files_with_hashes(self):
        data = fetch_sources.load_sources()
        files = {s["file"] for s in data["sources"]}
        self.assertEqual(
            files,
            {"suikei_kekka.xlsx", "katei_suvr.xlsx", "katei_nmigr.xlsx", "katei_cwr_0-4sr.xlsx"},
        )
        for s in data["sources"]:
            self.assertTrue(s["url"].startswith("https://www.ipss.go.jp/"), s["url"])
            self.assertRegex(s["sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
