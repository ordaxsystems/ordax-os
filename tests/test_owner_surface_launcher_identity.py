#!/usr/bin/env python3
"""Prove one Owner Git source while Native UI starts from an immutable slot."""
from pathlib import Path
import os
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = (ROOT / "system/surface/bin/ordax-surface").read_text(encoding="utf-8")
SUPERVISOR = (ROOT / "system/supervisor").read_text(encoding="utf-8")
SHA = "a" * 40
OTHER_SHA = "b" * 40


def function(name: str) -> str:
    match = re.search(r"^" + re.escape(name) + r"\(\) \{\n(?P<body>.*?)^\}", LAUNCHER, re.M | re.S)
    if not match:
        raise AssertionError("missing launcher function: " + name)
    return name + "() {\n" + match.group("body") + "}"


class OwnerNativeSourceIdentityTests(unittest.TestCase):
    def test_supervisor_passes_exact_worktree_into_launcher(self):
        self.assertIn('ORDAX_WORKTREE="$WORKTREE" \\', SUPERVISOR)
        self.assertIn('start_surface_from_system "$active_slot/system" "$active_os_sha"', SUPERVISOR)
        self.assertIn('resolve_owner_checkout_root', function("bind_runtime_mounts"))
        self.assertIn('resolve_owner_checkout_root', function("ensure_base_update_agent"))
        self.assertIn('resolve_owner_checkout_root', function("resolve_source_identity"))
        self.assertIn('/usr/bin/git -C "$repo_root" rev-parse HEAD', function("resolve_source_identity"))

    def test_qemu_stale_runtime_process_evidence_is_bounded_and_read_only(self):
        witness = function("owner_qemu_runtime_process_evidence")
        self.assertIn("ordax.owner_qemu_graphics_probe=1", witness)
        self.assertIn('[ "$witness_root" = "$RUNTIME_ROOT" ] || continue', witness)
        self.assertIn('"/proc/$witness_pid/status"', witness)
        self.assertIn('"$recorded" -lt 12', witness)
        self.assertNotIn("/proc/$witness_pid/cmdline", witness)
        self.assertNotIn("kill ", witness)
        reaper = function("reap_stale_runtime_processes")
        self.assertIn("owner_qemu_runtime_process_evidence discovered $stale_pids", reaper)
        self.assertIn("owner_qemu_runtime_process_evidence unreaped $stale_pids", reaper)
        self.assertIn("runtime processes remain after bounded SIGKILL; refusing mount teardown", reaper)

    def test_release_slot_uses_real_git_workspace_and_rejects_untrusted_roots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "workspace/ordax"
            (worktree / ".git").mkdir(parents=True)
            (worktree / "system").mkdir()
            state = root / "state/ordax"
            slot = state / "releases" / SHA
            system = slot / "system"
            system.mkdir(parents=True)
            (slot / ".sha").write_text(SHA + "\n")
            (slot / ".ready").write_text("ready\n")
            (slot / ".surface-source-sha").write_text(OTHER_SHA + "\n")
            shell = "\n".join([
                'is_source_sha() { [ "${#1}" -eq 40 ] || return 1; case "$1" in *[!0-9a-f]*) return 1 ;; esac; }',
                function("resolve_owner_checkout_root"),
                'resolve_owner_checkout_root || exit 3',
                'printf "%s" "$repo_root"',
            ])
            env = os.environ.copy()
            env.update(ORDAX_WORKTREE=str(worktree), STATE_ROOT=str(state), SOURCE_SHA_HINT=SHA)
            def check(path, expected):
                env["SYSTEM_ROOT"] = str(path)
                res = subprocess.run(["/bin/sh", "-c", shell], env=env, capture_output=True, text=True)
                self.assertEqual(res.returncode, expected, res.stderr)
                return res
            self.assertEqual(check(system, 0).stdout, str(worktree))
            self.assertEqual(check(worktree / "system", 0).stdout, str(worktree))
            check(root / "unexpected/system", 3)
            (slot / ".sha").write_text(OTHER_SHA + "\n")
            check(system, 3)
            (slot / ".sha").write_text(SHA + "\n")
            (slot / ".ready").unlink()
            check(system, 3)
            (slot / ".ready").symlink_to("not-found")
            check(system, 3)
            (slot / ".ready").unlink()
            (slot / ".ready").write_text("ready\n")
            env["SOURCE_SHA_HINT"] = OTHER_SHA
            check(system, 3)
            env["SOURCE_SHA_HINT"] = SHA
            env["ORDAX_WORKTREE"] = "relative"
            check(system, 3)


if __name__ == "__main__":
    unittest.main()
