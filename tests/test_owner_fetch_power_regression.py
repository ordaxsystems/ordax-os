#!/usr/bin/env python3
"""Exercise real child cancellation and durable, allowlisted Git-failure receipts."""

from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SUPERVISOR = ROOT / "system/supervisor"


def source_function(name: str) -> str:
    source = SUPERVISOR.read_text(encoding="utf-8")
    marker = f"{name}() {{\n"
    if source.count(marker) != 1:
        raise AssertionError(f"expected one canonical {name}")
    return marker + source.split(marker, 1)[1].split("\n}\n", 1)[0] + "\n}\n"


def portable_shell(functions: tuple[str, ...]) -> str:
    # CI exercises the exact checked-in shell bodies with system utilities;
    # the target rootfs still requires BusyBox setsid/timeout capability.
    parts = [source_function(name) for name in functions]
    script = "\n".join(parts)
    return script.replace("/bin/busybox ", "")


def active_process(pid: int) -> bool:
    try:
        state = Path(f"/proc/{pid}/status").read_text(encoding="ascii")
        return not any(line.startswith("State:") and "\tZ" in line for line in state.splitlines())
    except FileNotFoundError:
        return False


class OwnerFetchPowerRegressionTests(unittest.TestCase):
    def test_shell_and_single_authority_contract(self) -> None:
        subprocess.run(["/bin/sh", "-n", str(SUPERVISOR)], check=True)
        script = SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn('trap terminate HUP INT TERM', script)
        self.assertIn('    cancel_active_git\n    stop_surface', source_function("terminate"))
        self.assertIn('record_non_ff_target "$checkout_previous_sha" "$checkout_target_sha"', script)
        self.assertIn('if non_ff_target_blocked "$current" "$remote_sha"; then', script)
        self.assertIn('if fetch_retry_pending "$remote_sha"; then', script)
        self.assertIn('2>"$FETCH_ERROR_FILE"', script)
        self.assertIn('rm -f "$FETCH_ERROR_FILE"', script)

    def test_failed_fetch_receipt_backoff_and_divergence_block(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state = root / "native-state"
            state.mkdir()
            error = root / "git-error"
            error.write_text(
                "fatal: Could not resolve host: private.example token=SECRET-NEVER-PERSIST\n",
                encoding="utf-8",
            )
            script = "\n".join([
                "set -eu",
                "epoch_now() { date +%s; }",
                portable_shell((
                    "classify_fetch_error",
                    "record_fetch_failure",
                    "fetch_retry_pending",
                    "non_ff_target_blocked",
                    "record_non_ff_target",
                )),
                f"FETCH_RETRY_FILE={shlex.quote(str(state / 'git-fetch-retry'))}",
                f"FETCH_FAILURE_RECEIPT={shlex.quote(str(state / 'git-fetch-last.tsv'))}",
                f"NON_FF_BLOCKED_FILE={shlex.quote(str(state / 'git-non-ff-target'))}",
                f"kind=$(classify_fetch_error {shlex.quote(str(error))} 128)",
                '[ "$kind" = dns ]',
                'record_fetch_failure abc123 100 128 "$kind"',
                'record_fetch_failure abc123 100 128 "$kind"',
                "fetch_retry_pending abc123",
                "if fetch_retry_pending other; then exit 13; fi",
                "record_non_ff_target deadbeef abc123",
                "non_ff_target_blocked deadbeef abc123",
                "if non_ff_target_blocked deadbeef another; then exit 14; fi",
            ])
            subprocess.run(["/bin/sh", "-c", script], check=True, timeout=5)
            receipt_file = state / "git-fetch-last.tsv"
            receipt = receipt_file.read_text(encoding="utf-8")
            fields = receipt.strip().split("\t")
            self.assertEqual(fields[0], "ordax.git-fetch-failure/1")
            self.assertEqual(fields[1], "abc123")
            self.assertEqual(fields[4], "128")
            self.assertEqual(fields[5], "dns")
            self.assertEqual(fields[6], "2")
            self.assertNotIn("SECRET-NEVER-PERSIST", receipt)
            self.assertEqual(stat.S_IMODE(receipt_file.stat().st_mode), 0o600)
            self.assertGreater(int(fields[7]), int(time.time()))
            self.assertEqual((state / "git-non-ff-target").read_text().strip(), "deadbeef abc123")

    @unittest.skipUnless(shutil.which("setsid") and shutil.which("timeout"), "Linux session tools unavailable")
    def test_term_during_real_blocking_git_kills_its_process_group(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            mock_git = path / "mock-git"
            git_pid = path / "git.pid"
            child_pid = path / "child.pid"
            completed = path / "quiesced"
            mock_git.write_text(
                "#!/bin/sh\n"
                f"printf '%s\\n' \"$$\" > {shlex.quote(str(git_pid))}\n"
                "sleep 90 &\n"
                f"printf '%s\\n' \"$!\" > {shlex.quote(str(child_pid))}\n"
                "wait\n",
                encoding="utf-8",
            )
            mock_git.chmod(0o700)
            shell = "\n".join([
                "set -eu",
                portable_shell(("run_bounded_git", "cancel_active_git")),
                f"GIT_BIN={shlex.quote(str(mock_git))}",
                "GIT_LOW_SPEED_TIME=15",
                'GIT_JOB_PID=""',
                'power_quiesce() { cancel_active_git; ' +
                f"printf 'ack\\n' > {shlex.quote(str(completed))}; exit 0; }}",
                "trap power_quiesce TERM",
                "run_bounded_git 45 -C /tmp fetch --no-tags origin refs/heads/main",
            ])
            supervisor = subprocess.Popen(
                ["/bin/sh", "-c", shell],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
            )
            try:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline and not (git_pid.exists() and child_pid.exists()):
                    time.sleep(0.05)
                self.assertTrue(git_pid.exists() and child_pid.exists(), "fake fetch never started")
                child = int(child_pid.read_text().strip())
                worker = int(git_pid.read_text().strip())
                started = time.monotonic()
                supervisor.send_signal(signal.SIGTERM)
                supervisor.communicate(timeout=5)
                self.assertLess(time.monotonic() - started, 4)
                self.assertEqual(supervisor.returncode, 0)
                self.assertEqual(completed.read_text().strip(), "ack")
                for _ in range(30):
                    if not active_process(child) and not active_process(worker):
                        break
                    time.sleep(0.05)
                self.assertFalse(active_process(child), "git-descendant survived power quiesce")
                self.assertFalse(active_process(worker), "git worker survived power quiesce")
            finally:
                if supervisor.poll() is None:
                    supervisor.kill()
                    supervisor.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
