"""Isolated POSIX proof of the native keyboard session handoff.

This runs the real shell function bodies with portable POSIX commands instead
of the fixed /bin/busybox path. It does not claim Cage/physical-keyboard proof.
"""

from importlib.util import module_from_spec, spec_from_file_location
import errno
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"


def _function(source: str, name: str, following: str) -> str:
    start = name + "() {"
    end = "\n" + following + "() {"
    if source.count(start) != 1 or source.count(end) != 1:
        raise AssertionError("Launcher function boundary changed")
    return start + source.split(start, 1)[1].split(end, 1)[0]


def _host():
    spec = spec_from_file_location("ordax_keyboard_lifecycle_native_host", HOST)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _await(predicate, seconds=5.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.025)
    raise AssertionError("Keyboard broker did not reach the expected state")


def _enqueue(host, pipe: Path, layout_id: str):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        try:
            host.queue_keyboard_session_restart(layout_id, str(pipe))
            return
        except OSError as exc:
            if exc.errno not in (errno.ENOENT, errno.ENXIO):
                raise
            time.sleep(0.025)
    raise AssertionError("Native keyboard broker never opened its FIFO")


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux POSIX broker proof")
class KeyboardSessionRestartLifecycleTests(unittest.TestCase):
    def test_broker_rejects_stale_requests_and_relaunch_reads_persisted_layout(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        broker = _function(
            launcher, "prepare_keyboard_session_restart_broker", "prepare_power_broker"
        )
        configure = _function(
            launcher, "configure_keyboard_layout", "write_power_request_record"
        )
        # Replace only the executable path: test the same source function body
        # with the runner's POSIX mkfifo/sleep/kill instead of a Buildroot binary.
        self.assertEqual(broker.count("/bin/busybox "), 4)
        broker = broker.replace("/bin/busybox ", "")
        self.assertIn('kill -TERM "$SURFACE_PID"', broker)
        self.assertNotIn("reboot", broker)
        self.assertNotIn("poweroff", broker)

        host = _host()
        with tempfile.TemporaryDirectory(prefix="ordax-keyboard-session-") as td:
            directory = Path(td)
            pipe = directory / "keyboard-session-restart-request"
            state = directory / "keyboard-layout"
            log = directory / "host.log"
            first_run = directory / "first-run.json"
            state.write_text("br-abnt2\n", encoding="ascii")
            log.write_text("", encoding="utf-8")
            original_receipt = b'{"schema":"ordax.first-run-state/1","completed":false}\n'
            first_run.write_bytes(original_receipt)

            shell = "\n".join([
                "set -eu",
                "KEYBOARD_SESSION_RESTART_REQUEST=" + shlex.quote(str(pipe)),
                "KEYBOARD_LAYOUT_STATE=" + shlex.quote(str(state)),
                "HOST_LOG=" + shlex.quote(str(log)),
                "ORDAX_KEYBOARD_LAYOUT_ID=br-abnt2",
                "SURFACE_PID=$$",
                'KEYBOARD_SESSION_RESTART_BROKER_PID=""',
                broker,
                "prepare_keyboard_session_restart_broker",
                "while :; do sleep 0.1; done",
            ])
            process = subprocess.Popen(
                ["/bin/sh", "-c", shell],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                start_new_session=True,
            )
            try:
                _await(lambda: pipe.is_fifo() and process.poll() is None)
                _enqueue(host, pipe, "br-abnt2")  # Already applied: no restart.
                _enqueue(host, pipe, "us")  # Not persisted: no restart.
                self.assertIsNone(process.poll())

                state.write_text("us\n", encoding="ascii")
                _enqueue(host, pipe, "us")
                _await(lambda: "applying configured keyboard" in log.read_text(
                    encoding="utf-8"
                ))
                # Simulate a later Settings write while the response drains.
                state.write_text("br-abnt2\n", encoding="ascii")
                time.sleep(2.4)
                self.assertIsNone(
                    process.poll(),
                    "Outdated request must not restart the Surface",
                )

                state.write_text("us\n", encoding="ascii")
                _enqueue(host, pipe, "us")
                process.wait(timeout=6)
                self.assertNotEqual(process.returncode, 0)
                self.assertEqual(first_run.read_bytes(), original_receipt)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=2)
                if process.stderr:
                    process.stderr.close()

            # A newly launched session rereads the same owner file and exports
            # the next Cage XKB environment, not a stale OOBE draft value.
            relaunch = "\n".join([
                "set -eu",
                "KEYBOARD_LAYOUT_STATE=" + shlex.quote(str(state)),
                "HOST_LOG=" + shlex.quote(str(log)),
                configure,
                "configure_keyboard_layout",
                'printf "%s|%s|%s" "$ORDAX_KEYBOARD_LAYOUT_ID" '
                '"$XKB_DEFAULT_LAYOUT" "$XKB_DEFAULT_MODEL"',
            ])
            result = subprocess.run(
                ["/bin/sh", "-c", relaunch],
                capture_output=True,
                text=True,
                timeout=4,
                check=True,
            )
            self.assertEqual(result.stdout, "us|us|pc105")


if __name__ == "__main__":
    unittest.main()
