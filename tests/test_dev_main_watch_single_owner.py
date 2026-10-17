#!/usr/bin/env python3
"""Contracts for the Dev console/main-watch to runtime supervisor ownership handoff."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
MAIN_WATCH = ROOT / "bootstrap/dev-base/ordax-main-watch"
DEV_HELPERS = ROOT / "system/services/base-update/dev-helpers.sh"


class DevMainWatchSingleOwnerTest(unittest.TestCase):
    def test_scripts_remain_valid_shell(self) -> None:
        for script in (MAIN_WATCH, DEV_HELPERS):
            subprocess.run(["/bin/sh", "-n", str(script)], check=True)

    def test_main_watch_defers_to_live_supervisor_before_pull(self) -> None:
        text = MAIN_WATCH.read_text(encoding="utf-8")
        self.assertIn("SUPERVISOR_HEARTBEAT_FILE=$RUN_DIR/supervisor-heartbeat", text)
        self.assertIn("RUNTIME_SURFACE_SHA_FILE=$STATE_DIR/runtime-surface-sha", text)
        self.assertIn("active_supervisor_pid()", text)
        self.assertIn('case "$command_line" in', text)
        self.assertIn('*"/system/supervisor"*', text)
        self.assertIn("handoff_runtime_drift_if_needed()", text)
        self.assertIn('kill -TERM "$pid"', text)
        self.assertIn("PINNED_FILE=$STATE_DIR/pinned-commit", text)
        self.assertIn("BOOT_REJECTED_FILE=$STATE_DIR/boot-rejected-commit", text)
        self.assertIn('ORDAX_AUTOMATIC_ROLLBACK_RECOVERY=1 "$BIN_DIR/ordax-pull"', text)
        self.assertIn("manual rollback pin active; automatic main update blocked", text)
        self.assertIn("LOCK_PID_FILE=$LOCK_DIR/pid", text)
        self.assertIn("watch_lock_owner_alive()", text)
        self.assertIn("stale watch lock reclaimed", text)
        self.assertIn("sleep_interval()", text)
        self.assertIn("terminate_watch()", text)
        loop = text.split("while :; do", 1)[1]
        self.assertLess(
            loop.index("active_supervisor_pid"),
            loop.index('"$BIN_DIR/ordax-pull"'),
        )
        self.assertIn("sincronizacao da main delegada ao owner canonico", loop)

    def test_helper_refresh_hands_running_watcher_to_new_binary(self) -> None:
        text = DEV_HELPERS.read_text(encoding="utf-8")
        self.assertIn("watcher_changed=1", text)
        self.assertIn("schedule_main_watch_refresh()", text)
        self.assertIn('*"/usr/local/bin/ordax-main-watch"*', text)
        self.assertIn('kill -TERM "\\$pid"', text)
        self.assertNotIn('rm -rf "$RUN_DIR/main-watch.lock"', text)
        self.assertIn("replacement watcher validates the recorded PID", text)
        self.assertIn("exec /bin/setsid /usr/local/bin/ordax-main-watch", text)
        self.assertLess(
            text.index("schedule_main_watch_refresh"),
            text.rindex("ORDAX_DEV_HELPERS_SHA"),
        )

    def _watch_fixture(self, root: Path) -> tuple[dict[str, str], Path, Path, Path]:
        worktree = root / "worktree"
        state = root / "state"
        run_dir = root / "run"
        bin_dir = root / "bin"
        for directory in (worktree, state, run_dir, bin_dir):
            directory.mkdir(parents=True, exist_ok=True)

        subprocess.run(["git", "init", "--initial-branch=main", str(worktree)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(worktree), "config", "user.name", "OrdaX Test"], check=True)
        subprocess.run(["git", "-C", str(worktree), "config", "user.email", "ordax-test@example.invalid"], check=True)
        (worktree / "fixture.txt").write_text("known-good\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(worktree), "add", "fixture.txt"], check=True)
        subprocess.run(["git", "-C", str(worktree), "commit", "-m", "known-good"], check=True, capture_output=True)

        marker = root / "pull-called"
        pull = bin_dir / "ordax-pull"
        pull.write_text(
            '#!/bin/sh\n: > "$ORDAX_TEST_PULL_MARKER"\nexit 99\n',
            encoding="utf-8",
        )
        pull.chmod(0o755)

        env = os.environ.copy()
        env.update(
            {
                "ORDAX_BIN_DIR": str(bin_dir),
                "ORDAX_STATE_DIR": str(state),
                "ORDAX_UPDATE_RUN_DIR": str(run_dir),
                "ORDAX_WORKTREE": str(worktree),
                "ORDAX_UPDATE_INTERVAL_SECONDS": "5",
                "ORDAX_TEST_PULL_MARKER": str(marker),
            }
        )
        return env, state, run_dir, marker

    def _wait_for_log(self, log_file: Path, needle: str, process: subprocess.Popen[str]) -> None:
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            if log_file.exists() and needle in log_file.read_text(encoding="utf-8"):
                return
            if process.poll() is not None:
                break
            time.sleep(0.05)
        content = log_file.read_text(encoding="utf-8") if log_file.exists() else "<missing>"
        self.fail(f"watch log did not contain {needle!r}; content={content!r}")

    def test_manual_rollback_pin_blocks_background_pull(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            env, state, run_dir, marker = self._watch_fixture(root)
            head = subprocess.run(
                ["git", "-C", env["ORDAX_WORKTREE"], "rev-parse", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            (state / "pinned-commit").write_text(head + "\n", encoding="ascii")

            process = subprocess.Popen(
                ["/bin/sh", str(MAIN_WATCH)],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            try:
                self._wait_for_log(
                    state / "main-watch.log",
                    "manual rollback pin active; automatic main update blocked until explicit ordax-pull",
                    process,
                )
                self.assertFalse(marker.exists())
            finally:
                process.terminate()
                process.wait(timeout=3)

            self.assertFalse((run_dir / "main-watch.lock").exists())

    def test_stale_watcher_lock_is_reclaimed_without_deleting_live_lock(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            env, state, run_dir, _marker = self._watch_fixture(root)
            lock_dir = run_dir / "main-watch.lock"
            lock_dir.mkdir()
            (lock_dir / "pid").write_text("99999999\n", encoding="ascii")

            process = subprocess.Popen(
                ["/bin/sh", str(MAIN_WATCH)],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            try:
                self._wait_for_log(state / "main-watch.log", "stale watch lock reclaimed", process)
            finally:
                process.terminate()
                process.wait(timeout=3)

            self.assertFalse(lock_dir.exists())


if __name__ == "__main__":
    unittest.main()
