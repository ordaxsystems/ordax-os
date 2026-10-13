"""Current kernel repeat proofs must use the live source pin, not historical filenames."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "bootstrap/kernel/verify_reproducibility.py"
CA = "a" * 64
VERSION = "6.6.158"
CURRENT = (
    f"kernel-{VERSION}.config",
    f"kernel-modules-{VERSION}.tar",
    f"vmlinuz-{VERSION}",
)
HISTORICAL = (
    "kernel-6.6.52.config",
    "kernel-modules-6.6.52.tar",
    "vmlinuz-6.6.52",
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class KernelReproducibilitySSOTTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.build = self.root / "build"
        self.repeat = self.root / "repeat"
        self.build.mkdir()
        self.repeat.mkdir()
        self.source = self.root / "source.json"
        self.source.write_text(
            json.dumps({"$schema": "prototype-ordax.kernel-source/1", "version": VERSION}),
            encoding="utf-8",
        )
        self.contract = self.root / "environment.json"
        self.contract.write_text(
            json.dumps(
                {
                    "$schema": "prototype-ordax.kernel-build-environment/1",
                    "reference_observation": {
                        "source_commit": "1" * 40,
                        "ca_bundle_sha256": CA,
                        "artifacts": {name: "0" * 64 for name in HISTORICAL},
                    },
                    "proof": {"first_observation_complete": True, "package_versions_pinned": True},
                }
            ),
            encoding="utf-8",
        )
        for artifact in CURRENT:
            data = ("candidate-" + artifact).encode("utf-8")
            (self.build / artifact).write_bytes(data)
            (self.repeat / artifact).write_bytes(data)
        self.ca = self.root / "ca.sha256"
        self.ca.write_text(CA + "  ca-certificates.crt\n", encoding="utf-8")
        self.report = self.root / "report.json"

    def verify(self):
        return subprocess.run(
            [
                sys.executable,
                str(VERIFIER),
                str(self.contract),
                str(self.build),
                "--repeat-artifact-dir",
                str(self.repeat),
                "--kernel-source-contract",
                str(self.source),
                "--ca-bundle-sha-file",
                str(self.ca),
                "--out",
                str(self.report),
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_new_version_compares_new_files_and_preserves_historical_record(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["kernel_version"], VERSION)
        self.assertEqual(report["current_source_artifact_names"], sorted(CURRENT))
        self.assertEqual(report["historical_reference_artifact_names"], sorted(HISTORICAL))
        self.assertEqual(set(report["artifact_digests"]), set(CURRENT))
        self.assertEqual(report["artifact_digests"], report["repeat_artifact_digests"])

    def test_mismatched_repeat_digests_fail_closed(self):
        (self.repeat / CURRENT[1]).write_bytes(b"modified")
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("current-source repeat digest mismatch", result.stdout + result.stderr)
        self.assertFalse(self.report.exists())

    def test_old_files_cannot_satisfy_active_new_version(self):
        (self.build / CURRENT[0]).unlink()
        (self.build / HISTORICAL[0]).write_bytes(b"old config")
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing current artifact", result.stdout + result.stderr)
        self.assertFalse(self.report.exists())

    def test_invalid_kernel_identity_is_rejected(self):
        self.source.write_text(
            json.dumps({"$schema": "prototype-ordax.kernel-source/1", "version": "../6.6.158"}),
            encoding="utf-8",
        )
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid canonical kernel source schema or version", result.stdout + result.stderr)
        self.assertFalse(self.report.exists())


if __name__ == "__main__":
    unittest.main()
