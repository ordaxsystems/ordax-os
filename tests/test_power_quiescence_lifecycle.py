#!/usr/bin/env python3
"""Prove canonical Surface/Guardian shutdown ordering with disposable processes."""

from __future__ import annotations

from pathlib import Path
import os
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system/surface/bin/ordax-surface"
SUPERVISOR = ROOT / "system/supervisor"
GUARDIAN = ROOT / "system/entrypoint"


def function_source(source: str, name: str) -> str:
    needle = f"{name}() {{\n"
    if source.count(needle) != 1:
        raise AssertionError(f"expected exactly one owner for {name}")
    return needle + source.split(needle, 1)[1].split("\n}\n", 1)[0] + "\n}\n"


class PowerQuiescenceTests(unittest.TestCase):
    def test_power_shutdown_graces_cover_owned_runtime_teardown(self) -> None:
        surface = SURFACE.read_text(encoding="utf-8")
        supervisor = SUPERVISOR.read_text(encoding="utf-8")
        guardian = GUARDIAN.read_text(encoding="utf-8")
        for path in (SURFACE, SUPERVISOR, GUARDIAN):
            subprocess.run(["/bin/sh", "-n", str(path)], check=True)
        self.assertIn("quiesce_surface_children\n", function_source(surface, "cleanup"))
        # The aggregate managed shutdown deadline is four seconds; subsequent
        # orphaned runtime processes have a separate five-second fence.
        self.assertIn("remaining=4", function_source(surface, "quiesce_surface_children"))
        self.assertIn("remaining=5", function_source(surface, "reap_stale_runtime_processes"))
        self.assertIn("remaining=14", function_source(supervisor, "stop_surface"))
        self.assertIn("remaining=24", function_source(guardian, "quiesce_supervisor_for_power_transition"))
        self.assertLess(
            guardian.index("quiesce_supervisor_for_power_transition"),
            guardian.index("terminate_persistent_host_agents"),
        )
        self.assertIn(
            'proof="$pid"',
            function_source(guardian, "quiesce_supervisor_for_power_transition").replace(
                '[ "$proof" = "$pid" ]', 'proof="$pid"'
            ),
        )

    def _run_fixture(self, *, stubborn: bool) -> tuple[float, subprocess.CompletedProcess[str]]:
        function = function_source(SURFACE.read_text(encoding="utf-8"), "quiesce_surface_children")
        with tempfile.TemporaryDirectory(prefix="ordax-power-proof-") as temp:
            path = Path(temp)
            sleeper = (
                "python3 -c 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)'"
                if stubborn else
                "/bin/busybox sleep 30"
            )
            script = "\n".join([
                "set -eu",
                function,
                "HOST_LOG=" + repr(str(path / "host.log")),
                "/bin/busybox sleep 30 &",
                "SENTINEL_PID=$!",
                sleeper + " &",
                "NATIVE_INSTALL_BROKER_PID=$!",
                "/bin/busybox sleep 30 &",
                "NETWORK_BROKER_PID=$!",
                "/bin/busybox sleep 30 &",
                "TIME_SYNC_PID=$!",
                "POWER_BROKER_PID=''",
                "KEYBOARD_SESSION_RESTART_BROKER_PID=''",
                "GRAPHICS_PID=''",
                "HTTP_PID=''",
                "/bin/busybox sleep 1",  # ensure stubborn Python installs handler
                "quiesce_surface_children",
                'kill -0 "$SENTINEL_PID"',  # unrelated process is untouched
                'for p in "$NATIVE_INSTALL_BROKER_PID" "$NETWORK_BROKER_PID" "$TIME_SYNC_PID"; do',
                '  if kill -0 "$p" 2>/dev/null; then',
                "    state=$(/bin/busybox awk '$1 == \"State:\" {print $2; exit}' \"/proc/$p/status\" 2>/dev/null || true)",
                '    [ "$state" = Z ] || exit 4',
                '  fi',
                'done',
                'kill "$SENTINEL_PID"',
                'wait "$SENTINEL_PID" 2>/dev/null || true',
                "printf 'QUIESCED=YES\\n'",
            ])
            started = time.monotonic()
            result = subprocess.run(
                ["/bin/sh", "-c", script],
                capture_output=True,
                text=True,
                timeout=12,
            )
            return time.monotonic() - started, result

    def test_persistent_agent_termination_distinguishes_zombies(self) -> None:
        guardian = GUARDIAN.read_text(encoding="utf-8")
        function = function_source(guardian, "terminate_persistent_agent")
        session_check = function_source(guardian, "persistent_agent_session_active")
        session_identity = function_source(guardian, "persistent_agent_isolated_session")

        # Both the graceful and forced phase must check ALL live members of
        # the verified private session, not only its leader. A surviving
        # orphan shell can otherwise hold a writable ext4 rootfs FD open.
        self.assertEqual(function.count('while [ "$remaining" -gt 0 ]; do'), 2)
        self.assertEqual(
            function.count('persistent_agent_session_active "$pid" || break'), 2
        )
        self.assertEqual(function.count('supervisor_process_active "$pid" || break'), 2)
        self.assertIn('persistent_agent_session_active "$pid" && return 1', function)
        self.assertIn('supervisor_process_active "$pid" && return 1', function)

        # Group signals are permitted only after verifying matching PID,
        # PGID and SID. The unverified fallback remains PID-only.
        self.assertIn('if persistent_agent_isolated_session "$pid"; then', function)
        self.assertIn('[ "$group_session" = "$pid:$pid" ]', session_identity)
        self.assertIn('kill -TERM "-$pid"', function)
        self.assertIn('kill -KILL "-$pid"', function)
        self.assertIn('kill "$pid"', function)
        self.assertIn('kill -KILL "$pid"', function)
        self.assertIn('if [ "$isolated_session" -eq 1 ]; then', function)

        # Dead/zombie session members must not cause a false timeout.
        self.assertIn('$1 != "Z"', session_check)
        self.assertIn('$1 != "X"', session_check)
        self.assertNotIn('while kill -0 "$pid"', function)

    def test_power_failure_stages_are_durable_and_whitelisted(self) -> None:
        guardian = GUARDIAN.read_text(encoding="utf-8")
        stage_function = function_source(guardian, "record_host_power_stage")
        failure_function = function_source(guardian, "record_host_power_failure")
        transition = function_source(guardian, "perform_host_power_transition")
        self.assertIn("POWER_LAST_STAGE=$POWER_STATE_DIR/last-stage", guardian)
        self.assertIn("POWER_LAST_FAILURE=$POWER_STATE_DIR/last-failure", guardian)
        for token in ("accepted", "supervisor-quiesce", "host-agents",
                      "filesystem-sync", "root-readonly"):
            self.assertIn("record_host_power_stage " + token, transition)
        for reason in ("supervisor-quiesce-failed", "host-agents-failed",
                       "sync-failed", "remount-failed", "root-still-writable",
                       "kernel-transition-returned"):
            self.assertIn(reason, guardian)
        self.assertLess(
            transition.index("record_host_power_stage root-readonly"),
            transition.index("remount_root_read_only_for_power"),
        )
        with tempfile.TemporaryDirectory(prefix="ordax-power-receipts-") as temp:
            path = Path(temp)
            script = "\n".join([
                "set -eu",
                stage_function,
                failure_function,
                "POWER_LAST_STAGE=" + repr(str(path / "last-stage")),
                "POWER_LAST_FAILURE=" + repr(str(path / "last-failure")),
                "record_host_power_stage supervisor-quiesce",
                "record_host_power_failure supervisor-quiesce-failed",
                "record_host_power_stage unexpected && exit 9 || :",
                "record_host_power_failure private_secret && exit 9 || :",
            ])
            completed = subprocess.run(["/bin/sh", "-c", script],
                                       capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual((path / "last-stage").read_text().strip(),
                             "supervisor-quiesce")
            self.assertEqual((path / "last-failure").read_text().strip(),
                             "supervisor-quiesce-failed")

    def test_bind_root_readonly_transition_is_profile_scoped_and_fail_closed(self) -> None:
        guardian = GUARDIAN.read_text(encoding="utf-8")
        remount = function_source(guardian, "remount_root_read_only_for_power")
        transition = function_source(guardian, "perform_host_power_transition")
        self.assertIn('mount -o remount,bind,ro / /', remount)
        self.assertIn('mount -o remount,ro /', remount)
        self.assertIn('if ! remount_root_read_only_for_power; then', transition)
        self.assertIn('    if ! root_filesystem_is_read_only; then', transition)
        self.assertIn('remount-failed', transition)
        self.assertIn('root-still-writable', transition)
        self.assertLess(
            transition.index('remount_root_read_only_for_power'),
            transition.index('root_filesystem_is_read_only'),
        )
        with tempfile.TemporaryDirectory(prefix="ordax-power-mount-") as temp:
            path = Path(temp)
            calls = path / "mount-calls"
            command = path / "busybox"
            command.write_text(
                '#!/bin/sh\n'
                'printf "%s" "$*" >"$CALLS"\n'
                '[ "$BUSYBOX_FAIL" != 1 ]\n',
                encoding="utf-8",
            )
            command.chmod(0o700)
            # Substitute only the external mount command; do not remount the
            # CI runner's root. Run the unmodified profile branch logic.
            remount = remount.replace('/bin/busybox mount', '"$BUSYBOX" mount')
            script = remount + "\nremount_root_read_only_for_power\n"
            base_env = {
                **os.environ,
                "BUSYBOX": str(command),
                "CALLS": str(calls),
                "GUARDIAN_LOG": str(path / "guardian.log"),
                "BUSYBOX_FAIL": "0",
            }
            for profile, expected in (
                ("owner-development", "mount -o remount,bind,ro / /"),
                ("stable-mvp", "mount -o remount,ro /"),
            ):
                calls.unlink(missing_ok=True)
                env = {**base_env, "DISTRIBUTION_PROFILE": profile}
                result = subprocess.run(
                    ["/bin/sh", "-c", script],
                    env=env, capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(calls.read_text(encoding="utf-8"), expected)
                failed = subprocess.run(
                    ["/bin/sh", "-c", script],
                    env={**env, "BUSYBOX_FAIL": "1"},
                    capture_output=True, text=True,
                )
                self.assertEqual(failed.returncode, 1, failed.stderr)
            calls.unlink(missing_ok=True)
            rejected = subprocess.run(
                ["/bin/sh", "-c", script],
                env={**base_env, "DISTRIBUTION_PROFILE": "unexpected"},
                capture_output=True, text=True,
            )
            self.assertEqual(rejected.returncode, 1)
            self.assertFalse(calls.exists())

    def test_abort_remount_uses_matching_explicit_bind_and_never_bypasses_ro_proof(self) -> None:
        guardian = GUARDIAN.read_text(encoding="utf-8")
        abort = function_source(guardian, "remount_root_read_write_after_power_abort")
        transition = function_source(guardian, "perform_host_power_transition")
        self.assertIn('/bin/busybox mount -o remount,bind,rw / /', abort)
        self.assertIn('/bin/busybox mount -o remount,rw /', abort)
        self.assertNotIn('/bin/busybox mount -o remount,rw / >/dev/null', transition)
        self.assertIn("if remount_root_read_write_after_power_abort; then", transition)
        self.assertIn("remount_root_read_write_after_power_abort || true", transition)
        self.assertLess(
            transition.index("root_filesystem_is_read_only"),
            transition.index("/bin/busybox poweroff -f"),
        )
        with tempfile.TemporaryDirectory(prefix="ordax-abort-remount-") as temp:
            path = Path(temp)
            calls = path / "calls"
            busybox = path / "busybox"
            busybox.write_text(
                '#!/bin/sh\n'
                'printf "%s" "$*" >"$CALLS"\n'
                '[ "$BUSYBOX_FAIL" != 1 ]\n',
                encoding="utf-8",
            )
            busybox.chmod(0o700)
            script = abort.replace('/bin/busybox mount', '"$BUSYBOX" mount')
            script += "\nremount_root_read_write_after_power_abort\n"
            for profile, expected in (
                ("owner-development", "mount -o remount,bind,rw / /"),
                ("stable-mvp", "mount -o remount,rw /"),
            ):
                env = {**os.environ, "DISTRIBUTION_PROFILE": profile,
                       "BUSYBOX": str(busybox), "CALLS": str(calls),
                       "GUARDIAN_LOG": str(path / "guardian.log"),
                       "BUSYBOX_FAIL": "0"}
                result = subprocess.run(["/bin/sh", "-c", script],
                                        env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(calls.read_text(encoding="utf-8"), expected)
                rejected = subprocess.run(
                    ["/bin/sh", "-c", script],
                    env={**env, "BUSYBOX_FAIL": "1"},
                    capture_output=True, text=True,
                )
                self.assertEqual(rejected.returncode, 1, rejected.stderr)

    def test_power_failure_receipts_use_process_unique_temporary_paths(self) -> None:
        guardian = GUARDIAN.read_text(encoding="utf-8")
        stage = function_source(guardian, "record_host_power_stage")
        failure = function_source(guardian, "record_host_power_failure")
        self.assertIn('temporary=$POWER_LAST_STAGE.tmp.$$', stage)
        self.assertIn('temporary=$POWER_LAST_FAILURE.tmp.$$', failure)

    def test_guardian_recognizes_exited_but_unreaped_supervisor(self) -> None:
        """No false timeout on zombie: only the matching quiesce receipt grants power."""
        source = function_source(
            GUARDIAN.read_text(encoding="utf-8"), "supervisor_process_active"
        )
        zombie = subprocess.Popen(["/bin/true"])
        try:
            # Keep this child's PID unreaped deliberately. kill -0 still
            # succeeds, but the canonical Guardian must not call it active.
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                state_file = Path(f"/proc/{zombie.pid}/status")
                if state_file.exists() and "\nState:\tZ" in state_file.read_text():
                    break
                time.sleep(0.02)
            else:
                self.skipTest("runner does not preserve observable zombie state")
            self.assertEqual(
                subprocess.run(
                    ["/bin/sh", "-c", source + f"\nsupervisor_process_active {zombie.pid}\n"],
                    check=False, capture_output=True, text=True,
                ).returncode,
                1,
            )
        finally:
            zombie.wait(timeout=5)

        live = subprocess.Popen(["/bin/busybox", "sleep", "10"])
        try:
            self.assertEqual(
                subprocess.run(
                    ["/bin/sh", "-c", source + f"\nsupervisor_process_active {live.pid}\n"],
                    check=False, capture_output=True, text=True,
                ).returncode,
                0,
            )
        finally:
            live.terminate()
            live.wait(timeout=5)

    def test_cooperative_children_terminate_as_a_group(self) -> None:
        elapsed, result = self._run_fixture(stubborn=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("QUIESCED=YES", result.stdout)
        self.assertLess(elapsed, 4, "sequential child teardown reintroduced")

    def test_stubborn_child_is_bounded_and_cannot_block_others(self) -> None:
        elapsed, result = self._run_fixture(stubborn=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("QUIESCED=YES", result.stdout)
        self.assertLess(elapsed, 8, "stubborn child escaped the aggregate deadline")


if __name__ == "__main__":
    unittest.main()
