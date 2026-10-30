"""Real loopback Native HTTP + durable First Run across server processes.

Complements the Chromium mock-transport journey and direct fsync tests.
Runs against the actual Native Host HTTP handler and state writer; it does
NOT claim physical USB boot, user click-through, or hardware power recovery.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
HOST_SOURCE = ROOT / "system/surface/runtime/native_host_server.py"
ENDPOINT = "/__ordax/native/first-run"

# Only this subprocess runs the real HTTP server. Its whole state root is a
# disposable directory; it does not modify /var/lib/ordax on the CI host.
SERVER = """
import importlib.util
import pathlib
import sys
from functools import partial
spec = importlib.util.spec_from_file_location('ordax_native_http_restart', sys.argv[1])
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
root = pathlib.Path(sys.argv[2])
host.FIRST_RUN_FILE = str(root / 'native-state' / 'first-run.json')
(root / 'native-state').mkdir(mode=0o700, exist_ok=True)
server = host.NativeHostServer(
    ('127.0.0.1', int(sys.argv[3])),
    partial(host.NativeHostHandler, directory=str(root)),
    user_root=str(root / 'user'),
    power_request_path=str(root / 'power-request'),
    network_session_dir=str(root / 'session'),
    product_mode='usb',
    distribution_profile='owner-development',
    native_install_capability='disabled',
)
server.serve_forever(poll_interval=0.1)
"""


class NativeFirstRunHttpRestartTests(unittest.TestCase):
    def setUp(self):
        self.opener = build_opener(ProxyHandler({}))
        self.owned_processes = []

    def tearDown(self):
        for process in reversed(self.owned_processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=4)
            if process.stderr:
                process.stderr.close()

    def request(self, port, method="GET", payload=None, *, origin=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {
            "Origin": origin or f"http://127.0.0.1:{port}",
            "Sec-Fetch-Site": "same-origin",
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = Request(
            f"http://127.0.0.1:{port}{ENDPOINT}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with self.opener.open(request, timeout=2) as response:
                return response.status, response.read()
        except HTTPError as error:
            try:
                return error.code, error.read()
            finally:
                error.close()

    def start(self, root):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        process = subprocess.Popen(
            [sys.executable, "-u", "-c", SERVER, str(HOST_SOURCE), str(root), str(port)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        self.owned_processes.append(process)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if process.poll() is not None:
                detail = process.stderr.read(3000).decode("utf-8", "replace")
                self.fail(f"Native host failed to start: {detail}")
            try:
                status, _ = self.request(port)
                if status == 200:
                    return port, process
            except (URLError, TimeoutError, OSError):
                pass
            time.sleep(0.05)
        self.fail("Timed out waiting for the real Native First Run HTTP endpoint")

    def stop(self, process):
        process.terminate()
        try:
            process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=4)
        self.assertIsNotNone(process.returncode)

    def test_local_only_receipt_survives_http_host_restart(self):
        with tempfile.TemporaryDirectory(prefix="ordax-first-run-http-") as directory:
            root = Path(directory)
            port, first = self.start(root)
            status, raw = self.request(port)
            self.assertEqual(status, 200)
            initial = json.loads(raw)
            self.assertEqual(initial["completed"], False)
            self.assertIsNone(initial["accountMode"])

            completed = dict(initial, completed=True, accountMode="local-only")
            status, _ = self.request(port, "POST", completed)
            self.assertEqual(status, 204)
            status, raw = self.request(port)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(raw), completed)
            receipt = root / "native-state" / "first-run.json"
            self.assertEqual(json.loads(receipt.read_text(encoding="utf-8")), completed)
            self.assertFalse(list(receipt.parent.glob("*.tmp.*")))
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)

            # The second server is a fresh interpreter and creates a fresh
            # Native Host; its state survives solely through the on-disk file.
            self.stop(first)
            second_port, second = self.start(root)
            status, raw = self.request(second_port)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(raw), completed)
            status, _ = self.request(second_port, "POST", completed)
            self.assertEqual(status, 204, "exact retry must be idempotent")
            status, _ = self.request(second_port, "POST", dict(completed, accountMode="identity"))
            self.assertEqual(status, 500, "completed receipt must remain immutable")
            status, _ = self.request(second_port, "POST", dict(completed, unrecognized=True))
            self.assertEqual(status, 400, "unexpected fields must not be accepted")
            status, _ = self.request(second_port, "POST", completed, origin="https://external.invalid")
            self.assertEqual(status, 403, "foreign origin must not mutate Native data")
            status, raw = self.request(second_port)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(raw), completed)
            self.assertEqual(json.loads(receipt.read_text(encoding="utf-8")), completed)
            self.assertFalse(list(receipt.parent.glob("*.tmp.*")))
            self.stop(second)


if __name__ == "__main__":
    unittest.main()
