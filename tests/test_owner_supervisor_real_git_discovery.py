#!/usr/bin/env python3
"""Run the actual Owner Supervisor first-poll logic against a disposable Git remote.

Unlike source-only assertions, this proves remote discovery and the first-run /
initial Surface health activation boundary with a real local Git repository.
"""

from __future__ import annotations

import json
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SUPERVISOR = ROOT / "system/supervisor"


def shell_function(source: str, name: str) -> str:
    marker = f"{name}() {{"
    if source.count(marker) != 1:
        raise AssertionError(f"missing or duplicate {name} owner")
    return marker + source.split(marker, 1)[1].split("\n}\n", 1)[0] + "\n}\n"


class OwnerSupervisorRealGitDiscoveryTests(unittest.TestCase):
    def _git(self, *argv: str) -> str:
        return subprocess.run(
            ["git", *argv], check=True, capture_output=True, text=True,
        ).stdout.strip()

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="ordax-supervisor-discovery-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.seed = self.root / "seed"
        self.remote = self.root / "remote.git"
        self.worktree = self.root / "worktree"
        self.state = self.root / "state"
        self.run = self.root / "run"
        (self.state / "native-state").mkdir(parents=True)
        self.run.mkdir()
        self._git("init", "--initial-branch=main", str(self.seed))
        self._git("-C", str(self.seed), "config", "user.name", "OrdaX CI")
        self._git("-C", str(self.seed), "config", "user.email", "ordax@example.invalid")
        (self.seed / "state.txt").write_text("v1\n", encoding="utf-8")
        self._git("-C", str(self.seed), "add", "state.txt")
        self._git("-C", str(self.seed), "commit", "-m", "known-good")
        self.initial_sha = self._git("-C", str(self.seed), "rev-parse", "HEAD")
        self._git("init", "--bare", "--initial-branch=main", str(self.remote))
        self._git("-C", str(self.seed), "remote", "add", "origin", str(self.remote))
        self._git("-C", str(self.seed), "push", "-u", "origin", "main")
        self._git("clone", "--branch", "main", str(self.remote), str(self.worktree))
        (self.seed / "state.txt").write_text("v2\n", encoding="utf-8")
        self._git("-C", str(self.seed), "commit", "-am", "new main")
        self.candidate_sha = self._git("-C", str(self.seed), "rev-parse", "HEAD")
        self._git("-C", str(self.seed), "push", "origin", "main")
        self.assertNotEqual(self.initial_sha, self.candidate_sha)

        self.git_calls = self.root / "git-calls.txt"
        self.pull_called = self.root / "pull-called"
        self.state_file = self.run / "update-state"
        self.git_wrapper = self.root / "observed-git"
        git_binary = shutil.which("git")
        assert git_binary is not None
        self.git_wrapper.write_text(
            "#!/bin/sh\n"
            'printf "%s\\n" "$*" >> "$ORDAX_GIT_CALLS"\n'
            f"exec {shlex.quote(git_binary)} \"$@\"\n",
            encoding="utf-8",
        )
        self.git_wrapper.chmod(0o755)

    def _one_poll(self, receipt: str | None) -> tuple[str, str]:
        path = self.state / "native-state/first-run.json"
        if receipt is not None:
            path.write_text(receipt + "\n", encoding="utf-8")
        source = SUPERVISOR.read_text(encoding="utf-8")
        witness = shell_function(source, "record_owner_poll_boot_stage")
        poll = shell_function(source, "check_for_update")
        actual_git = shutil.which("git")
        assert actual_git
        declarations = {
            "WORKTREE": self.worktree, "STATE_DIR": self.state,
            "UPDATE_LOG": self.run / "update.log",
            "UPDATE_STATE": self.state_file,
            "OWNER_POLL_BOOT_FILE": self.state / "native-state/supervisor-boot-witness.json",
            "PINNED_FILE": self.state / "pinned-commit",
            "BOOT_REJECTED_FILE": self.state / "boot-rejected-commit",
            "REJECTED_FILE": self.state / "rejected-commit",
            "DEV_HELPERS_SHA_FILE": self.state / "dev-helpers-sha",
            "HEALTH_FILE": self.run / "healthy-sha",
            "BOOT_REFRESH_FILE": self.state / "boot-refresh-required",
            "GIT_BIN": self.git_wrapper,
            "ORDAX_GIT_CALLS": self.git_calls,
            "PULL_MARKER": self.pull_called,
        }
        script = [
            "set -eu",
            *(f"{name}={shlex.quote(str(value))}" for name, value in declarations.items()),
            "export ORDAX_GIT_CALLS",
            "DISTRIBUTION_PROFILE=owner-development",
            "OWNER_POLL_BOOT_STAGE=''",
            "OWNER_POLL_BOOT_FINISHED=0",
            "OWNER_INITIAL_HEALTH_PENDING=1",
            "BRANCH=main",
            "REMOTE_TIMEOUT=5",
            "GIT_LOW_SPEED_TIME=3",
            "UPDATE_INTERVAL=5",
            "utc_now() { printf '2026-10-20T00:00:00Z\\n'; }",
            f"current_sha() {{ {shlex.quote(actual_git)} -C \"$WORKTREE\" rev-parse HEAD; }}",
            'run_bounded_git() { shift; "$GIT_BIN" "$@"; }',
            'set_update_context() { :; }',
            'write_update_state() { printf "%s %s\\n" "$1" "$2" > "$UPDATE_STATE"; }',
            'read_state_value() { [ ! -s "$1" ] || cat "$1"; }',
            'apply_remote_checkout() { : >"$PULL_MARKER"; return 1; }',
            witness,
            poll,
            "check_for_update",
        ]
        executed = subprocess.run(
            ["/bin/sh", "-c", "\n".join(script)],
            check=False, capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(executed.returncode, 0, executed.stderr)
        marker = self.state / "native-state/supervisor-boot-witness.json"
        state = json.loads(marker.read_text(encoding="utf-8"))
        self.assertEqual(state["schema"], "ordax.owner-supervisor-first-poll/1")
        self.assertEqual(self._git("-C", str(self.worktree), "rev-parse", "HEAD"), self.initial_sha)
        self.assertFalse(self.pull_called.exists(), "Supervisor activated before Surface health")
        return state["stage"], self.git_calls.read_text() if self.git_calls.exists() else ""

    def test_first_run_not_completed_blocks_real_git_discovery(self) -> None:
        for receipt in (None, '{"completed":false}', '{"other":true}'):
            with self.subTest(receipt=receipt):
                marker = self.state / "native-state/first-run.json"
                marker.unlink(missing_ok=True)
                self.git_calls.unlink(missing_ok=True)
                stage, calls = self._one_poll(receipt)
                self.assertEqual(stage, "first-run-pending")
                self.assertEqual(calls, "")

    def test_completed_first_run_discovers_main_but_does_not_activate_unhealthy_surface(self) -> None:
        stage, calls = self._one_poll('{"completed":true}')
        self.assertEqual(stage, "git-remote-completed")
        self.assertIn("ls-remote", calls)
        self.assertIn("refs/heads/main", calls)
        self.assertEqual(self.state_file.read_text(encoding="utf-8").strip(), self.initial_sha + " applied")


if __name__ == "__main__":
    unittest.main()
