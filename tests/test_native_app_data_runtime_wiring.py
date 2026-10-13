#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
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



class NativeHostInstanceLifetimeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        os.chmod(self.temporary.name, 0o700)
        self.lock = os.path.join(self.temporary.name, "native-host-instance.lock")

    def test_exclusive_authority_rejects_second_process_and_recovers_on_crash(self):
        # A distinct OS process owns a real flock, not just a mocked mutex.
        child = (
            "import sys\n"
            "sys.path.insert(0, sys.argv[1])\n"
            "from native_app_data_runtime import hold_native_host_instance\n"
            "with hold_native_host_instance(sys.argv[2]):\n"
            "    print('LOCKED', flush=True)\n"
            "    sys.stdin.read(1)\n"
        )
        process = subprocess.Popen(
            [sys.executable, "-c", child, str(RUNTIME_DIR), self.lock],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True,
        )
        try:
            self.assertEqual(process.stdout.readline().strip(), "LOCKED")
            with self.assertRaises(runtime.NativeHostInstanceBusyError):
                with runtime.hold_native_host_instance(self.lock):
                    self.fail("second host received concurrent authority")
            self.assertTrue(os.path.isfile(self.lock))
            process.kill()  # kernel releases lock on abnormal process death
            process.wait(timeout=5)
            with runtime.hold_native_host_instance(self.lock):
                self.assertTrue(os.path.isfile(self.lock))
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            if process.stdin:
                process.stdin.close()
            if process.stdout:
                process.stdout.close()
            if process.stderr:
                process.stderr.close()

    def test_unsafe_instance_inode_or_parent_fails_closed(self):
        with open(self.lock, "wb"):
            pass
        os.chmod(self.lock, 0o644)
        with self.assertRaises(PermissionError):
            with runtime.hold_native_host_instance(self.lock):
                self.fail("world-readable lock was accepted")
        os.chmod(self.lock, 0o600)
        linked = os.path.join(self.temporary.name, "another-inode-alias")
        os.link(self.lock, linked)
        with self.assertRaises(PermissionError):
            with runtime.hold_native_host_instance(self.lock):
                self.fail("hardlinked host lock was accepted")
        os.unlink(linked)
        os.unlink(self.lock)
        with open(linked, "wb"):
            pass
        os.symlink(linked, self.lock)
        with self.assertRaises(OSError):
            with runtime.hold_native_host_instance(self.lock):
                self.fail("symlinked host lock was accepted")
        os.unlink(self.lock)
        os.chmod(self.temporary.name, 0o755)
        with self.assertRaises(PermissionError):
            with runtime.hold_native_host_instance(self.lock):
                self.fail("public directory was accepted")
        os.chmod(self.temporary.name, 0o700)
        with runtime.hold_native_host_instance(self.lock):
            self.assertTrue(os.path.isfile(self.lock))

    def test_main_never_constructs_or_mints_when_host_authority_is_busy(self):
        with runtime.hold_native_host_instance(self.lock):
            with (
                patch.object(runtime, "DEFAULT_NATIVE_HOST_INSTANCE_LOCK", self.lock),
                patch.object(
                    runtime, "DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH",
                    os.path.join(self.temporary.name, "app-data-port-bindings.json"),
                ),
                patch.object(runtime, "parse_args", return_value=SimpleNamespace(
                    bind="127.0.0.1", port=8765,
                )),
                patch.object(runtime, "expected_surface_authority") as authority,
                patch.object(runtime, "_serve_native_host") as serve,
            ):
                self.assertEqual(runtime.main(), 3)
                authority.assert_called_once_with(("127.0.0.1", 8765))
                serve.assert_not_called()
        # After the previous owner exits, the new instance may start.
        with (
            patch.object(runtime, "DEFAULT_NATIVE_HOST_INSTANCE_LOCK", self.lock),
            patch.object(
                runtime, "DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH",
                os.path.join(self.temporary.name, "app-data-port-bindings.json"),
            ),
            patch.object(runtime, "parse_args", return_value=SimpleNamespace(
                bind="127.0.0.1", port=8765,
            )),
            patch.object(runtime, "expected_surface_authority"),
            patch.object(runtime, "_serve_native_host", return_value=0) as serve,
        ):
            self.assertEqual(runtime.main(), 0)
            serve.assert_called_once()


    def test_host_recovers_stale_handoff_and_clears_unconsumed_bootstrap_on_exit(self):
        handoff = os.path.join(self.temporary.name, "app-data-port-bindings.json")
        # An old host may have been killed after publishing, before listening.
        with open(handoff, "wb") as output:
            output.write(b"stale previous host descriptor")
        os.chmod(handoff, 0o600)
        called = []

        def serve(_args):
            self.assertFalse(os.path.exists(handoff))
            called.append(True)
            with open(handoff, "wb") as output:
                output.write(b"new privileged handoff not consumed")
            return 0

        with (
            patch.object(runtime, "DEFAULT_NATIVE_HOST_INSTANCE_LOCK", self.lock),
            patch.object(runtime, "DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH", handoff),
            patch.object(runtime, "parse_args", return_value=SimpleNamespace(
                bind="127.0.0.1", port=8765,
            )),
            patch.object(runtime, "expected_surface_authority"),
            patch.object(runtime, "_serve_native_host", side_effect=serve),
        ):
            self.assertEqual(runtime.main(), 0)
        self.assertEqual(called, [True])
        self.assertFalse(os.path.exists(handoff))
        # The stable lock inode is never deleted as part of handoff cleanup.
        self.assertTrue(os.path.isfile(self.lock))

    def test_listener_failure_removes_handoff_before_releasing_instance_lock(self):
        handoff = os.path.join(self.temporary.name, "app-data-port-bindings.json")
        shutdown_checked = []

        def crash(_args):
            with open(handoff, "wb") as output:
                output.write(b"verified port emitted before failed listener")
            raise RuntimeError("simulated listener activation failure")

        with (
            patch.object(runtime, "DEFAULT_NATIVE_HOST_INSTANCE_LOCK", self.lock),
            patch.object(runtime, "DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH", handoff),
            patch.object(runtime, "parse_args", return_value=SimpleNamespace(
                bind="127.0.0.1", port=8765,
            )),
            patch.object(runtime, "expected_surface_authority"),
            patch.object(runtime, "_serve_native_host", side_effect=crash),
        ):
            self.assertEqual(runtime.main(), 3)
            self.assertFalse(os.path.exists(handoff))
            with runtime.hold_native_host_instance(self.lock):
                shutdown_checked.append(True)
        self.assertEqual(shutdown_checked, [True])

    def test_duplicate_host_must_not_delete_live_owners_handoff(self):
        handoff = os.path.join(self.temporary.name, "app-data-port-bindings.json")
        with runtime.hold_native_host_instance(self.lock):
            with open(handoff, "wb") as output:
                output.write(b"active owner handoff")
            with (
                patch.object(runtime, "DEFAULT_NATIVE_HOST_INSTANCE_LOCK", self.lock),
                patch.object(runtime, "DEFAULT_APP_DATA_PORT_BOOTSTRAP_PATH", handoff),
                patch.object(runtime, "parse_args", return_value=SimpleNamespace(
                    bind="127.0.0.1", port=8765,
                )),
                patch.object(runtime, "expected_surface_authority"),
                patch.object(runtime, "_serve_native_host") as serve,
            ):
                self.assertEqual(runtime.main(), 3)
                serve.assert_not_called()
            with open(handoff, "rb") as source:
                self.assertEqual(source.read(), b"active owner handoff")


if __name__ == "__main__":
    unittest.main()
