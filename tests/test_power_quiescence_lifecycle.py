#!/usr/bin/env python3
"""Prove canonical Surface/Guardian shutdown ordering with disposable processes."""

from __future__ import annotations

from pathlib import Path
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
        self.assertEqual(function.count('while supervisor_process_active "$pid"'), 2)
        self.assertIn('if supervisor_process_active "$pid"; then', function)
        self.assertIn('supervisor_process_active "$pid" && return 1', function)
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
            transition.index("mount -o remount,ro /"),
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
