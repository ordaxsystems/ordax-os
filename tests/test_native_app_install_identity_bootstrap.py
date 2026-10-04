#!/usr/bin/env python3

from __future__ import annotations

import inspect
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

from native_app_install_identity import read_verified_app_install_identity  # noqa: E402
from native_app_install_identity_bootstrap import (  # noqa: E402
    SESSION_INDEX_NAME,
    SESSION_INDEX_SCHEMA,
    VerifiedInstallBootstrapError,
    bootstrap_system_release_bundled_receipts,
    ensure_verified_receipt_root,
    receipt_root_for_state,
)

COMMIT = "a" * 40
SYSTEM_DIGEST = "b" * 64
RUNTIME_DIGEST = "c" * 64
AI_DIGEST = "d" * 64
PORTABLE_ROOT = "/ordax-data/.ordax"


def handoff(**overrides):
    value = {
        "status": "verified-portable-v4-exact",
        "source_commit": COMMIT,
        "release_path": f"{PORTABLE_ROOT}/releases/{COMMIT}",
        "artifact_path": f"{PORTABLE_ROOT}/releases/{COMMIT}/system.erofs",
        "artifact_sha256": SYSTEM_DIGEST,
        "runtime_path": f"{PORTABLE_ROOT}/runtimes/sha256/{RUNTIME_DIGEST}/native-surface-runtime.erofs",
        "ai_runtime_path": f"{PORTABLE_ROOT}/ai-runtimes/sha256/{AI_DIGEST}/local-ai-runtime.erofs",
        "activation_allowed": False,
    }
    value.update(overrides)
    return value


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


class VerifiedInstallBootstrapTest(unittest.TestCase):
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
        self.write_handoff()
        self.write_inventory()

    def tearDown(self):
        self.temporary.cleanup()

    def write_handoff(self, value=None, *, mode=0o600):
        payload = json.dumps(
            handoff() if value is None else value,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8") + b"\n"
        self.handoff_path.write_bytes(payload)
        os.chmod(self.handoff_path, mode)

    def write_inventory(self, value=None, *, mode=0o644):
        payload = json.dumps(
            inventory() if value is None else value,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8") + b"\n"
        self.inventory_path.write_bytes(payload)
        os.chmod(self.inventory_path, mode)

    def bootstrap(self):
        return bootstrap_system_release_bundled_receipts(
            expected_uid=self.uid,
            state_root=str(self.state_root),
            session_dir=str(self.session_dir),
            handoff_path=str(self.handoff_path),
            inventory_path=str(self.inventory_path),
            portable_root=PORTABLE_ROOT,
        )

    def test_bootstrap_materializes_all_receipts_and_root_only_session_index(self):
        result = self.bootstrap()
        self.assertEqual(result["receiptCount"], 2)
        self.assertEqual(result["sourceCommit"], COMMIT)
        self.assertEqual(result["systemDigest"], SYSTEM_DIGEST)

        receipt_root = Path(receipt_root_for_state(str(self.state_root)))
        self.assertTrue(receipt_root.is_dir())
        self.assertEqual(stat.S_IMODE(receipt_root.stat().st_mode), 0o700)
        receipt_files = sorted(receipt_root.glob("*.json"))
        self.assertEqual(len(receipt_files), 2)
        for receipt in receipt_files:
            self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)

        index_path = self.session_dir / SESSION_INDEX_NAME
        self.assertTrue(index_path.is_file())
        self.assertEqual(stat.S_IMODE(index_path.stat().st_mode), 0o600)
        index = json.loads(index_path.read_text(encoding="utf-8"))
        self.assertEqual(index["$schema"], SESSION_INDEX_SCHEMA)
        self.assertEqual(index["status"], "verified-current-boot")
        self.assertEqual(index["sourceCommit"], COMMIT)
        self.assertEqual(index["systemDigest"], SYSTEM_DIGEST)
        self.assertEqual([item["appId"] for item in index["receipts"]], ["files", "notes"])

        by_app = {item["appId"]: item["receiptSha256"] for item in index["receipts"]}
        for app_id, digest in by_app.items():
            verified = read_verified_app_install_identity(
                digest,
                root=str(receipt_root),
                expected_uid=self.uid,
            )
            self.assertEqual(verified.app_id, app_id)
            self.assertEqual(verified.publisher_principal_id, "ordax-official")
            self.assertEqual(verified.source_digest, SYSTEM_DIGEST)

    def test_bootstrap_is_idempotent_for_same_release(self):
        first = self.bootstrap()
        receipt_root = Path(receipt_root_for_state(str(self.state_root)))
        before = sorted(path.name for path in receipt_root.glob("*.json"))
        first_index = (self.session_dir / SESSION_INDEX_NAME).read_bytes()

        second = self.bootstrap()
        after = sorted(path.name for path in receipt_root.glob("*.json"))
        second_index = (self.session_dir / SESSION_INDEX_NAME).read_bytes()

        self.assertEqual(first["receiptCount"], second["receiptCount"])
        self.assertEqual(before, after)
        self.assertEqual(first_index, second_index)

    def test_failed_refresh_removes_stale_session_index(self):
        stale = self.session_dir / SESSION_INDEX_NAME
        stale.write_text('{"stale":true}\n', encoding="utf-8")
        os.chmod(stale, 0o600)
        bad = handoff(artifact_sha256="not-a-digest")
        self.write_handoff(bad)

        with self.assertRaises(Exception):
            self.bootstrap()
        self.assertFalse(stale.exists())

    def test_receipt_namespace_symlink_is_rejected(self):
        external = self.temp / "external"
        external.mkdir(mode=0o700)
        (self.state_root / "app-install").symlink_to(external, target_is_directory=True)
        with self.assertRaises(VerifiedInstallBootstrapError):
            ensure_verified_receipt_root(
                state_root=str(self.state_root),
                expected_uid=self.uid,
            )
        self.assertFalse((external / "verified-identities").exists())

    def test_group_writable_inventory_is_rejected_and_no_index_is_published(self):
        self.write_inventory(mode=0o664)
        with self.assertRaises(VerifiedInstallBootstrapError):
            self.bootstrap()
        self.assertFalse((self.session_dir / SESSION_INDEX_NAME).exists())

    def test_public_bootstrap_api_does_not_accept_app_or_publisher_identity(self):
        parameters = inspect.signature(bootstrap_system_release_bundled_receipts).parameters
        forbidden = {
            "app_id",
            "publisher_id",
            "publisher_principal_id",
            "source_digest",
            "source_version",
            "receipt_sha256",
            "capability",
        }
        self.assertTrue(forbidden.isdisjoint(parameters))


if __name__ == "__main__":
    unittest.main()
