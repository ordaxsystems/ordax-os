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
NATIVE_INDEX = ROOT / "system" / "composition" / "native" / "index.html"
BROWSER_HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
BOOTSTRAP_MODULE = ROOT / "system" / "composition" / "native" / "app-data-bootstrap.mjs"
RUNTIME_LOADER = ROOT / "system" / "services" / "components" / "runtime-loader.mjs"
PRIVATE_RUNTIME_SOURCE = "$SYSTEM_ROOT/surface/runtime/native_app_data_runtime.py"
PRIVATE_RUNTIME = "/usr/bin/python3 /srv/ordax-system/surface/runtime/native_app_data_runtime.py"
LEGACY_DIRECT_RUNTIME = "/usr/bin/python3 /srv/ordax-system/surface/runtime/native_host_server.py"


class NativeAppDataRuntimeWiringTest(unittest.TestCase):
    def setUp(self):
        self.launcher = LAUNCHER.read_text(encoding="utf-8")
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.native_index = NATIVE_INDEX.read_text(encoding="utf-8")
        self.browser_host = BROWSER_HOST.read_text(encoding="utf-8")
        self.bootstrap_module = BOOTSTRAP_MODULE.read_text(encoding="utf-8")
        self.runtime_loader = RUNTIME_LOADER.read_text(encoding="utf-8")

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

    def test_owner_development_does_not_mint_or_publish_app_data_authority(self):
        with (
            patch.object(runtime, "load_current_boot_app_data_bindings") as loader,
            patch.object(runtime, "publish_app_data_port_bootstrap") as publisher,
        ):
            self.assertEqual(
                runtime.prepare_private_app_data_authority(object(), "owner-development"),
                0,
            )
        loader.assert_not_called()
        publisher.assert_not_called()

    def test_stable_app_data_authority_requires_root(self):
        with patch.object(runtime.os, "geteuid", return_value=1000):
            with self.assertRaises(PermissionError):
                runtime.prepare_private_app_data_authority(object(), "stable-mvp")

    def test_stable_verified_bindings_are_published_only_to_one_shot_handoff(self):
        server = object()
        descriptors = [object(), object()]
        bootstrap_path = "/run/ordax-surface/test-app-data-port-bindings.json"
        with (
            patch.object(runtime.os, "geteuid", return_value=0),
            patch.object(
                runtime,
                "load_current_boot_app_data_bindings",
                return_value=descriptors,
            ) as loader,
            patch.object(
                runtime,
                "publish_app_data_port_bootstrap",
                return_value=2,
            ) as publisher,
        ):
            result = runtime.prepare_private_app_data_authority(
                server,
                "stable-mvp",
                bootstrap_path=bootstrap_path,
            )
        self.assertEqual(result, 2)
        loader.assert_called_once_with(server, expected_uid=0)
        publisher.assert_called_once_with(
            descriptors,
            bootstrap_path,
            expected_uid=0,
        )

    def test_composition_bootstrap_precedes_main_and_uses_privileged_bridge(self):
        bootstrap_tag = '<script type="module" src="./app-data-bootstrap.mjs"></script>'
        main_tag = '<script type="module" src="./main.mjs"></script>'
        self.assertIn(bootstrap_tag, self.native_index)
        self.assertLess(self.native_index.index(bootstrap_tag), self.native_index.index(main_tag))
        self.assertIn('BOOTSTRAP_REQUEST = "app-data.bootstrap.request"', self.bootstrap_module)
        self.assertIn("installTrustedComponentContextProvider", self.bootstrap_module)
        self.assertIn("createNativeBoundAppDataPort", self.bootstrap_module)
        self.assertIn('command == "app-data.bootstrap.request"', self.browser_host)
        self.assertIn("consume_app_data_port_bootstrap", self.browser_host)
        self.assertIn("self.app_data_bootstrap_bindings = ()", self.browser_host)
        self.assertIn("installTrustedComponentContextProvider", self.runtime_loader)
        self.assertNotIn("/__ordax/native/session", self.bootstrap_module)
        self.assertNotIn("receiptSha", self.bootstrap_module)

    def test_contract_records_typed_first_party_injection_without_app_endpoint_exposure(self):
        receipt_index = self.contract["current_boot_receipt_index"]
        handoff = self.contract["trusted_composition_handoff"]
        app_surface = self.contract["app_facing_surface"]
        transport = self.contract["transport"]
        self.assertEqual(self.contract["status"], "trusted-first-party-port-injection-active")
        self.assertTrue(receipt_index["runtime_wiring_enabled"])
        self.assertEqual(
            receipt_index["runtime_entrypoint"],
            "system/surface/runtime/native_app_data_runtime.py",
        )
        self.assertTrue(transport["host_route_connected"])
        self.assertEqual(transport["route_activation_scope"], "trusted-native-process-only")
        self.assertTrue(handoff["one_shot_consume"])
        self.assertFalse(handoff["receipt_sha256_included"])
        self.assertFalse(handoff["global_native_session_exposure"])
        self.assertFalse(handoff["dom_exposure"])
        self.assertTrue(app_surface["port_injection_enabled"])
        self.assertTrue(app_surface["receives_typed_port_only"])
        self.assertFalse(app_surface["opaque_endpoint_exposed_to_app_context"])
        self.assertTrue(app_surface["first_party_only"])
        self.assertFalse(self.contract["binding"]["capability_published_in_global_native_session"])
        self.assertFalse(app_surface["same_realm_third_party_isolation_claimed"])


if __name__ == "__main__":
    unittest.main()
