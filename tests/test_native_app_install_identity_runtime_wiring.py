#!/usr/bin/env python3

from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
CONTRACT = ROOT / "docs" / "contracts" / "verified-app-install-identity.json"

BOOTSTRAP_SOURCE = (
    "$SYSTEM_ROOT/surface/runtime/native_app_install_identity_bootstrap.py"
)
BOOTSTRAP_RUNTIME = (
    "/usr/bin/python3 "
    "/srv/ordax-system/surface/runtime/native_app_install_identity_bootstrap.py"
)
NATIVE_HOST_RUNTIME = (
    "/usr/bin/python3 /srv/ordax-system/surface/runtime/native_host_server.py"
)


class VerifiedInstallRuntimeWiringTest(unittest.TestCase):
    def setUp(self):
        self.launcher = LAUNCHER.read_text(encoding="utf-8")
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_launcher_requires_bootstrap_source_before_runtime_startup(self):
        expected = (
            f'[ -f "{BOOTSTRAP_SOURCE}" ] || '
            'fallback_with_reason "verified app install identity bootstrap is missing: '
            f'{BOOTSTRAP_SOURCE}"'
        )
        self.assertIn(expected, self.launcher)

    def test_bootstrap_runs_after_mounts_and_before_native_host(self):
        bind_offset = self.launcher.index(
            'bind_runtime_mounts || fallback_with_reason '
            '"failed to bind host resources into graphical runtime"'
        )
        bootstrap_offset = self.launcher.index(BOOTSTRAP_RUNTIME)
        native_host_offset = self.launcher.index(NATIVE_HOST_RUNTIME)
        self.assertLess(bind_offset, bootstrap_offset)
        self.assertLess(bootstrap_offset, native_host_offset)

    def test_bootstrap_is_synchronous_and_fail_closed(self):
        expected = (
            '/bin/busybox chroot "$RUNTIME_ROOT" \\\n'
            '    /usr/bin/python3 '
            '/srv/ordax-system/surface/runtime/native_app_install_identity_bootstrap.py '
            '\\\n'
            '    >>"$HOST_LOG" 2>&1 || fallback_with_reason '
            '"failed to bootstrap verified app install identities"'
        )
        self.assertIn(expected, self.launcher)
        bootstrap_offset = self.launcher.index(BOOTSTRAP_RUNTIME)
        host_offset = self.launcher.index(NATIVE_HOST_RUNTIME)
        bootstrap_slice = self.launcher[bootstrap_offset:host_offset]
        self.assertNotIn("&\n", bootstrap_slice)
        self.assertNotIn("|| true", bootstrap_slice)

    def test_contract_records_runtime_wiring_without_enabling_route_or_sdk(self):
        bootstrap = self.contract["receipt_bootstrap"]
        implementation = self.contract["implementation"]
        self.assertTrue(bootstrap["runtime_wiring_enabled"])
        self.assertEqual(
            bootstrap["runtime_wiring_owner"],
            "system/surface/bin/ordax-surface",
        )
        self.assertTrue(implementation["receipt_bootstrap_runtime_wiring"])
        self.assertFalse(implementation["native_app_data_route_implemented"])
        self.assertFalse(implementation["sdk_published"])
        self.assertFalse(implementation["production_external_publisher_trust_implemented"])


if __name__ == "__main__":
    unittest.main()
