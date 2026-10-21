"""Native Product Runtime handoff: one heartbeat, one device credential, one agent."""
from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "system" / "surface" / "runtime"
if str(NATIVE) not in sys.path:
    sys.path.insert(0, str(NATIVE))

from product_device_identity import ProductDeviceIdentityStore  # noqa: E402
from native_product_runtime_handoff import (  # noqa: E402
    NativeProductRuntimeHandoffError,
    run_verified_native_product_runtime,
)

DEVICE = "0a563924-e4d1-4328-bcb0-f73820c92e1b"
DESKTOP = "24630b00-e9c0-4d93-b38a-2367048cd9d1"
ORIGIN = "https://ordax-mcp.ordaxsystems.workers.dev"


class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.store = ProductDeviceIdentityStore(str(self.base))
        self.store.commit_enrollment(DEVICE)
        self.old_presence = Mock()
        self.old_presence.client.origin = ORIGIN
        self.active = False
        self.returned = False
        self.coordinator = SimpleNamespace(
            development_discovery=True,
            identity_store=self.store,
            presence=self.old_presence,
        )
        def refresh():
            self.returned = True
            self.coordinator.presence.start()
        self.coordinator.refresh_development_presence = refresh
        self.config = SimpleNamespace(
            device_id=DEVICE,
            product_mcp_url=ORIGIN,
            control_plane_protocol="cloudflare-v3",
            state_dir=self.base / "runtime",
            protected_roots=(self.store.root,),
        )
        self.run = Mock(return_value=0)

    def invoke(self, **kwargs):
        return run_verified_native_product_runtime(
            self.coordinator, self.config,
            installed_runtime_run=kwargs.get("run", self.run),
            computer_adapter=kwargs.get("adapter", None),
        )

    def test_verified_runtime_owns_one_transport_and_exact_os_credential(self):
        class NewWorker:
            def __init__(me, client):
                self.assertIs(client, self.old_presence.client)
            def start(me):
                self.returned = True
        def execute(config, *, device_credential_provider, computer_adapter, status_port):
            self.assertEqual(status_port, 0)  # Native Host retains its loopback port
            self.old_presence.stop.assert_called_once_with(wait=True)
            self.assertEqual(config.device_id, DEVICE)
            self.assertEqual(device_credential_provider(), self.store.read_enrolled_credential())
            self.assertIsNot(device_credential_provider(), None)
            self.assertEqual(computer_adapter, {})
            self.assertIs(self.coordinator.presence, self.old_presence)
            return 0
        with patch("product_device_presence.ProductDevicePresenceWorker", NewWorker):
            self.assertEqual(self.invoke(run=execute), 0)
        self.assertTrue(self.returned)
        self.assertIsNot(self.coordinator.presence, self.old_presence)

    def test_no_runtime_artifact_or_no_owner_profile_never_stops_presence(self):
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "verified_runtime_entrypoint_required"):
            self.invoke(run=None)
        self.coordinator.development_discovery = False
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_owner_development_usb_required"):
            self.invoke()
        self.old_presence.stop.assert_not_called()
        self.run.assert_not_called()

    def test_device_scope_never_inherits_desktop_credential(self):
        self.config.device_id = DESKTOP
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_product_device_identity_mismatch"):
            self.invoke()
        self.old_presence.stop.assert_not_called()

    def test_mismatched_control_plane_and_transport_fail_closed(self):
        self.config.product_mcp_url = "https://other.example"
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_product_authority_mismatch"):
            self.invoke()
        self.config.product_mcp_url = ORIGIN
        self.config.control_plane_protocol = "old-protocol"
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_product_transport_invalid"):
            self.invoke()
        self.old_presence.stop.assert_not_called()

    def test_canonical_credential_policy_cannot_be_unprotected(self):
        self.config.protected_roots = (self.base / "unrelated",)
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_device_credentials_not_protected"):
            self.invoke()
        self.assertEqual(self.old_presence.stop.call_count, 0)

    def test_no_enrollment_never_mints_credential_during_handoff(self):
        self.store.credential_path.unlink()
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_device_enrollment_required"):
            self.invoke()
        self.assertFalse(self.store.credential_path.exists())
        self.old_presence.stop.assert_not_called()

    def test_invalid_adapter_never_starts_transport(self):
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_computer_adapter_invalid"):
            self.invoke(adapter="windows-adapter")
        self.old_presence.stop.assert_not_called()

    def test_runtime_exception_releases_single_owner_and_recovers_presence(self):
        new_worker = Mock()
        new_worker.client.origin = ORIGIN
        with patch("product_device_presence.ProductDevicePresenceWorker", return_value=new_worker):
            with self.assertRaisesRegex(RuntimeError, "agent_exited"):
                self.invoke(run=lambda _cfg, **_k: (_ for _ in ()).throw(RuntimeError("agent_exited")))
        self.old_presence.stop.assert_called_once_with(wait=True)
        new_worker.start.assert_called_once_with()
        self.assertIs(self.coordinator.presence, new_worker)
        self.old_presence.stop.reset_mock()
        with patch("product_device_presence.ProductDevicePresenceWorker"):
            self.assertEqual(self.invoke(), 0)   # no process-global stale lock

    def test_handoff_rejects_worker_thread_without_changing_presence(self):
        errors = []
        def background():
            try:
                self.invoke()
            except Exception as exc:
                errors.append(str(exc))
        t = threading.Thread(target=background)
        t.start()
        t.join(timeout=2)
        self.assertFalse(t.is_alive())
        self.assertEqual(errors, ["native_runtime_requires_main_thread"])
        self.old_presence.stop.assert_not_called()

    def test_untrusted_or_external_runtime_state_is_rejected(self):
        # The private source root is the parent of /device-agent.
        self.config.state_dir = Path("/tmp/another-user-runtime")
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_runtime_state_outside_private_storage"):
            self.invoke()
        self.old_presence.stop.assert_not_called()

    def test_nested_identity_state_is_rejected(self):
        self.config.state_dir = self.store.root / "runtime"
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_runtime_state_overlaps_identity"):
            self.invoke()
        self.old_presence.stop.assert_not_called()

    def test_existing_runtime_state_must_not_overlap_credentials(self):
        self.config.state_dir = self.store.root
        with self.assertRaisesRegex(NativeProductRuntimeHandoffError, "native_runtime_state_overlaps_identity"):
            self.invoke()
        self.old_presence.stop.assert_not_called()


if __name__ == "__main__":
    unittest.main()
