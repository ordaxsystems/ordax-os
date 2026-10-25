#!/usr/bin/env python3
"""Real Linux syscall proof for the single-owner Owner/Development swap primitive."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "bootstrap/dev-base/ordax_checkout_exchange.c"
BUILDROOT_POST_BUILD = ROOT / "bootstrap/independent-base/post-build.sh"
LEGACY_DEV_BUILDER = ROOT / "bootstrap/dev-base/build.py"


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux renameat2 required")
class NativeAtomicCheckoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.compiler = shutil.which("cc")
        if cls.compiler is None:
            raise unittest.SkipTest("C compiler unavailable for source-level syscall proof")
        cls.build = tempfile.TemporaryDirectory()
        cls.binary = Path(cls.build.name) / "ordax-checkout-exchange"
        subprocess.run([
            cls.compiler, "-O2", "-Wall", "-Wextra", "-Werror",
            "-o", str(cls.binary), str(SOURCE),
        ], check=True, capture_output=True, text=True, timeout=30)

    @classmethod
    def tearDownClass(cls) -> None:
        if hasattr(cls, "build"):
            cls.build.cleanup()

    def exchange(self, a: Path, b: Path) -> subprocess.CompletedProcess[str]:
        receipt = a.parent / "pull-transaction.tsv"
        receipt.write_text("test|prepared|candidate|known-good|update\n", encoding="utf-8")
        return subprocess.run(
            [str(self.binary), "--exchange", str(a), str(b), str(receipt)],
            capture_output=True, text=True, timeout=10, check=False,
        )

    def test_exchange_keeps_canonical_directory_present_for_concurrent_readers(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            current = parent / "ordax"
            stage = parent / ".ordax-staging.123"
            current.mkdir()
            stage.mkdir()
            (current / "old").write_text("old", encoding="utf-8")
            (stage / "candidate").write_text("candidate", encoding="utf-8")
            failures = []
            def reader():
                for _ in range(15000):
                    try:
                        stat = os.stat(current)
                        if not stat.st_mode:
                            failures.append("invalid-stat")
                    except OSError as exc:
                        failures.append(type(exc).__name__)
            t = threading.Thread(target=reader)
            t.start()
            try:
                for _ in range(60):
                    result = self.exchange(current, stage)
                    self.assertEqual(result.returncode, 0, result.stderr)
            finally:
                t.join(timeout=15)
            self.assertFalse(t.is_alive())
            self.assertEqual(failures, [])
            self.assertTrue(current.is_dir())
            self.assertTrue(stage.is_dir())
            self.assertTrue((current / "old").exists())

    def test_reject_symlink_missing_cross_parent_and_same_inode_without_side_effects(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            current, stage = parent / "ordax", parent / ".ordax-staging.123"
            current.mkdir()
            stage.mkdir()
            (current / "sentinel").write_text("preserve", encoding="utf-8")
            link = parent / "link"
            link.symlink_to(current, target_is_directory=True)
            other = parent / "other"
            other.mkdir()
            external = other / "external"
            external.mkdir()
            for first, second in (
                (link, stage),
                (current, parent / "missing"),
                (current, external),
                (current, current),
            ):
                failure = self.exchange(first, second)
                self.assertNotEqual(failure.returncode, 0)
                self.assertTrue((current / "sentinel").is_file())
                self.assertTrue(stage.is_dir())

    def test_buildroot_post_build_is_only_owner_checkout_helper_producer(self):
        self.assertFalse(LEGACY_DEV_BUILDER.exists(), "Alpine Dev builder was resurrected")
        text = BUILDROOT_POST_BUILD.read_text(encoding="utf-8")
        self.assertIn('ordax_checkout_exchange:ordax-checkout-exchange', text)
        self.assertIn('native_source="$ROOT/bootstrap/dev-base/$source_name.c"', text)
        self.assertIn('native_compiler="${HOST_DIR:-}/bin/x86_64-buildroot-linux-musl-gcc"', text)
        self.assertIn('"$native_compiler" -static -Os -s -Wall -Wextra -Werror', text)
        self.assertIn('"prototype-ordax.checkout-exchange/1"', text)


if __name__ == "__main__":
    unittest.main()
