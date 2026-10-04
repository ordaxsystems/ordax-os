#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(RUNTIME_DIR))

import native_app_data_runtime as runtime  # noqa: E402

LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
CONTRACT = ROOT / "docs" / "contracts" / "native-app-data-binding.json"
PRIVATE_RUNTIME_SOURCE = "$SYSTEM_ROOT/surface/runtime/native_app_data_runtime.py"
PRIVATE_RUNTIME = "/usr/bin/python3 /srv/ordax-system/surface/runtime/native_app_data_runtime.py"
LEGACY_DIRECT_RUNTIME = "/usr/bin/python3 /srv/ordax-system/surface/runtime/native_host_server.py"


class NativeAppDataRuntimeWiringTest(unittest.TestCase):
    def setUp(self):
        self.launcher = LAUNCHER.read_text(encoding="utf-8")
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_launcher_requires_private_runtime_entrypoint(self):
        expected = (
            f'[ -f "{PRIVATE_RUNTIME_SOURCE}" ] || '
            'fallback_with_reason "private App Data Native runtime is missing: '
            f'{PRIVATE_RUNTIME_SOURCE}"'
        )
        self.assertIn(expected, self.launcher)

    def test_verified_bootstrap_precedes_private_runtime_startup(self):
        bind_offset = self.launcher.index(
            'bind_runtime_mounts || fallback_with_reason '
            '"failed to bind host resources into graphical runtime"'
        )
        bootstrap_offset = self.launcher.index(
            'bootstrap_verified_app_install_identities || fallback_with_reason '
            '"failed to bootstrap verified app install identities"'
        )
        runtime_offset = self.launcher.index(PRIVATE_RUNTIME)
        self.assertLess(bind_offset, bootstrap_offset)
        self.assertLess(bootstrap_offset, runtime_offset)

    def test_launcher_activates_specialized_runtime_not_legacy_direct_host(self):
        self.assertIn(PRIVATE_RUNTIME, self.launcher)
        self.assertNotIn(LEGACY_DIRECT_RUNTIME, self.launcher)
        self.assertIn(
            '[ -f "$SYSTEM_ROOT/surface/runtime/native_host_server.py" ] || ',
            self.launcher,
        )

    def test_owner_development_does_not_mint_app_data_authority(self):
        with patch.object(runtime, "load_current_boot_app_data_bindings") as loader:
            self.assertEqual(
                runtime.prepare_private_app_data_authority(object(), "owner-development"),
                0,
            )
        loader.assert_not_called()

    def test_stable_app_data_authority_requires_root(self):
        with patch.object(runtime.os, "geteuid", return_value=1000):
            with self.assertRaises(PermissionError):
                runtime.prepare_private_app_data_authority(object(), "stable-mvp")

    def test_stable_binding_descriptors_are_collapsed_to_count(self):
        server = object()
        opaque_descriptors = [object(), object()]
        with (
            patch.object(runtime.os, "geteuid", return_value=0),
            patch.object(
                runtime,
                "load_current_boot_app_data_bindings",
                return_value=opaque_descriptors,
            ) as loader,
        ):
            result = runtime.prepare_private_app_data_authority(server, "stable-mvp")
        self.assertEqual(result, 2)
        loader.assert_called_once_with(server, expected_uid=0)

    def test_contract_records_private_route_without_app_port_distribution(self):
        receipt_index = self.contract["current_boot_receipt_index"]
        app_surface = self.contract["app_facing_surface"]
        transport = self.contract["transport"]
        self.assertEqual(self.contract["status"], "private-route-active-port-undistributed")
        self.assertTrue(receipt_index["runtime_wiring_enabled"])
        self.assertEqual(
            receipt_index["runtime_entrypoint"],
            "system/surface/runtime/native_app_data_runtime.py",
        )
        self.assertTrue(transport["host_route_connected"])
        self.assertEqual(transport["route_activation_scope"], "trusted-native-process-only")
        self.assertFalse(app_surface["port_injection_enabled"])
        self.assertFalse(app_surface["opaque_endpoint_distributed_to_javascript"])
        self.assertFalse(self.contract["binding"]["capability_published_in_global_native_session"])
        self.assertFalse(app_surface["same_realm_third_party_isolation_claimed"])


if __name__ == "__main__":
    unittest.main()
