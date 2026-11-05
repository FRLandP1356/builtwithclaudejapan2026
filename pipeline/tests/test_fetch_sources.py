"""Offline tests for fetch_sources: hash verification and caching (file:// URLs)."""
import hashlib
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

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


class FakeResponse:
    """A urlopen() result that serves `total` bytes (None = endless) and counts what was asked of it."""

    def __init__(self, total=None, content_length=None):
        self.total = total
        self.served = 0
        self.reads = 0
        self.headers = {} if content_length is None else {"Content-Length": str(content_length)}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, n=-1):
        self.reads += 1
        if n is None or n < 0:
            raise AssertionError("download must read in bounded pieces, never to the end")
        n = n if self.total is None else min(n, self.total - self.served)
        self.served += n
        return b"x" * n


class TestDownloadSizeCap(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dest = os.path.join(self.tmp.name, "raw", "big.bin")

    def run_download(self, resp, expected_bytes):
        return fetch_sources.download("https://example.invalid/big.bin", self.dest, expected_bytes=expected_bytes,
                                      opener=lambda req, timeout=None: resp)

    def leftovers(self):
        d = os.path.dirname(self.dest)
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def test_limit_is_recorded_size_plus_documented_tolerance(self):
        tol_min, pct = fetch_sources.SIZE_TOLERANCE_MIN, fetch_sources.SIZE_TOLERANCE_PERCENT
        self.assertEqual(fetch_sources.size_limit(1000), 1000 + tol_min)             # small file: the fixed minimum
        self.assertEqual(fetch_sources.size_limit(100_000_000), 100_000_000 + 100_000_000 * pct // 100)   # big: 1%
        self.assertEqual(fetch_sources.size_limit(None), fetch_sources.MAX_UNRECORDED_BYTES)
        self.assertEqual(fetch_sources.size_limit(0), fetch_sources.MAX_UNRECORDED_BYTES)

    def test_endless_stream_is_cut_off_and_nothing_is_kept(self):
        limit = fetch_sources.size_limit(1000)
        resp = FakeResponse(total=None)
        with self.assertRaises(fetch_sources.DownloadTooLarge):
            self.run_download(resp, 1000)
        self.assertEqual(resp.served, limit + 1, "must stop one byte past the limit, not read on")
        self.assertEqual(self.leftovers(), [], "neither the file nor a .part remains")

    def test_exactly_the_limit_is_accepted_one_byte_more_is_not(self):
        limit = fetch_sources.size_limit(1000)
        self.run_download(FakeResponse(total=limit), 1000)
        self.assertEqual(os.path.getsize(self.dest), limit)
        os.remove(self.dest)
        with self.assertRaises(fetch_sources.DownloadTooLarge):
            self.run_download(FakeResponse(total=limit + 1), 1000)
        self.assertEqual(self.leftovers(), [])

    def test_content_length_over_the_limit_aborts_before_reading_the_body(self):
        resp = FakeResponse(total=10, content_length=fetch_sources.size_limit(1000) + 1)
        with self.assertRaises(fetch_sources.DownloadTooLarge):
            self.run_download(resp, 1000)
        self.assertEqual(resp.reads, 0)
        self.assertEqual(self.leftovers(), [])

    def test_failed_redownload_keeps_no_partial_file_next_to_the_old_one(self):
        os.makedirs(os.path.dirname(self.dest))
        with open(self.dest, "wb") as fh:
            fh.write(b"old")
        with self.assertRaises(fetch_sources.DownloadTooLarge):
            self.run_download(FakeResponse(total=None), 1000)
        self.assertEqual(self.leftovers(), ["big.bin"])

    def test_declared_length_accepts_only_plain_ascii_digits(self):
        ok = {"0": 0, "10": 10, " 12 ": 12, "007": 7, "99999999999": 99999999999}
        for value, want in ok.items():
            with self.subTest(value=value):
                self.assertEqual(fetch_sources.declared_length({"Content-Length": value}), want)
        for value in ["abc", "", "-5", "+5", "1.5", "1_000", "10, 10", "\u00b2", "\u0663", "\uff11\uff10", "1e3"]:
            with self.subTest(value=value):
                self.assertIsNone(fetch_sources.declared_length({"Content-Length": value}))
        self.assertIsNone(fetch_sources.declared_length({}))
        self.assertIsNone(fetch_sources.declared_length(None))

    def test_unusable_content_length_is_ignored_and_the_stream_cap_still_applies(self):
        limit = fetch_sources.size_limit(1000)
        for value in ["\u00b2", "abc", "-5", "1e3"]:
            with self.subTest(value=value, case="within limit"):
                self.run_download(FakeResponse(total=100, content_length=value), 1000)
                self.assertEqual(os.path.getsize(self.dest), 100)
                os.remove(self.dest)
            with self.subTest(value=value, case="over limit"):
                resp = FakeResponse(total=None, content_length=value)
                with self.assertRaises(fetch_sources.DownloadTooLarge):
                    self.run_download(resp, 1000)
                self.assertEqual(resp.served, limit + 1)
                self.assertEqual(self.leftovers(), [])

    def test_without_a_recorded_size_the_ceiling_applies(self):
        with mock.patch.object(fetch_sources, "MAX_UNRECORDED_BYTES", 500):
            with self.assertRaises(fetch_sources.DownloadTooLarge):
                self.run_download(FakeResponse(total=2000), None)
            self.run_download(FakeResponse(total=500), None)
        self.assertEqual(os.path.getsize(self.dest), 500)

    def test_fetch_one_passes_the_recorded_size(self):
        raw = os.path.join(self.tmp.name, "fetch")
        src = pathlib.Path(self.tmp.name) / "src.bin"
        src.write_bytes(b"y" * (fetch_sources.SIZE_TOLERANCE_MIN + 200))
        too_big = {"file": "a.bin", "url": src.as_uri(), "bytes": 100}
        with self.assertRaises(fetch_sources.DownloadTooLarge):
            fetch_sources.fetch_one(too_big, raw)
        self.assertEqual(os.listdir(raw), [])
        fits = {"file": "a.bin", "url": src.as_uri(), "bytes": 200}     # within the tolerance
        self.assertEqual(fetch_sources.fetch_one(fits, raw), "unverified")


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
            self.assertIsInstance(s["bytes"], int)


if __name__ == "__main__":
    unittest.main()
