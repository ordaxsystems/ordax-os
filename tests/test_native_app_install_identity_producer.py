#!/usr/bin/env python3

from __future__ import annotations

import inspect
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

from native_app_install_identity import (  # noqa: E402
    VerifiedAppInstallIdentityError,
    read_verified_app_install_identity,
)
from native_app_install_identity_producer import (  # noqa: E402
    FirstPartyIdentityInventoryError,
    VerifiedBundledAppIdentity,
    VerifiedSystemReleaseHandoffError,
    produce_system_release_bundled_receipt,
    read_bundled_first_party_identity,
    read_verified_system_release_handoff,
    validate_first_party_identity_inventory,
    validate_verified_system_release_handoff,
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


def handoff_for_schema(version: int):
    value = handoff()
    if version == 2:
        value["status"] = "verified-portable-exact"
        value.pop("runtime_path")
        value.pop("ai_runtime_path")
    elif version == 3:
        value["status"] = "verified-portable-v3-exact"
        value.pop("ai_runtime_path")
    elif version != 4:
        raise ValueError("unsupported test schema")
    return value


def inventory(**overrides):
    value = {
        "$schema": "ordax.first-party-app-identity-inventory/1",
        "status": "system-release-authenticated-source",
        "authority": "semantic-identity-only",
        "verificationPolicy": "ordax.publisher-trust/1",
        "verificationGeneration": 1,
        "apps": [
            {
                "appId": "notes",
                "publisherPrincipalId": "ordax-official",
                "version": "0.4.1",
            }
        ],
    }
    value.update(overrides)
    return value


class SystemReleaseReceiptProducerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.receipt_root = self.temp / "receipts"
        self.receipt_root.mkdir(mode=0o700)
        os.chmod(self.receipt_root, 0o700)
        self.handoff_path = self.temp / "portable-release-verify.json"
        self.inventory_path = self.temp / "first-party-identities.json"
        self.uid = os.getuid()

    def tearDown(self):
        self.temporary.cleanup()

    def write_handoff(self, value=None, *, mode=0o600):
        payload = json.dumps(
            handoff() if value is None else value,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8") + b"\n"
        self.handoff_path.write_bytes(payload)
        os.chmod(self.handoff_path, mode)

    def write_inventory(self, value=None, *, mode=0o644):
        payload = json.dumps(
            inventory() if value is None else value,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8") + b"\n"
        self.inventory_path.write_bytes(payload)
        os.chmod(self.inventory_path, mode)

    def read_handoff(self):
        return read_verified_system_release_handoff(
            str(self.handoff_path),
            expected_uid=self.uid,
            portable_root=PORTABLE_ROOT,
        )

    def read_identity(self, app_id="notes"):
        return read_bundled_first_party_identity(
            app_id,
            path=str(self.inventory_path),
            expected_uid=self.uid,
        )

    def produce(self, verified_handoff, verified_identity):
        return produce_system_release_bundled_receipt(
            verified_handoff,
            verified_identity,
            root=str(self.receipt_root),
            expected_uid=self.uid,
        )

    def test_verified_inputs_produce_content_addressed_bundled_receipt(self):
        self.write_handoff()
        self.write_inventory()
        verified_handoff = self.read_handoff()
        verified_identity = self.read_identity()
        receipt_digest = self.produce(verified_handoff, verified_identity)
        verified = read_verified_app_install_identity(
            receipt_digest,
            root=str(self.receipt_root),
            expected_uid=self.uid,
        )

        self.assertEqual(verified.publisher_principal_id, "ordax-official")
        self.assertEqual(verified.app_id, "notes")
        self.assertEqual(verified.owner_scope, "device")
        self.assertEqual(verified.source_class, "system-release-bundled")
        self.assertEqual(verified.source_version, "0.4.1")
        self.assertEqual(verified.source_digest, SYSTEM_DIGEST)
        self.assertEqual(verified.verification_owner, "release-acquisition")
        self.assertEqual(verified.verification_policy, "ordax.publisher-trust/1")
        self.assertEqual(verified.verification_generation, 1)

        stored = self.receipt_root / f"{receipt_digest}.json"
        self.assertTrue(stored.is_file())
        self.assertEqual(stored.stat().st_mode & 0o777, 0o600)
        self.assertEqual(stored.stat().st_nlink, 1)

    def test_v2_v3_and_v4_exact_handoffs_preserve_verified_system_digest(self):
        for version in (2, 3, 4):
            with self.subTest(version=version):
                verified = validate_verified_system_release_handoff(
                    handoff_for_schema(version),
                    portable_root=PORTABLE_ROOT,
                )
                self.assertEqual(verified.source_commit, COMMIT)
                self.assertEqual(verified.artifact_sha256, SYSTEM_DIGEST)
                self.assertEqual(
                    verified.artifact_path,
                    f"{PORTABLE_ROOT}/releases/{COMMIT}/system.erofs",
                )

    def test_same_verified_inputs_are_idempotent(self):
        self.write_handoff()
        self.write_inventory()
        verified_handoff = self.read_handoff()
        verified_identity = self.read_identity()
        first = self.produce(verified_handoff, verified_identity)
        second = self.produce(verified_handoff, verified_identity)
        self.assertEqual(first, second)
        self.assertEqual(
            sorted(path.name for path in self.receipt_root.iterdir()),
            [f"{first}.json"],
        )

    def test_producer_has_no_raw_identity_or_source_authority_parameters(self):
        signature = inspect.signature(produce_system_release_bundled_receipt)
        for forbidden in (
            "publisher_principal_id",
            "app_id",
            "source_version",
            "verification_policy",
            "verification_generation",
            "source_digest",
            "source_class",
            "verification_owner",
        ):
            self.assertNotIn(forbidden, signature.parameters)
        self.assertIn("app_identity", signature.parameters)

    def test_bundled_identity_cannot_be_constructed_without_inventory_authority(self):
        with self.assertRaisesRegex(TypeError, "verified inventory"):
            VerifiedBundledAppIdentity(
                publisher_principal_id="attacker",
                app_id="notes",
                source_version="9.9.9",
                verification_policy="ordax.publisher-trust/1",
                verification_generation=1,
                _authority=object(),
            )

    def test_inventory_projects_semantic_identity_and_rejects_unknown_app(self):
        self.write_inventory()
        identity = self.read_identity()
        self.assertEqual(identity.publisher_principal_id, "ordax-official")
        self.assertEqual(identity.app_id, "notes")
        self.assertEqual(identity.source_version, "0.4.1")
        self.assertEqual(identity.verification_policy, "ordax.publisher-trust/1")
        self.assertEqual(identity.verification_generation, 1)
        with self.assertRaisesRegex(FirstPartyIdentityInventoryError, "not in inventory"):
            self.read_identity("internet")

    def test_inventory_rejects_display_or_signing_metadata_and_duplicates(self):
        candidate = inventory()
        candidate["keyId"] = "release-key"
        with self.assertRaises(FirstPartyIdentityInventoryError):
            validate_first_party_identity_inventory(candidate)

        duplicated = inventory(
            apps=[
                {
                    "appId": "notes",
                    "publisherPrincipalId": "ordax-official",
                    "version": "0.4.1",
                },
                {
                    "appId": "notes",
                    "publisherPrincipalId": "other",
                    "version": "0.4.2",
                },
            ]
        )
        with self.assertRaisesRegex(FirstPartyIdentityInventoryError, "duplicated"):
            validate_first_party_identity_inventory(duplicated)

    def test_inventory_must_be_sorted_and_canonical(self):
        unsorted = inventory(
            apps=[
                {
                    "appId": "notes",
                    "publisherPrincipalId": "ordax-official",
                    "version": "0.4.1",
                },
                {
                    "appId": "files",
                    "publisherPrincipalId": "ordax-official",
                    "version": "0.1.0",
                },
            ]
        )
        with self.assertRaisesRegex(FirstPartyIdentityInventoryError, "sorted"):
            validate_first_party_identity_inventory(unsorted)

    def test_missing_extra_or_malformed_handoff_fields_fail_closed(self):
        missing = handoff()
        del missing["artifact_sha256"]
        with self.assertRaises(VerifiedSystemReleaseHandoffError):
            validate_verified_system_release_handoff(
                missing,
                portable_root=PORTABLE_ROOT,
            )

        extra = handoff(appId="notes")
        with self.assertRaises(VerifiedSystemReleaseHandoffError):
            validate_verified_system_release_handoff(
                extra,
                portable_root=PORTABLE_ROOT,
            )

        for digest in ("B" * 64, "b" * 63, "g" * 64):
            with self.subTest(digest=digest):
                with self.assertRaises(VerifiedSystemReleaseHandoffError):
                    validate_verified_system_release_handoff(
                        handoff(artifact_sha256=digest),
                        portable_root=PORTABLE_ROOT,
                    )

    def test_status_specific_fields_fail_closed(self):
        v2_with_runtime = handoff_for_schema(2)
        v2_with_runtime["runtime_path"] = (
            f"{PORTABLE_ROOT}/runtimes/sha256/{RUNTIME_DIGEST}/native-surface-runtime.erofs"
        )
        v3_missing_runtime = handoff_for_schema(3)
        del v3_missing_runtime["runtime_path"]
        for candidate in (v2_with_runtime, v3_missing_runtime):
            with self.subTest(candidate=candidate):
                with self.assertRaises(VerifiedSystemReleaseHandoffError):
                    validate_verified_system_release_handoff(
                        candidate,
                        portable_root=PORTABLE_ROOT,
                    )

    def test_noncanonical_release_or_artifact_path_fails_closed(self):
        for candidate in (
            handoff(release_path=f"{PORTABLE_ROOT}/releases/{'e' * 40}"),
            handoff(artifact_path=f"{PORTABLE_ROOT}/releases/{COMMIT}/other.erofs"),
        ):
            with self.subTest(candidate=candidate):
                with self.assertRaises(VerifiedSystemReleaseHandoffError):
                    validate_verified_system_release_handoff(
                        candidate,
                        portable_root=PORTABLE_ROOT,
                    )

    def test_handoff_must_remain_non_activating(self):
        with self.assertRaises(VerifiedSystemReleaseHandoffError):
            validate_verified_system_release_handoff(
                handoff(activation_allowed=True),
                portable_root=PORTABLE_ROOT,
            )

    def test_handoff_and_inventory_symlinks_are_rejected(self):
        target = self.temp / "real-handoff.json"
        target.write_text(json.dumps(handoff()), encoding="utf-8")
        os.chmod(target, 0o600)
        os.symlink(target.name, self.handoff_path)
        with self.assertRaises(VerifiedSystemReleaseHandoffError):
            self.read_handoff()

        inventory_target = self.temp / "real-inventory.json"
        inventory_target.write_text(json.dumps(inventory()), encoding="utf-8")
        os.chmod(inventory_target, 0o644)
        os.symlink(inventory_target.name, self.inventory_path)
        with self.assertRaises(FirstPartyIdentityInventoryError):
            self.read_identity()

    def test_group_writable_trusted_inputs_are_rejected(self):
        self.write_handoff(mode=0o620)
        with self.assertRaisesRegex(VerifiedSystemReleaseHandoffError, "metadata"):
            self.read_handoff()

        self.write_inventory(mode=0o664)
        with self.assertRaisesRegex(FirstPartyIdentityInventoryError, "metadata"):
            self.read_identity()

    def test_receipt_root_wrong_mode_is_rejected(self):
        self.write_handoff()
        self.write_inventory()
        verified_handoff = self.read_handoff()
        verified_identity = self.read_identity()
        os.chmod(self.receipt_root, 0o750)
        with self.assertRaisesRegex(
            VerifiedAppInstallIdentityError,
            "root ownership/mode",
        ):
            self.produce(verified_handoff, verified_identity)


if __name__ == "__main__":
    unittest.main()
