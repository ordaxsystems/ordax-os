"""Contract-only gates. Runtime/QEMU proof is exercised by its separate CI job."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap/independent-base"


class IndependentBaseTest(unittest.TestCase):
    def test_experiment_is_disconnected_from_release(self):
        spec = json.loads((BASE / "source.json").read_text())
        self.assertEqual(spec["status"], "experimental-not-promotable")
        self.assertIs(spec["physical_artifact_authorized"], False)
        self.assertIs(spec["stable_channel_authorized"], False)
        self.assertNotIn("bootstrap/independent-base/build.py",
                         (ROOT / "bootstrap/stable-base/source.json").read_text())

    def test_canonical_input_contracts(self):
        result = subprocess.run(
            [sys.executable, str(BASE / "build.py"), "check"],
            capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "contract-check-pass")

    def test_verification_fails_closed_without_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                [sys.executable, str(BASE / "build.py"), "verify", "--out", tmp],
                capture_output=True, text=True, cwd=ROOT)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("ERROR", result.stderr)

    def test_no_second_kernel_version(self):
        profile = (BASE / "configs/ordax_minimal_defconfig").read_text()
        self.assertNotIn("BR2_DEFAULT_KERNEL_VERSION=", profile)
        self.assertNotIn("BR2_LINUX_KERNEL_VERSION=", profile)


if __name__ == "__main__":
    unittest.main()
