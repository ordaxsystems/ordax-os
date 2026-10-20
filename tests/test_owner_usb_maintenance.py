#!/usr/bin/env python3
"""Actual Owner maintenance command in a disposable on-disk Git installation."""

from __future__ import annotations
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MAINTAIN = ROOT / "bootstrap/dev-base/ordax-maintain"
MANIFEST = ROOT / "system/services/base-update/dev-helper-manifest.tsv"


class OwnerUsbMaintenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="ordax-maintain-e2e-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "usb"
        self.worktree = self.root / "workspace/ordax"
        self.worktree.mkdir(parents=True)
        self.state = self.root / "state/ordax"
        self.state.mkdir(parents=True)
        self.run_dir = self.root / "run/ordax-update"
        self.run_dir.mkdir(parents=True)
        self.bin = self.root / "usr/local/bin"
        self.bin.mkdir(parents=True)
        self._cmd("git", "init", "--initial-branch=main", str(self.worktree))
        self._cmd("git", "-C", str(self.worktree), "config", "user.name", "OrdaX Test")
        self._cmd("git", "-C", str(self.worktree), "config", "user.email", "owner@example.invalid")
        self._cmd("git", "-C", str(self.worktree), "remote", "add", "origin",
                  "https://github.com/ordaxsystems/ordax-os.git")
        src = self.worktree / "bootstrap/dev-base"
        src.mkdir(parents=True)
        shutil.copy2(MAINTAIN, src / "ordax-maintain")
        (src / "ordax-pull").write_text("#!/bin/sh\nexit 0\n")
        (self.worktree / "system/services/base-update").mkdir(parents=True)
        (self.worktree / "system/services/base-update/dev-helper-manifest.tsv").write_text(
            "bootstrap/dev-base/ordax-maintain\tusr/local/bin/ordax-maintain\n"
            "bootstrap/dev-base/ordax-pull\tusr/local/bin/ordax-pull\n"
        )
        shutil.copy2(src / "ordax-maintain", self.bin / "ordax-maintain")
        shutil.copy2(src / "ordax-pull", self.bin / "ordax-pull")
        self._cmd("git", "-C", str(self.worktree), "add", ".")
        self._cmd("git", "-C", str(self.worktree), "commit", "-m", "test-owner-usb")
        self.sha = self._cmd("git", "-C", str(self.worktree), "rev-parse", "HEAD").stdout.strip()
        (self.state / "current-commit").write_text(self.sha + "\n")
        (self.state / "dev-helpers-sha").write_text(self.sha + "\n")
        (self.state / "power").mkdir()
        (self.state / "power/last-request").write_text("shutdown|private-boot-id|1792515039|failed\n")
        (self.state / "owner-remote").mkdir()
        (self.state / "owner-remote/device-token").write_text("SECRET_NEVER_IN_DIAGNOSTIC\n")
        self.env = {
            **os.environ, "ORDAX_WORKTREE": str(self.worktree),
            "ORDAX_STATE_DIR": str(self.state),
            "ORDAX_UPDATE_RUN_DIR": str(self.run_dir),
            "ORDAX_DEV_HELPER_TARGET_ROOT": str(self.root),
        }

    def _cmd(self, *argv: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(argv, check=True, capture_output=True, text=True)

    def command(self, *argv: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["/bin/sh", str(MAINTAIN), *argv],
                              env=self.env, capture_output=True, text=True, timeout=15)

    def test_status_reads_consistent_usb_without_secrets_or_mutations(self) -> None:
        before = sorted((p.relative_to(self.root).as_posix(), p.stat().st_mtime_ns)
                        for p in self.state.rglob("*") if p.is_file())
        result = self.command("status")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("maintenance.result=healthy", result.stdout)
        self.assertIn("checkout.clean=yes", result.stdout)
        self.assertIn("power.last_status=failed", result.stdout)
        self.assertIn("remote.credentials=no", result.stdout)
        self.assertNotIn("SECRET_NEVER_IN_DIAGNOSTIC", result.stdout + result.stderr)
        self.assertNotIn("private-boot-id", result.stdout + result.stderr)
        after = sorted((p.relative_to(self.root).as_posix(), p.stat().st_mtime_ns)
                       for p in self.state.rglob("*") if p.is_file())
        self.assertEqual(before, after)

    def test_self_test_compares_installed_helpers_to_checked_out_sources(self) -> None:
        success = self.command("self-test")
        self.assertEqual(success.returncode, 0, success.stderr)
        self.assertIn("maintenance.self_test=passed", success.stdout)
        with (self.bin / "ordax-pull").open("a") as f:
            f.write("# corrupted helper\n")
        failed = self.command("status")
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("helper.mismatch=usr/local/bin/ordax-pull", failed.stdout)
        self.assertIn("maintenance.result=attention-required", failed.stdout)

    def test_repair_rejects_unsafe_operations_before_invoking_pull(self) -> None:
        invalid = self.command("repair", "abc", "--confirm")
        self.assertNotEqual(invalid.returncode, 0)
        absent = self.command("repair", self.sha)
        self.assertNotEqual(absent.returncode, 0)
        self._cmd("git", "-C", str(self.worktree), "remote", "set-url", "origin",
                  "https://evil.invalid/ordax")
        wrong_origin = self.command("repair", self.sha, "--confirm")
        self.assertNotEqual(wrong_origin.returncode, 0)
        self.assertIn("noncanonical origin", wrong_origin.stderr)

    def test_repair_delegates_only_to_installed_pull(self) -> None:
        marker = self.root / "delegated-pull"
        # A test spy replaces only the installed updater, never the repository
        # production implementation. Existing test_dev_git_flow covers actual
        # network/Git transaction, rollback and helper refresh end to end.
        (self.bin / "ordax-pull").write_text(
            f"#!/bin/sh\nprintf '%s' \"$ORDAX_EXPECTED_SHA\" >'{marker}'\nexit 0\n"
        )
        delegated = self.command("repair", self.sha, "--confirm")
        self.assertNotEqual(delegated.returncode, 0)
        self.assertEqual(marker.read_text(), self.sha)
        self.assertIn("helper.mismatch=usr/local/bin/ordax-pull", delegated.stdout)

    def test_manifest_delivers_maintenance_via_same_helper_activation(self) -> None:
        self.assertIn(
            "bootstrap/dev-base/ordax-maintain\tusr/local/bin/ordax-maintain",
            MANIFEST.read_text(),
        )
        self._cmd("/bin/sh", "-n", str(MAINTAIN))
        self.assertIn('"/bin/sh" "$PULL"', MAINTAIN.read_text())


if __name__ == "__main__":
    unittest.main()
