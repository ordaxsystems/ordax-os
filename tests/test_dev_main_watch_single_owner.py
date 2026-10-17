#!/usr/bin/env python3
"""Contracts for the Dev console/main-watch to runtime supervisor ownership handoff."""

from __future__ import annotations

from pathlib import Path
import subprocess
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
        self.assertIn('rm -rf "$RUN_DIR/main-watch.lock"', text)
        self.assertIn("exec /bin/setsid /usr/local/bin/ordax-main-watch", text)
        self.assertLess(
            text.index("schedule_main_watch_refresh"),
            text.rindex("ORDAX_DEV_HELPERS_SHA"),
        )


if __name__ == "__main__":
    unittest.main()
