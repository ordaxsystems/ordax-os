"""Pin, cache and bounded retry for the single OS BusyBox upstream source."""
from __future__ import annotations

import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "bootstrap/initramfs/build.py"
SPEC = importlib.util.spec_from_file_location("ordax_initramfs_pinned_download", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class OwnerPinnedBusyBoxSourceTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.payload = b"immutable-test-source"
        self.spec = {"busybox": {
            "version": "1.38.0",
            "archive_url": "https://busybox.net/downloads/busybox-1.38.0.tar.bz2",
            "archive_sha256": hashlib.sha256(self.payload).hexdigest(),
        }}

    def test_transient_timeout_retries_then_verifies_and_caches(self):
        with (
            mock.patch.object(MODULE.urllib.request, "urlopen", side_effect=[
                TimeoutError("upstream timed out"), io.BytesIO(self.payload)
            ]) as urlopen,
            mock.patch.object(MODULE.time, "sleep") as sleep,
        ):
            archive = MODULE.download(self.spec, self.root)
        self.assertEqual(archive.read_bytes(), self.payload)
        self.assertEqual(urlopen.call_count, 2)
        self.assertEqual(urlopen.call_args_list[1].args[0],
                         "https://sources.buildroot.net/busybox/busybox-1.38.0.tar.bz2")
        sleep.assert_called_once_with(1)
        with mock.patch.object(MODULE.urllib.request, "urlopen") as urlopen:
            self.assertEqual(MODULE.download(self.spec, self.root), archive)
            urlopen.assert_not_called()

    def test_wrong_download_digest_fails_closed_without_poisoning_cache(self):
        with mock.patch.object(MODULE.urllib.request, "urlopen", return_value=io.BytesIO(b"wrong")):
            with self.assertRaisesRegex(MODULE.BuildError, "digest mismatch"):
                MODULE.download(self.spec, self.root)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_three_timeouts_fail_bounded_and_leave_no_archive(self):
        with (
            mock.patch.object(MODULE.urllib.request, "urlopen", side_effect=TimeoutError("offline")) as urlopen,
            mock.patch.object(MODULE.time, "sleep") as sleep,
        ):
            with self.assertRaisesRegex(MODULE.BuildError, "after 3 attempts"):
                MODULE.download(self.spec, self.root)
        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_ci_and_both_consumers_share_one_digest_verified_cache(self):
        init = (ROOT / "bootstrap/initramfs/build.py").read_text(encoding="utf-8")
        net = (ROOT / "bootstrap/network/build.py").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text(encoding="utf-8")
        cache = 'ROOT / "out" / "upstream" / "busybox"'
        self.assertIn(cache, init)
        self.assertIn(cache, net)
        self.assertIn("path: out/upstream/busybox", workflow)
        self.assertIn("hashFiles('bootstrap/initramfs/source.json')", workflow)


if __name__ == "__main__":
    unittest.main()
