#!/usr/bin/env python3
# Same-commit OS visual source: runtime tests require Owner POSIX BusyBox.
"""Offline Git fixtures for the Owner Supervisor's pinned visual stage."""

import json
import os
import shutil
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


class OwnerSourceContractStaticTests(unittest.TestCase):
    def test_supervisor_reads_single_os_visual_revision(self):
        script = HELPER.read_text(encoding="utf-8")
        self.assertIn("OS_COMMIT_SURFACE_STAGED", script)
        self.assertIn("OS_COMMIT_SURFACE_REUSED", script)
        self.assertIn("source_policy=$(field source_policy)", script)
        self.assertIn('archive --format=tar "$os_sha"', script)
        self.assertNotIn("ordax-surface.git", script)
        self.assertNotIn("git_root=", script)

    def test_no_mutable_visual_fallback(self):
        supervisor = (ROOT / "system/supervisor").read_text(encoding="utf-8")
        self.assertIn("OWNER_SURFACE_STAGE_HELPER", supervisor)
        self.assertIn("start_surface_from_system", supervisor)

@unittest.skipUnless(Path("/bin/busybox").is_file() and Path("/usr/bin/git").is_file(), "requires Owner Linux BusyBox and Git")
class OwnerSurfaceSourceTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.os_root = self.root / "os"
        self.slot = self.root / "slot"
        for root in (self.os_root,):
            root.mkdir()
            git(root, "init", "-q")
            git(root, "config", "user.email", "source-test@localhost.invalid")
            git(root, "config", "user.name", "Source fixture")
        self.make_file(self.os_root / "system/supervisor", "#!/bin/sh\nexit 0\n")
        self.make_file(self.os_root / "system/surface/entrypoint", "#!/bin/sh\nexit 0\n")
        (self.os_root / "system/surface/entrypoint").chmod(0o755)
        self.make_file(self.os_root / "system/surface/ui/surface.mjs", "NEW_VISUAL\n")
        self.make_file(self.os_root / "system/surface/workspace/shell.tsx", "NEW_WORKSPACE\n")
        self.lock_file = self.os_root / "docs/contracts/surface-source.json"
        self.set_lock(status="canonical")
        self.slot_system = self.slot / "system"
        self.make_file(self.slot_system / "surface/ui/surface.mjs", "OLD_VISUAL\n")
        self.make_file(self.slot_system / "surface/workspace/shell.tsx", "OLD_WORKSPACE\n")
        self.make_file(self.slot_system / "surface/entrypoint", "#!/bin/sh\n")
        (self.slot_system / "surface/entrypoint").chmod(0o755)
        self.env = dict(os.environ)
        self.env["ORDAX_GIT_BIN"] = "/usr/bin/git"

    @staticmethod
    def make_file(path: Path, content: str):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def set_lock(self, status: str, source_sha=None, repository="ordaxsystems/ordax-os"):
        self.make_file(self.lock_file, json.dumps({
            "$schema": "prototype-ordax.surface-source/2",
            "status": status,
            "source_repository": repository,
            "source_ref": "same-commit",
            "source_policy": "tracked-git-blobs-only",
            "physical_disk_write_allowed": False,
            "visual_source_paths": ["system/surface/ui", "system/surface/workspace"],
        }, indent=2) + "\n")
        git(self.os_root, "add", ".")
        git(self.os_root, "commit", "-qm", "fixture OS lock")
        self.os_sha = git(self.os_root, "rev-parse", "HEAD")
        self.source_sha = self.os_sha

    def call(self, command: str, check=False, reuse_sha=None):
        arguments = ["/bin/sh", str(HELPER), command, str(self.os_root), self.os_sha, str(self.slot)]
        if reuse_sha is not None:
            arguments.append(reuse_sha)
        p = subprocess.run(
            arguments,
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
        self.assertEqual((self.os_root / "system/surface/ui/surface.mjs").read_text(), "NEW_VISUAL\n")
        self.assertEqual((self.slot / ".surface-source-sha").read_text().strip(), self.source_sha)
        self.assertFalse((self.slot / ".surface-source-git").exists())
        self.make_file(self.slot / ".sha", self.os_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        self.call("ready", check=True)
        self.make_file(self.slot / ".surface-source-sha", "0" * 40 + "\n")
        self.assertNotEqual(self.call("ready").returncode, 0)

    def test_reuses_only_matching_committed_git_visual_trees(self):
        self.call("stage", check=True)
        old_sha = self.os_sha
        self.make_file(self.slot / ".sha", old_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        self.call("ready", check=True)
        old_slot = self.root / old_sha
        self.slot.rename(old_slot)
        self.make_file(self.os_root / "docs/README.md", "documentation only\n")
        git(self.os_root, "add", "-A")
        git(self.os_root, "commit", "-qm", "docs only")
        self.os_sha = git(self.os_root, "rev-parse", "HEAD")
        self.source_sha = self.os_sha
        self.make_file(self.slot_system / "surface/entrypoint", "#!/bin/sh\n")
        (self.slot_system / "surface/entrypoint").chmod(0o755)
        result = self.call("stage", check=True, reuse_sha=old_sha)
        self.assertIn("OS_COMMIT_SURFACE_REUSED=", result.stdout)
        self.make_file(self.slot / ".sha", self.os_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        self.call("ready", check=True)
        # Corrupted older release is never reused; current Git source recovers.
        shutil.rmtree(self.slot)
        self.make_file(self.slot_system / "surface/entrypoint", "#!/bin/sh\n")
        (self.slot_system / "surface/entrypoint").chmod(0o755)
        (old_slot / "system/surface/ui/surface.mjs").write_text("tampered\n")
        fresh = self.call("stage", check=True, reuse_sha=old_sha)
        self.assertIn("OS_COMMIT_SURFACE_STAGED=", fresh.stdout)

    def test_new_visual_commit_does_not_reuse_old_tree(self):
        self.call("stage", check=True)
        old_sha = self.os_sha
        self.make_file(self.slot / ".sha", old_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        self.slot.rename(self.root / old_sha)
        self.make_file(self.os_root / "system/surface/ui/surface.mjs", "UPDATED_VISUAL\n")
        git(self.os_root, "add", "-A")
        git(self.os_root, "commit", "-qm", "visual update")
        self.os_sha = git(self.os_root, "rev-parse", "HEAD")
        self.make_file(self.slot_system / "surface/entrypoint", "#!/bin/sh\n")
        (self.slot_system / "surface/entrypoint").chmod(0o755)
        result = self.call("stage", check=True, reuse_sha=old_sha)
        self.assertIn("OS_COMMIT_SURFACE_STAGED=", result.stdout)
        self.assertEqual((self.slot_system / "surface/ui/surface.mjs").read_text(), "UPDATED_VISUAL\n")

    def test_ready_does_not_write_into_immutable_release_slot(self):
        # Ready is a read-only verifier, not a second stage writer. This is
        # necessary when the Supervisor boots from an immutable release mount.
        self.call("stage", check=True)
        self.make_file(self.slot / ".sha", self.os_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        before = {p.relative_to(self.slot).as_posix(): p.read_bytes()
                  for p in self.slot.rglob("*") if p.is_file()}
        self.slot.chmod(0o555)
        try:
            self.call("ready", check=True)
            self.call("ready", check=True)
        finally:
            self.slot.chmod(0o755)
        after = {p.relative_to(self.slot).as_posix(): p.read_bytes()
                 for p in self.slot.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        integrity = HELPER.read_text(encoding="utf-8").split(
            "source_integrity() {", 1)[1].split("\n}\n", 1)[0]
        self.assertNotIn(".surface-expected-paths.", integrity)
        self.assertNotIn(".surface-actual-paths.", integrity)
        self.assertNotIn("trap ", integrity)

    def test_ready_rejects_linked_surface_root_and_native_entrypoint(self):
        self.call("stage", check=True)
        self.make_file(self.slot / ".sha", self.os_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        self.call("ready", check=True)

        # A linked parent preserves the manifest's relative filenames and
        # contents but redirects the runtime to a mutable external directory.
        surface = self.slot_system / "surface"
        outside_surface = self.root / "mutable-external-surface"
        surface.rename(outside_surface)
        surface.symlink_to(outside_surface, target_is_directory=True)
        self.assertNotEqual(self.call("ready").returncode, 0)
        surface.unlink()
        outside_surface.rename(surface)
        self.call("ready", check=True)

        # The native launcher is outside the visual hash manifest. An
        # executable symlink must not pass readiness simply because -x does.
        entrypoint = surface / "entrypoint"
        outside_entrypoint = self.root / "mutable-native-entrypoint"
        entrypoint.rename(outside_entrypoint)
        entrypoint.symlink_to(outside_entrypoint)
        self.assertNotEqual(self.call("ready").returncode, 0)
        entrypoint.unlink()
        outside_entrypoint.rename(entrypoint)
        self.call("ready", check=True)

    def test_changed_or_injected_visual_file_blocks_reuse(self):
        self.call("stage", check=True)
        self.make_file(self.slot / ".sha", self.os_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        self.call("ready", check=True)
        target = self.slot_system / "surface/ui/surface.mjs"
        target.write_text("INJECTED_VISUAL\n", encoding="utf-8")
        self.assertNotEqual(self.call("ready").returncode, 0)
        target.write_text("NEW_VISUAL\n", encoding="utf-8")
        self.call("ready", check=True)
        self.make_file(self.slot_system / "surface/ui/unexpected.mjs", "hidden\n")
        self.assertNotEqual(self.call("ready").returncode, 0)
        (self.slot_system / "surface/ui/unexpected.mjs").unlink()
        self.call("ready", check=True)
        (self.slot_system / "surface/workspace/alias").symlink_to("shell.tsx")
        self.assertNotEqual(self.call("ready").returncode, 0)

    def test_unknown_os_commit_preserves_candidate_and_checkout(self):
        old_sha = self.os_sha
        self.os_sha = "f" * 40
        self.assertNotEqual(self.call("stage").returncode, 0)
        self.os_sha = old_sha
        self.assertEqual((self.slot_system / "surface/ui/surface.mjs").read_text(), "OLD_VISUAL\n")
        self.assertEqual((self.os_root / "system/surface/ui/surface.mjs").read_text(), "NEW_VISUAL\n")
        self.assertFalse((self.slot / ".surface-source-sha").exists())

    def test_retired_integration_candidate_is_rejected_without_mutation(self):
        # A historical pre-cutover lock may not silently succeed or stage
        # unverified visual bytes under the current canonical Supervisor.
        self.set_lock("integration-candidate")
        for action in ("status", "stage", "ready"):
            with self.subTest(action=action):
                self.assertNotEqual(self.call(action).returncode, 0)
        self.assertEqual((self.slot_system / "surface/ui/surface.mjs").read_text(), "OLD_VISUAL\n")
        self.assertFalse((self.slot / ".surface-source-sha").exists())

    def test_unknown_repository_is_rejected(self):
        self.set_lock("canonical", repository="example/alternate")
        self.assertNotEqual(self.call("status").returncode, 0)
        self.assertNotEqual(self.call("stage").returncode, 0)

    def test_committed_symlink_is_rejected_without_replacing_candidate(self):
        alias = self.os_root / "system/surface/ui/evil.mjs"
        alias.symlink_to("surface.mjs")
        git(self.os_root, "add", "-A")
        git(self.os_root, "commit", "-qm", "unsafe visual symlink")
        self.os_sha = git(self.os_root, "rev-parse", "HEAD")
        self.assertNotEqual(self.call("stage").returncode, 0)
        self.assertEqual((self.slot_system / "surface/ui/surface.mjs").read_text(), "OLD_VISUAL\n")
        self.assertFalse((self.slot / ".surface-source-sha").exists())

    def supervisor_start(self, profile: str, provision_missing: bool = False,
                         helper_override: Path | None = None):
        supervisor = (ROOT / "system/supervisor").read_text(encoding="utf-8")
        section = "start_surface() {" + supervisor.split("start_surface() {", 1)[1].split("\n}\n", 1)[0] + "\n}\n"
        receipt = self.root / "started-from.txt"
        work = self.root / "update.log"
        work.touch()
        stage_stub = ""
        if provision_missing:
            stage_stub = """
stage_candidate_release() {
  [ "$1" = "$EXPECTED_SHA" ] && [ "$2" = surface-restart ] || return 1
  slot="$RELEASES_DIR/$EXPECTED_SHA"
  mkdir -p "$slot/system/surface/ui" "$slot/system/surface/workspace"
  cp "$SYSTEM_ROOT/surface/entrypoint" "$slot/system/surface/entrypoint"
  : > "$slot/system/surface/ui/surface.mjs"
  printf '%s\\n' "$EXPECTED_SHA" > "$slot/.sha"
  printf '%s\\n' "$VISUAL_SHA" > "$slot/.surface-source-sha"
  printf 'ready\\n' > "$slot/.ready"
  (
    cd "$slot" || exit 1
    /bin/busybox find system/surface/ui system/surface/workspace -type f -print |
      LC_ALL=C /bin/busybox sort |
      while IFS= read -r p; do /bin/busybox sha256sum "$p"; done > .surface-file-hashes
  )
}
"""
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
            "VISUAL_SHA=$9\n"
            "current_sha() { printf '%s\\n' \"$EXPECTED_SHA\"; }\n"
            "start_surface_from_system() { printf '%s\\n' \"$1\" > \"$RECEIPT\"; }\n"
            "log() { :; }\n"
            + stage_stub + section + "start_surface\n"
        )
        proc = subprocess.run([
            "/bin/sh", "-c", shell, "sh", str(self.os_root),
            str(self.root / "releases"), str(self.os_root / "system"),
            str(helper_override if helper_override is not None else HELPER),
            str(work), profile, self.os_sha, str(receipt),
            self.source_sha,
        ], env=self.env, text=True, capture_output=True)
        return proc, receipt

    def test_existing_release_reuse_is_canonical_and_uses_supervisor_git(self):
        # Exercise the actual Supervisor candidate-reuse decision with a
        # lightweight Git adapter, without constructing a bootable USB image.
        supervisor = (ROOT / "system/supervisor").read_text(encoding="utf-8")
        candidate = "stage_candidate_release() {" + supervisor.split(
            "stage_candidate_release() {", 1)[1].split("\n}\n", 1)[0] + "\n}\n"
        helper = self.root / "reuse-status-helper.sh"
        helper.write_text(
            '#!/bin/sh\n'
            '[ "${ORDAX_GIT_BIN:-}" = /usr/bin/git ] || exit 11\n'
            'case "$1" in\n'
            '  status) printf "%s\\n" "$FIXTURE_STATUS";;\n'
            '  ready) exit "$FIXTURE_READY_CODE";;\n'
            '  *) exit 12;;\n'
            'esac\n',
            encoding="utf-8",
        )
        script = (
            "set -eu\n"
            "WORKTREE=$1\nRELEASES_DIR=$2\nUPDATE_RUN_DIR=$3\n"
            "OWNER_SURFACE_STAGE_HELPER=$4\n"
            "OWNER_INTELLIGENCE_STAGE_HELPER=$5\n"
            "GIT_BIN=/usr/bin/git\n"
            "UPDATE_LOG=$6\nSTAGED_RELEASE_FILE=$7\nLAST_STAGE_DURATION_FILE=$8\n"
            "CANDIDATE_SHA=$9\nSTAGE_TIMEOUT=1\n"
            "epoch_now() { printf '1\\n'; }\n"
            "write_state_value() { printf '%s\\n' \"$2\" > \"$1\"; }\n"
            "record_elapsed_seconds() { :; }\n"
            "run_bounded_git() { return 1; }\n"
            "log() { :; }\n"
            + candidate + 'stage_candidate_release "$CANDIDATE_SHA" surface-restart\n'
        )
        for status, ready_code, should_reuse in (
            ("canonical", 0, True),
            ("integration-candidate", 0, False),
            ("canonical", 1, False),
        ):
            with self.subTest(status=status, ready_code=ready_code):
                root = self.root / f"candidate-{status}-{ready_code}"
                releases = root / "releases"
                stage = releases / self.os_sha
                (stage / "system").mkdir(parents=True)
                self.make_file(stage / ".ready", "ready\n")
                update = root / "update"
                update.mkdir()
                log_file = root / "update.log"
                marker = root / "staged.txt"
                elapsed = root / "elapsed.txt"
                env = dict(self.env, FIXTURE_STATUS=status,
                           FIXTURE_READY_CODE=str(ready_code))
                proc = subprocess.run(
                    ["/bin/sh", "-c", script, "sh", str(self.os_root),
                     str(releases), str(update), str(helper),
                     str(root / "no-intelligence-helper"), str(log_file),
                     str(marker), str(elapsed), self.os_sha],
                    env=env, capture_output=True, text=True,
                )
                if should_reuse:
                    self.assertEqual(proc.returncode, 0, proc.stderr)
                    self.assertEqual(marker.read_text().strip(), self.os_sha)
                    self.assertTrue((stage / ".ready").exists())
                else:
                    self.assertNotEqual(proc.returncode, 0)
                    self.assertFalse(marker.exists())

    def test_no_unverified_fallback_on_first_cold_boot(self):
        # Do not execute the mutable checkout when a verified release is absent.
        proc, marker = self.supervisor_start("owner-development")
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(marker.exists())

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

    def test_supervisor_rejects_rollback_to_noncanonical_commit(self):
        self.call("stage", check=True)
        valid_sha = self.os_sha
        self.make_file(self.slot / ".sha", valid_sha + "\n")
        self.make_file(self.slot / ".ready", "ready\n")
        releases = self.root / "releases"
        releases.mkdir()
        self.slot.rename(releases / valid_sha)
        self.set_lock("integration-candidate")
        proc, marker = self.supervisor_start("owner-development")
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(marker.exists())
        self.assertEqual((releases / valid_sha / ".surface-source-sha").read_text().strip(), valid_sha)

    def test_noncanonical_owner_source_must_not_boot_from_git_tree(self):
        self.set_lock("integration-candidate")
        proc, marker = self.supervisor_start("owner-development")
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(marker.exists())

    def test_missing_stage_helper_must_not_boot_from_git_tree(self):
        missing = self.root / "no-such-surface-stage-helper.sh"
        proc, marker = self.supervisor_start("owner-development", helper_override=missing)
        self.assertNotEqual(proc.returncode, 0, "missing staging owner must fail closed")
        self.assertFalse(marker.exists(), "mutable OS visuals must never start")


if __name__ == "__main__":
    unittest.main()
