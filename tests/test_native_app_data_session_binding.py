#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

from native_app_data_binding import (  # noqa: E402
    NativeAppDataBindingCapacityError,
    NativeAppDataBindingRegistry,
)
from native_app_install_identity_bootstrap import (  # noqa: E402
    SESSION_INDEX_NAME,
    bootstrap_system_release_bundled_receipts,
    receipt_root_for_state,
)
from native_app_data_session_binding import (  # noqa: E402
    NativeAppDataSessionBindingError,
    load_current_boot_app_data_bindings,
    validate_session_receipt_index,
)

COMMIT = "a" * 40
SYSTEM_DIGEST = "b" * 64
RUNTIME_DIGEST = "c" * 64
AI_DIGEST = "d" * 64
PORTABLE_ROOT = "/ordax-data/.ordax"
_ENDPOINT_RE = re.compile(r"^/__ordax/native/app-data/[A-Za-z0-9_-]{43}$")


def handoff():
    return {
        "status": "verified-portable-v4-exact",
        "source_commit": COMMIT,
        "release_path": f"{PORTABLE_ROOT}/releases/{COMMIT}",
        "artifact_path": f"{PORTABLE_ROOT}/releases/{COMMIT}/system.erofs",
        "artifact_sha256": SYSTEM_DIGEST,
        "runtime_path": f"{PORTABLE_ROOT}/runtimes/sha256/{RUNTIME_DIGEST}/native-surface-runtime.erofs",
        "ai_runtime_path": f"{PORTABLE_ROOT}/ai-runtimes/sha256/{AI_DIGEST}/local-ai-runtime.erofs",
        "activation_allowed": False,
    }


def inventory():
    return {
        "$schema": "ordax.first-party-app-identity-inventory/1",
        "status": "system-release-authenticated-source",
        "authority": "semantic-identity-only",
        "verificationPolicy": "ordax.publisher-trust/1",
        "verificationGeneration": 1,
        "apps": [
            {
                "appId": "files",
                "publisherPrincipalId": "ordax-official",
                "version": "0.1.0",
            },
            {
                "appId": "notes",
                "publisherPrincipalId": "ordax-official",
                "version": "0.4.1",
            },
        ],
    }


class FakeAppDataHost:
    def __init__(self, *, receipt_root: str, expected_uid: int, max_bindings: int = 64):
        self.registry = NativeAppDataBindingRegistry(
            receipt_root=receipt_root,
            expected_uid=expected_uid,
            max_bindings=max_bindings,
        )

    def bind_app_data_receipts(self, receipt_sha256s):
        return self.registry.mint_many_from_receipts(receipt_sha256s)


class NativeAppDataSessionBindingTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.state_root = self.temp / "state"
        self.session_dir = self.temp / "run"
        self.state_root.mkdir(mode=0o700)
        self.session_dir.mkdir(mode=0o700)
        os.chmod(self.state_root, 0o700)
        os.chmod(self.session_dir, 0o700)
        self.handoff_path = self.temp / "portable-release-verify.json"
        self.inventory_path = self.temp / "first-party-identities.json"
        self.uid = os.getuid()
        self.handoff_path.write_text(
            json.dumps(handoff(), sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        os.chmod(self.handoff_path, 0o600)
        self.inventory_path.write_text(
            json.dumps(inventory(), sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        os.chmod(self.inventory_path, 0o644)
        bootstrap_system_release_bundled_receipts(
            expected_uid=self.uid,
            state_root=str(self.state_root),
            session_dir=str(self.session_dir),
            handoff_path=str(self.handoff_path),
            inventory_path=str(self.inventory_path),
            portable_root=PORTABLE_ROOT,
        )
        self.receipt_root = receipt_root_for_state(str(self.state_root))
        self.index_path = self.session_dir / SESSION_INDEX_NAME

    def tearDown(self):
        self.temporary.cleanup()

    def new_host(self, *, max_bindings: int = 64):
        return FakeAppDataHost(
            receipt_root=self.receipt_root,
            expected_uid=self.uid,
            max_bindings=max_bindings,
        )

    def load(self, host):
        return load_current_boot_app_data_bindings(
            host,
            expected_uid=self.uid,
            index_path=str(self.index_path),
            handoff_path=str(self.handoff_path),
            receipt_root=self.receipt_root,
            inventory_path=str(self.inventory_path),
            portable_root=PORTABLE_ROOT,
        )

    def test_current_boot_index_mints_internal_bindings_without_receipt_sha(self):
        host = self.new_host()
        descriptors = self.load(host)
        self.assertEqual([item.app_id for item in descriptors], ["files", "notes"])
        self.assertEqual(host.registry.active_binding_count(), 2)
        for descriptor in descriptors:
            self.assertRegex(descriptor.endpoint, _ENDPOINT_RE)
            self.assertEqual(descriptor.publisher_id, "ordax-official")
            self.assertEqual(descriptor.owner_scope, "device")
            self.assertEqual(
                descriptor.app_data_identity(),
                {
                    "publisherId": "ordax-official",
                    "appId": descriptor.app_id,
                    "ownerScope": "device",
                },
            )
            self.assertFalse(hasattr(descriptor, "receipt_sha256"))

    def test_reload_same_current_boot_is_idempotent(self):
        host = self.new_host()
        first = self.load(host)
        second = self.load(host)
        self.assertEqual(
            [(item.app_id, item.endpoint) for item in first],
            [(item.app_id, item.endpoint) for item in second],
        )
        self.assertEqual(host.registry.active_binding_count(), 2)

    def test_capacity_failure_is_transactional(self):
        host = self.new_host(max_bindings=1)
        with self.assertRaises(NativeAppDataBindingCapacityError):
            self.load(host)
        self.assertEqual(host.registry.active_binding_count(), 0)

    def test_stale_system_digest_fails_before_any_capability_is_minted(self):
        value = json.loads(self.index_path.read_text(encoding="utf-8"))
        value["systemDigest"] = "e" * 64
        self.index_path.write_text(
            json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        os.chmod(self.index_path, 0o600)
        host = self.new_host()
        with self.assertRaises(NativeAppDataSessionBindingError):
            self.load(host)
        self.assertEqual(host.registry.active_binding_count(), 0)

    def test_app_id_receipt_mismatch_fails_before_partial_mint(self):
        value = json.loads(self.index_path.read_text(encoding="utf-8"))
        value["receipts"][0]["receiptSha256"] = value["receipts"][1]["receiptSha256"]
        self.index_path.write_text(
            json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        os.chmod(self.index_path, 0o600)
        host = self.new_host()
        with self.assertRaises(NativeAppDataSessionBindingError):
            self.load(host)
        self.assertEqual(host.registry.active_binding_count(), 0)

    def test_group_writable_index_is_rejected_before_mint(self):
        os.chmod(self.index_path, 0o660)
        host = self.new_host()
        with self.assertRaises(NativeAppDataSessionBindingError):
            self.load(host)
        self.assertEqual(host.registry.active_binding_count(), 0)

    def test_unsorted_or_duplicate_index_is_rejected(self):
        value = json.loads(self.index_path.read_text(encoding="utf-8"))
        reversed_receipts = list(reversed(value["receipts"]))
        value["receipts"] = reversed_receipts
        with self.assertRaises(NativeAppDataSessionBindingError):
            validate_session_receipt_index(value)

        value["receipts"] = [reversed_receipts[0], reversed_receipts[0]]
        with self.assertRaises(NativeAppDataSessionBindingError):
            validate_session_receipt_index(value)

    def test_symlink_index_is_rejected(self):
        target = self.temp / "outside-index.json"
        target.write_bytes(self.index_path.read_bytes())
        os.chmod(target, 0o600)
        self.index_path.unlink()
        self.index_path.symlink_to(target)
        host = self.new_host()
        with self.assertRaises(NativeAppDataSessionBindingError):
            self.load(host)
        self.assertEqual(host.registry.active_binding_count(), 0)


if __name__ == "__main__":
    unittest.main()
