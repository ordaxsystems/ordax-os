#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

from native_app_data_binding import (  # noqa: E402
    APP_DATA_ENDPOINT_PREFIX,
    NativeAppDataBindingCapacityError,
    NativeAppDataBindingError,
    NativeAppDataBindingNotFoundError,
    NativeAppDataBindingRegistry,
    handle_bound_app_data_request,
)
from native_app_data_endpoint import AppDataEndpointRequestError  # noqa: E402
from native_app_install_identity import (  # noqa: E402
    VerifiedAppInstallIdentityError,
    canonical_verified_app_install_identity_bytes,
)


def receipt(**overrides):
    value = {
        "$schema": "ordax.verified-app-install-identity/1",
        "status": "verified",
        "publisherPrincipalId": "ordax-official",
        "appId": "notes",
        "ownerScope": "device",
        "sourceClass": "system-release-bundled",
        "sourceVersion": "0.4.1",
        "sourceDigest": "1" * 64,
        "verificationOwner": "release-acquisition",
        "verificationPolicy": "ordax.publisher-trust/1",
        "verificationGeneration": 1,
    }
    value.update(overrides)
    return value


class NativeAppDataBindingTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.receipts = self.temp / "receipts"
        self.receipts.mkdir(mode=0o700)
        os.chmod(self.receipts, 0o700)
        self.data_root = self.temp / "app-data"
        self.uid = os.getuid()

    def tearDown(self):
        self.temporary.cleanup()

    def write_receipt(self, value=None):
        payload = canonical_verified_app_install_identity_bytes(
            receipt() if value is None else value
        )
        digest = hashlib.sha256(payload).hexdigest()
        path = self.receipts / f"{digest}.json"
        path.write_bytes(payload)
        os.chmod(path, 0o600)
        return digest

    def registry(self, *, max_bindings=64):
        return NativeAppDataBindingRegistry(
            receipt_root=str(self.receipts),
            expected_uid=self.uid,
            max_bindings=max_bindings,
        )

    def test_only_verified_receipt_can_mint_and_same_receipt_is_idempotent(self):
        registry = self.registry()
        digest = self.write_receipt()
        first = registry.mint_from_receipt(digest)
        second = registry.mint_from_receipt(digest)

        self.assertIs(first, second)
        self.assertTrue(first.endpoint.startswith(APP_DATA_ENDPOINT_PREFIX))
        self.assertEqual(len(first.capability), 43)
        self.assertEqual(
            first.app_data_identity(),
            {"publisherId": "ordax-official", "appId": "notes", "ownerScope": "device"},
        )
        self.assertEqual(registry.active_binding_count(), 1)
        self.assertFalse(hasattr(registry, "mint"))
        with self.assertRaises(VerifiedAppInstallIdentityError):
            registry.mint_from_receipt("0" * 64)
        self.assertEqual(registry.active_binding_count(), 1)

    def test_verified_notes_identity_gets_owner_managed_storage_limits(self):
        registry = self.registry()
        binding = registry.mint_from_receipt(self.write_receipt())

        self.assertEqual(binding.quota_bytes, 64 * 1024 * 1024)
        self.assertEqual(binding.max_keys, 2048)

    def test_other_verified_identity_keeps_default_storage_limits(self):
        registry = self.registry()
        binding = registry.mint_from_receipt(
            self.write_receipt(receipt(appId="assistant", sourceVersion="0.1.1"))
        )

        self.assertEqual(binding.quota_bytes, 8 * 1024 * 1024)
        self.assertEqual(binding.max_keys, 1024)

    def test_new_verified_receipt_for_same_identity_rotates_capability(self):
        registry = self.registry()
        first_digest = self.write_receipt()
        first = registry.mint_from_receipt(first_digest)

        second_digest = self.write_receipt(
            receipt(
                sourceVersion="0.4.2",
                sourceDigest="2" * 64,
                verificationGeneration=2,
            )
        )
        second = registry.mint_from_receipt(second_digest)

        self.assertNotEqual(first.endpoint, second.endpoint)
        self.assertIsNone(registry.resolve(first.endpoint))
        self.assertIs(registry.resolve(second.endpoint), second)
        self.assertEqual(registry.active_binding_count(), 1)
        with self.assertRaises(NativeAppDataBindingNotFoundError):
            handle_bound_app_data_request(
                registry,
                first.endpoint,
                b'{"action":"list"}',
                root=str(self.data_root),
            )

    def test_distinct_publishers_with_same_app_id_are_isolated(self):
        registry = self.registry()
        first = registry.mint_from_receipt(self.write_receipt())
        second = registry.mint_from_receipt(
            self.write_receipt(
                receipt(
                    publisherPrincipalId="example-vendor",
                    sourceClass="external-app-production",
                    sourceDigest="3" * 64,
                    verificationOwner="app-install-owner",
                )
            )
        )

        self.assertNotEqual(first.endpoint, second.endpoint)
        self.assertNotEqual(first.identity_key(), second.identity_key())
        self.assertEqual(registry.active_binding_count(), 2)

        stored = handle_bound_app_data_request(
            registry,
            first.endpoint,
            b'{"action":"put","key":"alpha","valueBase64":"b25l","expectedRevision":0}',
            root=str(self.data_root),
        )
        self.assertTrue(stored["stored"])

        first_list = handle_bound_app_data_request(
            registry,
            first.endpoint,
            b'{"action":"list"}',
            root=str(self.data_root),
        )
        second_list = handle_bound_app_data_request(
            registry,
            second.endpoint,
            b'{"action":"list"}',
            root=str(self.data_root),
        )
        self.assertEqual(first_list["keys"], ["alpha"])
        self.assertEqual(second_list["keys"], [])

    def test_request_cannot_self_assert_or_retarget_identity(self):
        registry = self.registry()
        binding = registry.mint_from_receipt(self.write_receipt())
        with self.assertRaises(AppDataEndpointRequestError):
            handle_bound_app_data_request(
                registry,
                binding.endpoint,
                json.dumps({"action": "list", "appId": "other"}).encode("utf-8"),
                root=str(self.data_root),
            )
        with self.assertRaises(AppDataEndpointRequestError):
            handle_bound_app_data_request(
                registry,
                binding.endpoint,
                json.dumps({"action": "list", "identity": binding.app_data_identity()}).encode("utf-8"),
                root=str(self.data_root),
            )

    def test_unknown_or_malformed_capability_does_not_resolve(self):
        registry = self.registry()
        binding = registry.mint_from_receipt(self.write_receipt())
        self.assertIs(registry.resolve(binding.endpoint), binding)
        self.assertIsNone(registry.resolve(APP_DATA_ENDPOINT_PREFIX + "a" * 42))
        self.assertIsNone(registry.resolve(APP_DATA_ENDPOINT_PREFIX + "a" * 44))
        self.assertIsNone(registry.resolve("/__ordax/native/app-data/../notes"))
        self.assertIsNone(registry.resolve("/__ordax/native/notes"))

    def test_verified_receipt_quiescence_drains_admitted_requests_before_maintenance(self):
        registry = self.registry()
        digest = self.write_receipt()
        original = registry.mint_from_receipt(digest)
        entered = threading.Event()
        release = threading.Event()
        quiesced = threading.Event()
        complete = threading.Event()
        errors = []

        def blocking_endpoint(*args, **kwargs):
            entered.set()
            if not release.wait(timeout=8):
                raise AssertionError("request did not receive release signal")
            return {"ok": True}

        def make_request():
            try:
                self.assertEqual(
                    handle_bound_app_data_request(registry, original.endpoint, b'{"action":"list"}'),
                    {"ok": True},
                )
            except BaseException as exc:
                errors.append(exc)

        def quiesce():
            try:
                with registry.suspend_verified_receipt_for_maintenance(digest) as binding:
                    self.assertEqual(binding.endpoint, original.endpoint)
                    quiesced.set()
                    with self.assertRaises(NativeAppDataBindingNotFoundError):
                        handle_bound_app_data_request(
                            registry, original.endpoint, b'{"action":"list"}',
                        )
                    with self.assertRaisesRegex(NativeAppDataBindingError, "suspended"):
                        registry.mint_from_receipt(digest)
            except BaseException as exc:
                errors.append(exc)
            finally:
                complete.set()

        worker = threading.Thread(target=make_request, daemon=True)
        stopper = threading.Thread(target=quiesce, daemon=True)
        with mock.patch("native_app_data_binding.handle_app_data_request", side_effect=blocking_endpoint):
            try:
                worker.start()
                self.assertTrue(entered.wait(timeout=5))
                stopper.start()
                for _ in range(200):
                    if registry.resolve(original.endpoint) is None:
                        break
                    time.sleep(0.01)
                self.assertIsNone(registry.resolve(original.endpoint))
                self.assertFalse(quiesced.is_set(), "quiescence ignored admitted request")
                self.assertFalse(complete.is_set())
            finally:
                release.set()
                worker.join(timeout=8)
                stopper.join(timeout=8)
        self.assertFalse(worker.is_alive())
        self.assertFalse(stopper.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(quiesced.is_set())
        self.assertTrue(complete.is_set())
        self.assertEqual(registry.active_binding_count(), 0)
        with self.assertRaises(NativeAppDataBindingNotFoundError):
            handle_bound_app_data_request(registry, original.endpoint, b'{"action":"list"}')
        fresh = registry.mint_from_receipt(digest)
        self.assertNotEqual(fresh.endpoint, original.endpoint)

    def test_quiescence_includes_old_receipt_requests_admitted_before_rotation(self):
        registry = self.registry()
        first_digest = self.write_receipt()
        first = registry.mint_from_receipt(first_digest)
        entered = threading.Event()
        release = threading.Event()
        ready = threading.Event()
        failures = []
        rotated_digest = self.write_receipt(receipt(
            sourceVersion="0.4.2", sourceDigest="2" * 64,
            verificationGeneration=2,
        ))

        def paused(*args, **kwargs):
            entered.set()
            if not release.wait(timeout=8):
                raise AssertionError("held request never released")
            return {"ok": True}

        def request():
            try:
                handle_bound_app_data_request(registry, first.endpoint, b'{"action":"list"}')
            except BaseException as exc:
                failures.append(exc)

        def suspend():
            try:
                with registry.suspend_verified_receipt_for_maintenance(rotated_digest):
                    ready.set()
            except BaseException as exc:
                failures.append(exc)

        a = threading.Thread(target=request, daemon=True)
        b = threading.Thread(target=suspend, daemon=True)
        with mock.patch("native_app_data_binding.handle_app_data_request", side_effect=paused):
            try:
                a.start()
                self.assertTrue(entered.wait(timeout=5))
                second = registry.mint_from_receipt(rotated_digest)
                self.assertIsNone(registry.resolve(first.endpoint))
                b.start()
                for _ in range(200):
                    if registry.resolve(second.endpoint) is None:
                        break
                    time.sleep(0.01)
                self.assertIsNone(registry.resolve(second.endpoint))
                self.assertFalse(ready.is_set(), "old receipt request bypassed quiescence")
            finally:
                release.set()
                a.join(timeout=8)
                b.join(timeout=8)
        self.assertFalse(a.is_alive())
        self.assertFalse(b.is_alive())
        self.assertEqual(failures, [])
        self.assertTrue(ready.is_set())

    def test_maintenance_rejects_unknown_receipt_without_revoking_another_app(self):
        registry = self.registry()
        first_digest = self.write_receipt()
        binding = registry.mint_from_receipt(first_digest)
        other = self.write_receipt(receipt(appId="assistant", sourceVersion="0.3.0"))
        with self.assertRaises(NativeAppDataBindingNotFoundError):
            with registry.suspend_verified_receipt_for_maintenance(other):
                pass
        self.assertIs(registry.resolve(binding.endpoint), binding)
        with self.assertRaises(NativeAppDataBindingNotFoundError):
            with registry.suspend_verified_receipt_for_maintenance("0" * 64):
                pass

    def test_binding_capacity_is_hard_bounded_but_rotation_is_allowed(self):
        registry = self.registry(max_bindings=1)
        first = registry.mint_from_receipt(self.write_receipt())
        rotated = registry.mint_from_receipt(
            self.write_receipt(
                receipt(
                    sourceVersion="0.4.2",
                    sourceDigest="4" * 64,
                    verificationGeneration=2,
                )
            )
        )
        self.assertNotEqual(first.endpoint, rotated.endpoint)
        self.assertEqual(registry.active_binding_count(), 1)

        other_digest = self.write_receipt(
            receipt(
                appId="browser",
                sourceDigest="5" * 64,
            )
        )
        with self.assertRaises(NativeAppDataBindingCapacityError):
            registry.mint_from_receipt(other_digest)
        self.assertEqual(registry.active_binding_count(), 1)


if __name__ == "__main__":
    unittest.main()
