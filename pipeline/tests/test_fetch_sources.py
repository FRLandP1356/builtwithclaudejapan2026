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
