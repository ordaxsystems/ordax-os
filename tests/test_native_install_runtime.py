#!/usr/bin/env python3
"""Regress the read-only Native installation discovery boundary."""

from __future__ import annotations

from functools import partial
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
BROKER = ROOT / "system" / "surface" / "runtime" / "native_install_broker.sh"
LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"

spec = importlib.util.spec_from_file_location("ordax_native_install_runtime_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


def raw_target(*, token: str, source: bool, eligible: bool) -> dict:
    return {
        "stable_id": "wwid:private-device-id",
        "device_path": "/dev/nvme0n1" if not source else "/dev/sdb",
        "model": "Example NVMe" if not source else "OrdaX USB",
        "serial": "PRIVATE-SERIAL",
        "transport": "nvme" if not source else "usb",
        "physical_bytes": 64 * 1024 * 1024 * 1024,
        "logical_sector_bytes": 512,
        "removable": source,
        "read_only": False,
        "source_boot_media": source,
        "eligible": eligible,
        "confirmation_token": token,
    }


class NativeInstallRuntimeTests(unittest.TestCase):
    def test_snapshot_is_sanitized_and_never_grants_write(self):
        payload = {
            "$schema": "prototype-ordax.creator-native-targets/1",
            "mode": "read-only-native-install-target-discovery",
            "physical_write": False,
            "source_boot_device": "/dev/sdb2",
            "targets": [
                raw_target(token="a" * 64, source=False, eligible=True),
                raw_target(token="b" * 64, source=True, eligible=False),
            ],
        }
        snapshot = native_host.sanitize_native_install_snapshot(payload)
        self.assertEqual(snapshot["schema"], "ordax.native-install-targets/1")
        self.assertFalse(snapshot["physicalWriteAllowed"])
        self.assertEqual(len(snapshot["targets"]), 2)
        encoded = json.dumps(snapshot)
        for forbidden in (
            "stable_id",
            "wwid",
            "PRIVATE-SERIAL",
            "serial",
            "device_path",
            "/dev/",
            "source_boot_device",
        ):
            self.assertNotIn(forbidden, encoded)
        self.assertTrue(snapshot["targets"][0]["eligible"])
        self.assertFalse(snapshot["targets"][1]["eligible"])
        self.assertEqual(snapshot["targets"][0]["confirmationToken"], "a" * 64)

    def test_snapshot_rejects_inconsistent_or_write_enabled_input(self):
        payload = {
            "$schema": "prototype-ordax.creator-native-targets/1",
            "mode": "read-only-native-install-target-discovery",
            "physical_write": True,
            "targets": [],
        }
        with self.assertRaises(ValueError):
            native_host.sanitize_native_install_snapshot(payload)

        payload["physical_write"] = False
        payload["targets"] = [raw_target(token="a" * 64, source=True, eligible=True)]
        with self.assertRaises(ValueError):
            native_host.sanitize_native_install_snapshot(payload)

    def test_native_disk_mode_never_enables_installer_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            handler = partial(native_host.NativeHostHandler, directory=str(root))
            server = native_host.NativeHostServer(
                ("127.0.0.1", 0),
                handler,
                user_root=str(root / "user"),
                power_request_path=str(root / "power-request"),
                network_session_dir=str(root),
                product_mode="native-disk",
            )
            try:
                self.assertEqual(server.product_mode, "native-disk")
                self.assertFalse(server.native_install_available)
                self.assertEqual(server.native_install_token, "")
            finally:
                server.server_close()

    def test_http_boundary_has_read_only_tokenized_route_and_no_apply_route(self):
        server = SERVER.read_text(encoding="utf-8")
        get_section = server.split("def do_GET", 1)[1].split("def do_POST", 1)[0]
        post_section = server.split("def do_POST", 1)[1]
        self.assertIn(
            'NATIVE_INSTALL_TARGETS_PATH = "/__ordax/native/native-install-targets"',
            server,
        )
        self.assertIn(
            'NATIVE_INSTALL_TOKEN_HEADER = "X-OrdaX-Native-Install-Token"',
            server,
        )
        self.assertIn("native_install_available", get_section)
        self.assertIn("queue_native_install_broker_request", get_section)
        self.assertNotIn("NATIVE_INSTALL_TARGETS_PATH", post_section)
        self.assertNotIn("native-install-apply", server)
        # This read-only endpoint delegates to a private FIFO broker;
        # subprocess use elsewhere on NativeHost does not grant install
        # command authority here. Keep the exact queue boundary strict.
        queue = server.split("def queue_native_install_broker_request(", 1)[1].split(
            "\n\ndef ", 1
        )[0]
        for forbidden in ("subprocess", "os.system", "shell=True", "Popen("):
            self.assertNotIn(forbidden, queue)
        self.assertIn('os.fchmod(handle.fileno(), 0o600)', queue)
        self.assertIn('os.fsync(handle.fileno())', queue)
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', queue)
        self.assertIn('os.fstat(descriptor)', queue)

    def test_launcher_starts_broker_only_for_explicit_owner_post_mvp_preview(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        start = launcher.split("start_native_install_broker() {", 1)[1].split("\n}", 1)[0]
        self.assertIn(
            '[ "$NATIVE_INSTALL_CAPABILITY" = "post-mvp-preview" ] || return 0',
            start,
        )
        self.assertIn(
            '[ "$DISTRIBUTION_PROFILE" = "owner-development" ] || return 0',
            start,
        )
        self.assertIn('[ "$PRODUCT_MODE" = "usb" ] || return 0', start)
        self.assertIn('[ -x "$NATIVE_INSTALL_HELPER" ]', start)
        self.assertIn('[ ! -L "$NATIVE_INSTALL_HELPER" ]', start)
        self.assertIn("ORDAX_NATIVE_INSTALL_HELPER", start)
        self.assertNotIn("eval ", start)
        self.assertIn(
            '[ "$DISTRIBUTION_PROFILE" = "stable-mvp" ] && NATIVE_INSTALL_CAPABILITY=disabled',
            launcher,
        )

    @unittest.skipUnless(os.name == "posix", "private FIFO broker proof requires POSIX")
    def test_private_broker_and_host_queue_round_trip_read_only_snapshot(self):
        subprocess.run(["sh", "-n", str(BROKER)], check=True)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            helper = root / "helper"
            helper.write_text(
                "#!/bin/sh\n"
                "cat <<'JSON'\n"
                + json.dumps(
                    {
                        "$schema": "prototype-ordax.creator-native-targets/1",
                        "mode": "read-only-native-install-target-discovery",
                        "physical_write": False,
                        "source_boot_device": "/dev/sdb2",
                        "targets": [
                            raw_target(token="c" * 64, source=False, eligible=True)
                        ],
                    }
                )
                + "\nJSON\n",
                encoding="utf-8",
            )
            helper.chmod(0o755)
            env = dict(os.environ)
            env["ORDAX_NATIVE_INSTALL_SESSION_DIR"] = str(root)
            env["ORDAX_NATIVE_INSTALL_HELPER"] = str(helper)
            process = subprocess.Popen(
                ["sh", str(BROKER)],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                paths = native_host.native_install_broker_paths(str(root))
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline and not native_host.native_install_broker_available(paths):
                    if process.poll() is not None:
                        self.fail(process.stderr.read())
                    time.sleep(0.05)
                self.assertTrue(native_host.native_install_broker_available(paths))
                snapshot = native_host.queue_native_install_broker_request(
                    paths,
                    timeout_seconds=3,
                )
                self.assertFalse(snapshot["physicalWriteAllowed"])
                self.assertEqual(snapshot["targets"][0]["confirmationToken"], "c" * 64)
                self.assertNotIn("stable_id", json.dumps(snapshot))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)


if __name__ == "__main__":
    unittest.main()
