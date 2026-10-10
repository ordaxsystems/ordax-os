"""ABI identity of modules archive must match the canonical kernel release."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
KERNEL_BUILD = ROOT / "bootstrap/kernel/build.py"
SPEC = importlib.util.spec_from_file_location("kernel_stage_abi", KERNEL_BUILD)
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class KernelModuleReleaseAbiTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / "module-stage"
        self.output = self.root / "kernel-modules-6.6.158.tar"
        self.modules = self.stage / "lib/modules/6.6.158"
        self.modules.mkdir(parents=True)
        for name in BUILD.REQUIRED_MODULE_BASENAMES:
            (self.modules / name).write_bytes(b"module-fixture-only")

    def test_abi_match_is_packaged_under_correct_release(self):
        observed = BUILD.package_modules(self.stage, self.output, "6.6.158")
        self.assertEqual(observed, BUILD.REQUIRED_MODULE_BASENAMES)
        with tarfile.open(self.output, "r") as handle:
            names = handle.getnames()
        self.assertIn("lib/modules/6.6.158/iwlwifi.ko", names)
        self.assertFalse(any("6.6.52" in name for name in names))

    def test_wrong_kernel_release_fails_closed_before_tar_output(self):
        with self.assertRaisesRegex(BUILD.BuildError, "kernel/module ABI mismatch"):
            BUILD.package_modules(self.stage, self.output, "6.6.52")
        self.assertFalse(self.output.exists())

    def test_missing_required_modules_rejects_candidate(self):
        (self.modules / "iwlwifi.ko").unlink()
        with self.assertRaisesRegex(BUILD.BuildError, "required Wi-Fi modules missing"):
            BUILD.package_modules(self.stage, self.output, "6.6.158")


if __name__ == "__main__":
    unittest.main()
