#!/usr/bin/env python3
"""Offline proof of Creator preseeded, immutable Owner Surface slot."""

import importlib.util
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "tools/surface-source/preseed_owner.py"
SPEC = importlib.util.spec_from_file_location("owner_visual_preseed", SOURCE)
assert SPEC is not None and SPEC.loader is not None
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(root), *args], text=True, stderr=subprocess.DEVNULL
    ).strip()


class OwnerOfflineSurfacePreseedTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        home = Path(tmp.name)
        self.repo = home / "os"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.email", "offline-fixture@localhost.invalid")
        git(self.repo, "config", "user.name", "Offline fixture")
        self.surface_sha = "a" * 40
        self.write(self.repo / "docs/contracts/surface-source.json", json.dumps({
            "$schema": "prototype-ordax.surface-source/1",
            "status": "canonical",
            "source_repository": "ordaxsystems/ordax-surface",
            "source_commit": self.surface_sha,
        }, indent=2) + "\n")
        self.write(self.repo / "system/entrypoint", "#!/bin/sh\n")
        git(self.repo, "add", "docs", "system")
        git(self.repo, "commit", "-qm", "OS without tracked visual source")
        self.sha = git(self.repo, "rev-parse", "HEAD")
        self.rootfs = self.repo / "out/dev-base/rootfs"
        self.checkout = self.rootfs / "workspace/ordax"
        self.checkout.parent.mkdir(parents=True)
        subprocess.run(["git", "clone", "-q", str(self.repo), str(self.checkout)], check=True)
        self.write(self.rootfs / "state/ordax/current-commit", self.sha + "\n")
        self.assembly = home / "assembled"
        self.write(self.assembly / "system/entrypoint", "#!/bin/sh\n")
        self.write(self.assembly / "system/surface/entrypoint", "#!/bin/sh\n")
        (self.assembly / "system/surface/entrypoint").chmod(0o755)
        self.write(self.assembly / "system/surface/ui/surface.mjs", "verified visual\n")
        self.write(self.assembly / "system/surface/workspace/presentation.mjs", "verified workspace\n")
        self.receipt_path = self.assembly / "system/surface/source-provenance.json"
        self.make_receipt()

    @staticmethod
    def write(path: Path, value: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    def fingerprint(self):
        result = hashlib.sha256()
        for folder in ("system/surface/ui", "system/surface/workspace"):
            for path in sorted((self.assembly / folder).rglob("*")):
                if path.is_file():
                    relative = path.relative_to(self.assembly).as_posix()
                    result.update(relative.encode("utf-8") + b"\0")
                    result.update(hashlib.sha256(path.read_bytes()).digest())
        return result.hexdigest()

    def make_receipt(self, **overrides):
        receipt = {
            "os_commit": self.sha,
            "surface_source_commit": self.surface_sha,
            "surface_source_repository": "ordaxsystems/ordax-surface",
            "visual_file_count": 2,
            "visual_source_sha256": self.fingerprint(),
            "old_os_visual_source_packaged": False,
        }
        receipt.update(overrides)
        self.write(self.receipt_path, json.dumps(receipt, indent=2) + "\n")

    def test_preseed_is_offline_exact_and_isolated_from_clean_os_git(self):
        before = git(self.checkout, "status", "--porcelain")
        self.assertEqual(before, "")
        preseed = OWNER.preseed(self.repo, self.assembly, self.rootfs, self.sha)
        self.assertEqual(preseed["visual_files"], 2)
        self.assertFalse(preseed["physical_device_written"])
        slot = self.rootfs / "state/ordax/releases" / self.sha
        self.assertEqual((slot / "system/surface/ui/surface.mjs").read_text(), "verified visual\n")
        self.assertEqual((slot / "system/surface/workspace/presentation.mjs").read_text(), "verified workspace\n")
        self.assertEqual((slot / ".surface-source-sha").read_text().strip(), self.surface_sha)
        self.assertEqual(git(self.checkout, "status", "--porcelain"), before)
        self.assertFalse((self.checkout / "system/surface/ui").exists())
        self.assertFalse((self.checkout / "system/surface/workspace").exists())
        with self.assertRaises(OWNER.PreseedError):
            OWNER.preseed(self.repo, self.assembly, self.rootfs, self.sha)

    def test_exact_offline_slot_is_accepted_by_real_supervisor_shell_helper(self):
        OWNER.preseed(self.repo, self.assembly, self.rootfs, self.sha)
        slot = self.rootfs / "state/ordax/releases" / self.sha
        helper = SOURCE.parents[2] / "system/services/surface-source/owner-stage.sh"
        command = [
            "/bin/sh", str(helper), "ready", str(self.checkout),
            self.sha, str(slot),
        ]
        env = __import__("os").environ.copy()
        env["ORDAX_GIT_BIN"] = shutil.which("git")
        verified = subprocess.run(command, text=True, capture_output=True, env=env)
        self.assertEqual(
            verified.returncode, 0,
            f"real Supervisor slot verifier refused valid preseed: {verified.stderr}",
        )
        self.write(slot / "system/surface/ui/surface.mjs", "tampered\\n")
        modified = subprocess.run(command, text=True, capture_output=True, env=env)
        self.assertNotEqual(modified.returncode, 0)

    def test_fails_closed_on_wrong_sha_and_corrupted_visual_receipt(self):
        with self.assertRaises(OWNER.PreseedError):
            OWNER.preseed(self.repo, self.assembly, self.rootfs, "f" * 40)
        self.make_receipt(surface_source_commit="f" * 40)
        with self.assertRaises(OWNER.PreseedError):
            OWNER.preseed(self.repo, self.assembly, self.rootfs, self.sha)
        self.assertFalse((self.rootfs / "state/ordax/releases" / self.sha).exists())

    def test_rejects_tampered_visual_bytes_even_when_receipt_shas_match(self):
        self.write(self.assembly / "system/surface/ui/surface.mjs", "changed after verified source staging\n")
        with self.assertRaises(OWNER.PreseedError):
            OWNER.preseed(self.repo, self.assembly, self.rootfs, self.sha)
        self.assertFalse((self.rootfs / "state/ordax/releases" / self.sha).exists())

    def test_cannot_write_outside_disposable_creator_rootfs(self):
        foreign = self.repo.parent / "foreign"
        foreign.mkdir()
        with self.assertRaises(OWNER.PreseedError):
            OWNER.preseed(self.repo, self.assembly, foreign, self.sha)

    def test_rejects_linked_external_source_before_writing_slot(self):
        (self.assembly / "system/surface/ui/linked.mjs").symlink_to("surface.mjs")
        with self.assertRaises(OWNER.PreseedError):
            OWNER.preseed(self.repo, self.assembly, self.rootfs, self.sha)
        self.assertFalse((self.rootfs / "state/ordax/releases" / self.sha).exists())


if __name__ == "__main__":
    unittest.main()
