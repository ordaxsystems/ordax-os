#!/usr/bin/env python3
"""Offline Git fixtures for the Owner Supervisor's pinned visual stage."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "system/services/surface-source/owner-stage.sh"


def git(root: Path, *args: str):
    return subprocess.run(
        ["git", "-C", str(root), *args], text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    ).stdout.strip()


class OwnerSurfaceSourceTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.os_root = self.root / "os"
        self.surface_root = self.root / "external-surface"
        self.slot = self.root / "slot"
        for root in (self.os_root, self.surface_root):
            root.mkdir()
            git(root, "init", "-q")
            git(root, "config", "user.email", "source-test@localhost.invalid")
            git(root, "config", "user.name", "Source fixture")
        self.make_file(self.surface_root / "system/surface/ui/surface.mjs", "NEW_VISUAL\n")
        self.make_file(self.surface_root / "system/surface/workspace/shell.tsx", "NEW_WORKSPACE\n")
        git(self.surface_root, "add", ".")
        git(self.surface_root, "commit", "-qm", "fixture surface")
        self.source_sha = git(self.surface_root, "rev-parse", "HEAD")
        self.make_file(self.os_root / "system/supervisor", "#!/bin/sh\nexit 0\n")
        self.make_file(self.os_root / "system/surface/entrypoint", "#!/bin/sh\nexit 0\n")
        (self.os_root / "system/surface/entrypoint").chmod(0o755)
        self.make_file(self.os_root / "system/surface/ui/surface.mjs", "OLD_VISUAL\n")
        self.make_file(self.os_root / "system/surface/workspace/shell.tsx", "OLD_WORKSPACE\n")
        self.lock_file = self.os_root / "docs/contracts/surface-source.json"
        self.set_lock(status="canonical")
        self.slot_system = self.slot / "system"
        self.make_file(self.slot_system / "surface/ui/surface.mjs", "OLD_VISUAL\n")
        self.make_file(self.slot_system / "surface/workspace/shell.tsx", "OLD_WORKSPACE\n")
        self.make_file(self.slot_system / "surface/entrypoint", "#!/bin/sh\n")
        (self.slot_system / "surface/entrypoint").chmod(0o755)
        self.cfg = self.root / ".gitconfig"
        self.cfg.write_text(
            '[url "' + self.surface_root.as_uri() + '"]\n'
            '    insteadOf = https://github.com/ordaxsystems/ordax-surface.git\n'
            '[protocol "file"]\n    allow = always\n',
            encoding="utf-8",
        )
        self.env = dict(os.environ)
        self.env["GIT_CONFIG_GLOBAL"] = str(self.cfg)
        self.env["GIT_CONFIG_NOSYSTEM"] = "1"
        self.env["ORDAX_GIT_BIN"] = "/usr/bin/git"

    @staticmethod
    def make_file(path: Path, content: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def set_lock(self, status: str, source_sha=None, repository="ordaxsystems/ordax-surface"):
        self.make_file(self.lock_file, json.dumps({
            "$schema": "prototype-ordax.surface-source/1",
            "status": status,
            "source_repository": repository,
            "source_commit": source_sha or self.source_sha,
            "visual_source_paths": ["system/surface/ui", "system/surface/workspace"],
        }, indent=2) + "\n")
        git(self.os_root, "add", ".")
        git(self.os_root, "commit", "-qm", "fixture OS lock")
        self.os_sha = git(self.os_root, "rev-parse", "HEAD")

    def call(self, command: str, check=False):
        p = subprocess.run(
            ["/bin/sh", str(HELPER), command, str(self.os_root), self.os_sha, str(self.slot)],
            env=self.env, text=True, capture_output=True,
        )
        if check and p.returncode:
            self.fail(f"owner stage {command}: code={p.returncode}\n{p.stdout}\n{p.stderr}")
        return p

    def test_exact_source_overrides_only_candidate_slot(self):
        self.assertEqual(self.call("status", check=True).stdout.strip(), "canonical")
        self.call("stage", check=True)
        self.assertEqual((self.slot_system / "surface/ui/surface.mjs").read_text(), "NEW_VISUAL\n")
        self.assertEqual((self.slot_system / "surface/workspace/shell.tsx").read_text(), "NEW_WORKSPACE\n")
        self.assertEqual((self.os_root / "system/surface/ui/surface.mjs").read_text(), "OLD_VISUAL\n")
        self.assertEqual((self.slot / ".surface-source-sha").read_text().strip(), self.source_sha)
        self.assertFalse((self.slot / ".surface-source-git").exists())
        self.make_file(self.slot / ".sha", self.os_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        self.call("ready", check=True)
        self.make_file(self.slot / ".surface-source-sha", "0" * 40 + "\n")
        self.assertNotEqual(self.call("ready").returncode, 0)

    def test_external_git_commit_unavailable_preserves_old_candidate_and_os(self):
        self.set_lock("canonical", source_sha="f" * 40)
        self.assertNotEqual(self.call("stage").returncode, 0)
        self.assertEqual((self.slot_system / "surface/ui/surface.mjs").read_text(), "OLD_VISUAL\n")
        self.assertEqual((self.os_root / "system/surface/ui/surface.mjs").read_text(), "OLD_VISUAL\n")
        self.assertFalse((self.slot / ".surface-source-sha").exists())

    def test_integration_candidate_does_not_fetch_or_modify_source(self):
        self.set_lock("integration-candidate")
        self.assertEqual(self.call("status", check=True).stdout.strip(), "integration-candidate")
        self.call("stage", check=True)
        self.assertEqual((self.slot_system / "surface/ui/surface.mjs").read_text(), "OLD_VISUAL\n")
        self.assertFalse((self.slot / ".surface-source-sha").exists())

    def test_unknown_repository_is_rejected(self):
        self.set_lock("canonical", repository="example/alternate")
        self.assertNotEqual(self.call("status").returncode, 0)
        self.assertNotEqual(self.call("stage").returncode, 0)

    def test_symlink_mode_source_is_rejected_without_replacing_candidate(self):
        alias = self.surface_root / "system/surface/ui/evil.mjs"
        alias.symlink_to("surface.mjs")
        git(self.surface_root, "add", ".")
        git(self.surface_root, "commit", "-qm", "linked source")
        self.set_lock("canonical", source_sha=git(self.surface_root, "rev-parse", "HEAD"))
        self.assertNotEqual(self.call("stage").returncode, 0)
        self.assertEqual((self.slot_system / "surface/ui/surface.mjs").read_text(), "OLD_VISUAL\n")
        self.assertFalse((self.slot / ".surface-source-sha").exists())


    def supervisor_start(self, profile: str):
        supervisor = (ROOT / "system/supervisor").read_text(encoding="utf-8")
        section = "start_surface() {" + supervisor.split("start_surface() {", 1)[1].split("\n}\n", 1)[0] + "\n}\n"
        receipt = self.root / "started-from.txt"
        work = self.root / "update.log"
        work.touch()
        shell = (
            "set -eu\n"
            "WORKTREE=$1\n"
            "RELEASES_DIR=$2\n"
            "SYSTEM_ROOT=$3\n"
            "OWNER_SURFACE_STAGE_HELPER=$4\n"
            "GIT_BIN=/usr/bin/git\n"
            "UPDATE_LOG=$5\n"
            "DISTRIBUTION_PROFILE=$6\n"
            "EXPECTED_SHA=$7\n"
            "RECEIPT=$8\n"
            "current_sha() { printf '%s\\n' \"$EXPECTED_SHA\"; }\n"
            "start_surface_from_system() { printf '%s\\n' \"$1\" > \"$RECEIPT\"; }\n"
            "log() { :; }\n"
            + section + "start_surface\n"
        )
        proc = subprocess.run([
            "/bin/sh", "-c", shell, "sh", str(self.os_root),
            str(self.root / "releases"), str(self.os_root / "system"),
            str(HELPER), str(work), profile, self.os_sha, str(receipt),
        ], env=self.env, text=True, capture_output=True)
        return proc, receipt

    def test_cold_boot_uses_only_verified_canonical_slot(self):
        self.call("stage", check=True)
        releases = self.root / "releases"
        releases.mkdir()
        self.make_file(self.slot / ".sha", self.os_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        self.slot.rename(releases / self.os_sha)
        proc, marker = self.supervisor_start("owner-development")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(marker.read_text().strip(), str(releases / self.os_sha / "system"))
        marker.unlink()
        (releases / self.os_sha / ".surface-source-sha").write_text("f" * 40 + "\n")
        proc, marker = self.supervisor_start("owner-development")
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(marker.exists(), "no fallback to tracked OS visuals")

    def test_legacy_owner_boot_remains_unmodified_before_cutover(self):
        self.set_lock("integration-candidate")
        proc, marker = self.supervisor_start("owner-development")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(marker.read_text().strip(), str(self.os_root / "system"))


if __name__ == "__main__":
    unittest.main()
