"""Canonical source is the only authority for kernel filename ABI in CI."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "bootstrap/kernel/ci_env.py"
spec = importlib.util.spec_from_file_location("ordax_kernel_ci_env", SCRIPT)
CI = importlib.util.module_from_spec(spec)
spec.loader.exec_module(CI)


class KernelCIEnvTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.contract = self.root / "source.json"
        self.source = {"$schema": "prototype-ordax.kernel-source/1", "version": "6.6.158"}
        self.save()

    def save(self):
        self.contract.write_text(json.dumps(self.source), encoding="utf-8")

    def test_version_is_read_from_supplied_document_only(self):
        self.assertEqual(CI.canonical_version(self.contract), "6.6.158")
        self.source["version"] = "6.6.52"
        self.save()
        self.assertEqual(CI.canonical_version(self.contract), "6.6.52")

    def test_reject_bad_version_and_schema(self):
        for invalid in ("6.6.158-rc", "../6.6.158", "6.6", "6.6.158\nINJECT=1", 666):
            self.source["version"] = invalid
            self.save()
            with self.assertRaises(CI.KernelCIError):
                CI.canonical_version(self.contract)
        self.source["version"] = "6.6.158"
        self.source["$schema"] = "not-ordax-kernel"
        self.save()
        with self.assertRaises(CI.KernelCIError):
            CI.canonical_version(self.contract)

    def test_reject_symlink_and_missing_contract(self):
        link = self.root / "link.json"
        link.symlink_to(self.contract)
        with self.assertRaises(CI.KernelCIError):
            CI.canonical_version(link)
        with self.assertRaises(CI.KernelCIError):
            CI.canonical_version(self.root / "missing.json")

    def test_github_env_cannot_be_written_to_arbitrary_path(self):
        out = self.root / "github_env"
        other = self.root / "other"
        env = os.environ.copy()
        env["GITHUB_ENV"] = str(out)
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--github-env", str(other)],
            cwd=self.root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(other.exists())
        self.assertIn("runner-provided path", result.stderr)


if __name__ == "__main__":
    unittest.main()
