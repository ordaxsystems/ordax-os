#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

from system.surface.runtime.native_app_install_identity import (
    RECEIPT_SCHEMA,
    VerifiedAppInstallIdentityError,
    canonical_verified_app_install_identity_bytes,
    read_verified_app_install_identity,
    validate_verified_app_install_identity,
)


def receipt(**overrides):
    value = {
        "$schema": RECEIPT_SCHEMA,
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


class VerifiedAppInstallIdentityValidationTest(unittest.TestCase):
    def test_valid_receipt_projects_only_app_data_identity(self):
        normalized = validate_verified_app_install_identity(receipt())
        self.assertEqual(normalized["publisherPrincipalId"], "ordax-official")
        self.assertEqual(normalized["appId"], "notes")
        self.assertEqual(normalized["sourceClass"], "system-release-bundled")
        self.assertEqual(normalized["sourceVersion"], "0.4.1")
        self.assertEqual(normalized["verificationOwner"], "release-acquisition")

    def test_legacy_stable_base_bundled_class_is_rejected(self):
        with self.assertRaises(VerifiedAppInstallIdentityError):
            validate_verified_app_install_identity(
                receipt(
                    sourceClass="stable-base-bundled",
                    verificationOwner="stable-base-release",
                )
            )

    def test_manifest_publisher_or_signing_key_fields_are_rejected(self):
        for field, value in (
            ("publisher", "OrdaX"),
            ("keyId", "release-key-2026"),
            ("signingKeyFingerprint", "2" * 64),
        ):
            with self.subTest(field=field):
                candidate = receipt()
                candidate[field] = value
                with self.assertRaises(VerifiedAppInstallIdentityError):
                    validate_verified_app_install_identity(candidate)

    def test_source_class_must_match_verification_owner(self):
        with self.assertRaises(VerifiedAppInstallIdentityError):
            validate_verified_app_install_identity(
                receipt(
                    sourceClass="component-release-v2",
                    verificationOwner="release-acquisition",
                )
            )

    def test_owner_scope_is_device_only(self):
        with self.assertRaises(VerifiedAppInstallIdentityError):
            validate_verified_app_install_identity(receipt(ownerScope="account"))

    def test_generation_is_positive_safe_integer(self):
        for value in (0, -1, True, 2**53):
            with self.subTest(value=value):
                with self.assertRaises(VerifiedAppInstallIdentityError):
                    validate_verified_app_install_identity(
                        receipt(verificationGeneration=value)
                    )


class VerifiedAppInstallIdentityFileTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "verified"
        self.root.mkdir(mode=0o700)
        os.chmod(self.root, 0o700)
        self.uid = os.getuid()

    def tearDown(self):
        self.temporary.cleanup()

    def write_receipt(self, value=None, *, payload=None, mode=0o600):
        if payload is None:
            payload = canonical_verified_app_install_identity_bytes(
                receipt() if value is None else value
            )
        digest = hashlib.sha256(payload).hexdigest()
        path = self.root / f"{digest}.json"
        path.write_bytes(payload)
        os.chmod(path, mode)
        return digest, path

    def test_content_addressed_canonical_receipt_loads(self):
        digest, _ = self.write_receipt()
        verified = read_verified_app_install_identity(
            digest,
            root=str(self.root),
            expected_uid=self.uid,
        )
        self.assertEqual(
            verified.app_data_identity(),
            {
                "publisherId": "ordax-official",
                "appId": "notes",
                "ownerScope": "device",
            },
        )
        self.assertEqual(verified.source_class, "system-release-bundled")
        self.assertEqual(verified.source_version, "0.4.1")
        self.assertEqual(verified.verification_owner, "release-acquisition")
        self.assertEqual(verified.receipt_sha256, digest)

    def test_digest_mismatch_fails_closed(self):
        digest, path = self.write_receipt()
        wrong = ("0" if digest[0] != "0" else "1") + digest[1:]
        wrong_path = self.root / f"{wrong}.json"
        path.rename(wrong_path)
        with self.assertRaises(VerifiedAppInstallIdentityError):
            read_verified_app_install_identity(
                wrong,
                root=str(self.root),
                expected_uid=self.uid,
            )

    def test_noncanonical_json_fails_closed_even_when_digest_matches(self):
        payload = json.dumps(receipt(), indent=2).encode("utf-8")
        digest, _ = self.write_receipt(payload=payload)
        with self.assertRaisesRegex(VerifiedAppInstallIdentityError, "not canonical"):
            read_verified_app_install_identity(
                digest,
                root=str(self.root),
                expected_uid=self.uid,
            )

    def test_receipt_symlink_is_rejected(self):
        digest, path = self.write_receipt()
        target = self.root / "target"
        path.rename(target)
        os.symlink(target.name, self.root / f"{digest}.json")
        with self.assertRaises(VerifiedAppInstallIdentityError):
            read_verified_app_install_identity(
                digest,
                root=str(self.root),
                expected_uid=self.uid,
            )

    def test_wrong_file_mode_is_rejected(self):
        digest, _ = self.write_receipt(mode=0o640)
        with self.assertRaisesRegex(VerifiedAppInstallIdentityError, "metadata"):
            read_verified_app_install_identity(
                digest,
                root=str(self.root),
                expected_uid=self.uid,
            )

    def test_wrong_root_mode_is_rejected(self):
        digest, _ = self.write_receipt()
        os.chmod(self.root, 0o750)
        with self.assertRaisesRegex(VerifiedAppInstallIdentityError, "root ownership/mode"):
            read_verified_app_install_identity(
                digest,
                root=str(self.root),
                expected_uid=self.uid,
            )

    def test_wrong_owner_expectation_is_rejected(self):
        digest, _ = self.write_receipt()
        with self.assertRaisesRegex(VerifiedAppInstallIdentityError, "root ownership/mode"):
            read_verified_app_install_identity(
                digest,
                root=str(self.root),
                expected_uid=self.uid + 1,
            )

    def test_receipt_identifier_cannot_be_a_path(self):
        with self.assertRaisesRegex(VerifiedAppInstallIdentityError, "receipt sha256"):
            read_verified_app_install_identity(
                "../notes",
                root=str(self.root),
                expected_uid=self.uid,
            )


if __name__ == "__main__":
    unittest.main()
