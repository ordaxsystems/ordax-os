from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system/surface/runtime"
sys.path.insert(0, str(RUNTIME))

from product_device_identity import ProductDeviceIdentityStore  # noqa: E402
from product_device_presence import (  # noqa: E402
    ProductDevicePresenceClient,
    ProductDevicePresenceError,
    ProductDevicePresenceWorker,
)


DEVICE_ID = "123e4567-e89b-42d3-a456-426614174000"


class FakeResponse:
    status = 200

    def __init__(self, payload):
        self.body = json.dumps(payload).encode("utf-8")

    def read(self, n):
        return self.body[:n]

    def close(self):
        pass


class FakeOpener:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        return self.response


class ProductDevicePresenceNativeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = ProductDeviceIdentityStore(self.tmp.name)
        self.store.commit_enrollment(DEVICE_ID)

    def test_private_descriptor_read_never_mints_or_reads_symlink(self):
        self.assertEqual(self.store.read_enrolled_credential()["device_id"], DEVICE_ID)
        path = self.store.credential_path
        path.chmod(0o644)
        self.assertIsNone(self.store.read_enrolled_credential())
        path.chmod(0o600)
        saved = path.with_name("backing")
        path.rename(saved)
        path.symlink_to(saved)
        self.assertIsNone(self.store.read_enrolled_credential())

    def test_private_device_credential_rejects_hardlinks_or_other_owner(self):
        path = self.store.credential_path
        other = path.with_name("unexpected-hardlink")
        os.link(path, other)
        self.assertIsNone(self.store.read_enrolled_credential())
        other.unlink()
        self.assertEqual(self.store.read_enrolled_credential()["device_id"], DEVICE_ID)
        with patch("product_device_identity.os.geteuid", return_value=-1):
            self.assertIsNone(self.store.read_enrolled_credential())
        self.assertEqual(self.store.read_enrolled_credential()["device_id"], DEVICE_ID)

    def test_successful_presence_is_device_only_and_no_token_on_argv(self):
        client = ProductDevicePresenceClient("https://cp.example", self.store)
        client._opener = FakeOpener(FakeResponse({
            "ok": True, "device_id": DEVICE_ID, "changed": True,
        }))
        self.assertTrue(client.report(True))
        self.assertTrue(client.report(False))
        self.assertEqual(len(client._opener.calls), 2)
        credential = self.store.read_enrolled_credential()
        self.assertIsNotNone(credential)
        for index, (request, timeout) in enumerate(client._opener.calls):
            self.assertEqual(request.full_url, "https://cp.example/v3/product/device/presence")
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(timeout, 5.0)
            headers = {k.lower(): v for k, v in request.header_items()}
            self.assertEqual(headers["x-ordax-device-token"], credential["device_token"])
            self.assertEqual(headers["x-ordax-device-id"], DEVICE_ID)
            payload = json.loads(request.data)
            self.assertEqual(set(payload), {"online", "runtime_kind", "agent_version", "capability_digest"})
            self.assertEqual(payload["online"], index == 0)
            self.assertEqual(payload["runtime_kind"], "ordax-os")
            self.assertIsNone(payload["capability_digest"])
            self.assertNotIn(credential["device_token"], request.data.decode())

    def test_runtime_singleton_prevents_conflicting_device_heartbeats(self):
        client = ProductDevicePresenceClient("https://cp.example", self.store)
        client._opener = FakeOpener(FakeResponse({
            "ok": True, "device_id": DEVICE_ID,
        }))
        self.assertTrue(client.report(True))
        # Same exact lock file as native_main.run's instance guard; the
        # installed Runtime holds this lock across its entire process life.
        instance_lock = self.store.root.parent / "product-runtime" / "instance.lock"
        self.assertTrue(instance_lock.is_file())
        descriptor = os.open(instance_lock, os.O_RDWR | os.O_NOFOLLOW)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertFalse(client.report(True))
            self.assertFalse(client.report(False))
            self.assertEqual(len(client._opener.calls), 1)
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)
        self.assertTrue(client.report(True))
        self.assertEqual(len(client._opener.calls), 2)

    def test_bad_runtime_lock_never_sends_device_credentials(self):
        runtime_dir = self.store.root.parent / "product-runtime"
        runtime_dir.mkdir(mode=0o700)
        runtime_dir.chmod(0o755)
        client = ProductDevicePresenceClient("https://cp.example", self.store)
        client._opener = Mock()
        with self.assertRaisesRegex(ProductDevicePresenceError, "device-presence-runtime-state-unsafe"):
            client.report(True)
        client._opener.open.assert_not_called()
        runtime_dir.chmod(0o700)

    def test_rejected_server_receipt_releases_shared_runtime_lock(self):
        client = ProductDevicePresenceClient("https://cp.example", self.store)
        client._opener = FakeOpener(FakeResponse({
            "ok": False, "device_id": DEVICE_ID,
        }))
        with self.assertRaises(ProductDevicePresenceError):
            client.report(True)
        instance_lock = self.store.root.parent / "product-runtime" / "instance.lock"
        descriptor = os.open(instance_lock, os.O_RDWR | os.O_NOFOLLOW)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def test_no_credential_means_no_network(self):
        self.store.credential_path.unlink()
        client = ProductDevicePresenceClient("https://cp.example", self.store)
        client._opener = Mock()
        self.assertFalse(client.report(True))
        client._opener.open.assert_not_called()

    def test_wrong_receipt_rejected_and_no_false_online(self):
        client = ProductDevicePresenceClient("https://cp.example", self.store)
        client._opener = FakeOpener(FakeResponse({
            "ok": True, "device_id": "99999999-9999-4999-8999-999999999999",
        }))
        with self.assertRaises(ProductDevicePresenceError):
            client.report(True)

    def test_reject_insecure_origin_and_invalid_intervals(self):
        with self.assertRaises(ValueError):
            ProductDevicePresenceClient("http://cp.example", self.store)
        with self.assertRaises(ValueError):
            ProductDevicePresenceWorker(Mock(), interval_seconds=3)

    def test_receipt_status_never_confuses_opt_in_with_real_connectivity(self):
        class Device:
            def __init__(self):
                self.accepted = False
                self.calls = []
            def report(self, online):
                self.calls.append(online)
                return self.accepted if online else True

        client = Device()
        worker = ProductDevicePresenceWorker(client, interval_seconds=60)
        self.assertEqual(worker.connection_state(), "disabled")
        # Drive the receipt projection deterministically. The separate lifecycle
        # test proves one thread and an offline report on stop.
        with worker._lock:
            worker._enabled = True
        self.assertEqual(worker.connection_state(), "connecting")
        worker._report(True)
        self.assertEqual(worker.connection_state(), "unavailable")
        client.accepted = True
        worker._report(True)
        self.assertEqual(worker.connection_state(), "confirmed")
        with worker._lock:
            worker._last_online_receipt = time.monotonic() - 4 * worker.interval_seconds
        self.assertEqual(worker.connection_state(), "unavailable")
        with worker._lock:
            worker._enabled = False
        self.assertEqual(worker.connection_state(), "disabled")
        self.assertEqual(client.calls, [True, True])

    def test_shutdown_does_not_claim_quiescence_after_join_timeout(self):
        client = Mock()
        worker = ProductDevicePresenceWorker(client)
        unfinished = Mock()
        unfinished.is_alive.return_value = True
        worker._thread = unfinished
        with self.assertRaisesRegex(ProductDevicePresenceError, "device-presence-worker-still-running"):
            worker.stop(wait=True)
        unfinished.join.assert_called_once_with(timeout=11.0)
        self.assertTrue(worker._closed)
        self.assertFalse(worker._enabled)
        self.assertEqual(worker.connection_state(), "disabled")

    def test_shutdown_cannot_join_itself_and_cannot_authorize_takeover(self):
        worker = ProductDevicePresenceWorker(Mock())
        worker._thread = threading.current_thread()
        with self.assertRaisesRegex(ProductDevicePresenceError, "device-presence-stop-from-own-thread"):
            worker.stop(wait=True)
        self.assertTrue(worker._closed)

    def test_successful_wait_requires_thread_not_alive(self):
        worker = ProductDevicePresenceWorker(Mock())
        stopped = Mock()
        stopped.is_alive.return_value = False
        worker._thread = stopped
        worker.stop(wait=True)
        stopped.join.assert_called_once_with(timeout=11.0)
        self.assertTrue(worker._closed)

    def test_exactly_one_worker_and_offline_on_stop(self):
        class Device:
            def __init__(self):
                self.calls = []
                self.started = threading.Event()
            def report(self, online):
                self.calls.append(online)
                if online:
                    self.started.set()
                return True
        client = Device()
        worker = ProductDevicePresenceWorker(client)
        worker.start()
        self.assertTrue(client.started.wait(3))
        original_thread = worker._thread
        worker.start()
        self.assertIs(worker._thread, original_thread)
        worker.stop(wait=True)
        self.assertEqual(client.calls, [True, False])


if __name__ == "__main__":
    unittest.main()
