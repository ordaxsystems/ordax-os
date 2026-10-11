"""Regression: the Guardian and Supervisor must publish numeric process identities.

A literal "$" is not a valid PID. A prior source regression caused stale
heartbeats, repeated Guardian restarts and recovery on a healthy development
USB after an otherwise successful Git checkout.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "system" / "entrypoint"
SUPERVISOR = ROOT / "system" / "supervisor"
GUARDIAN_TEXT = ENTRY.read_text(encoding="utf-8")
SUPERVISOR_TEXT = SUPERVISOR.read_text(encoding="utf-8")


def shell_function(text, name):
    marker = name + "() {\n"
    assert text.count(marker) == 1, name
    return marker + text.split(marker, 1)[1].split("\n}\n", 1)[0] + "\n}\n"


class SupervisorProcessHeartbeatTests(unittest.TestCase):
    def test_guardian_and_supervisor_parse(self):
        for path in (ENTRY, SUPERVISOR):
            subprocess.run(["sh", "-n", str(path)], check=True)

    def test_starting_guardian_records_its_numeric_pid(self):
        self.assertIn('write_pid "$GUARDIAN_PID_FILE" "$$"', GUARDIAN_TEXT)
        self.assertIn('log "guardian started pid=$$"', GUARDIAN_TEXT)
        self.assertNotIn('write_pid "$GUARDIAN_PID_FILE" "$"', GUARDIAN_TEXT)
        self.assertNotIn('log "guardian started pid=$"', GUARDIAN_TEXT)

    def test_runtime_supervisor_heartbeat_matches_the_running_shell(self):
        source = shell_function(SUPERVISOR_TEXT, "supervisor_heartbeat")
        source = source.replace("/bin/busybox mv -f", "mv -f")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "beat"
            script = (
                "set -eu\n"
                + 'SUPERVISOR_HEARTBEAT_FILE="$1"\n'
                + source
                + 'supervisor_heartbeat\n'
                + 'cat "$SUPERVISOR_HEARTBEAT_FILE"\n'
                + 'printf "%s\n" "$$"\n'
            )
            process = subprocess.run(
                ["sh", "-c", script, "test", str(output)],
                text=True, capture_output=True, timeout=5, check=True,
            )
            recorded, live_pid = process.stdout.strip().splitlines()
            self.assertTrue(recorded.isdecimal(), process.stdout)
            self.assertGreater(int(recorded), 1)
            self.assertEqual(recorded, live_pid)
            self.assertEqual(output.read_text(encoding="utf-8").strip(), live_pid)

    def test_guardian_accepts_current_pid_and_rejects_mismatched_heartbeat(self):
        beat = shell_function(SUPERVISOR_TEXT, "supervisor_heartbeat")
        epoch = shell_function(GUARDIAN_TEXT, "state_epoch")
        beat = beat.replace("/bin/busybox mv -f", "mv -f")
        epoch = epoch.replace("/bin/busybox ", "")
        with tempfile.TemporaryDirectory() as directory:
            pulse = Path(directory) / "supervisor-heartbeat"
            state = Path(directory) / "state.json"
            script = (
                "set -eu\n"
                + 'SUPERVISOR_HEARTBEAT_FILE="$1"\n'
                + 'UPDATE_STATE="$2"\n'
                + 'SUPERVISOR_PID=$$\n'
                + beat + epoch
                + 'supervisor_heartbeat\n'
                + 'state_epoch\n'
                + 'SUPERVISOR_PID=999999999\n'
                + 'state_epoch\n'
            )
            process = subprocess.run(
                ["sh", "-c", script, "test", str(pulse), str(state)],
                text=True, capture_output=True, timeout=5, check=True,
            )
            healthy_epoch, rejected_epoch = process.stdout.strip().splitlines()
            self.assertGreater(int(healthy_epoch), 1, process.stdout)
            self.assertEqual(rejected_epoch, "1")


if __name__ == "__main__":
    unittest.main()
