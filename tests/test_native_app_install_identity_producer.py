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

from native_app_install_identity import read_verified_app_install_identity  # noqa: E402
from native_app_install_identity_producer import (  # noqa: E402
    VerifiedSystemReleaseHandoffError,
    produce_system_release_bundled_receipt,
    read_verified_system_release_handoff,
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


class SystemReleaseReceiptProducerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.temp = Path(self.temporary.name)
        self.receipt_root = self.temp / "receipts"
        self.receipt_root.mkdir(mode=0o700)
        os.chmod(self.receipt_root, 0o700)
        self.handoff_path = self.temp / "portable-release-verify.json"
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

    def read_handoff(self):
        return read_verified_system_release_handoff(
            str(self.handoff_path),
            expected_uid=self.uid,
            portable_root=PORTABLE_ROOT,
        )

    def produce(self, verified):
        return produce_system_release_bundled_receipt(
            verified,
            publisher_principal_id="ordax-official",
            app_id="notes",
            source_version="0.4.1",
            verification_policy="ordax.publisher-trust/1",
            verification_generation=1,
            root=str(self.receipt_root),
            expected_uid=self.uid,
        )

    def test_verified_handoff_produces_content_addressed_bundled_receipt(self):
        self.write_handoff()
        verified_handoff = self.read_handoff()
        receipt_digest = self.produce(verified_handoff)
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

        stored = self.receipt_root / f"{receipt_digest}.json"
        self.assertTrue(stored.is_file())
        self.assertEqual(stored.stat().st_mode & 0o777, 0o600)
        self.assertEqual(stored.stat().st_nlink, 1)

    def test_same_input_is_idempotent_and_does_not_duplicate_receipts(self):
        self.write_handoff()
        verified_handoff = self.read_handoff()
        first = self.produce(verified_handoff)
        second = self.produce(verified_handoff)
        self.assertEqual(first, second)
        self.assertEqual(
            sorted(path.name for path in self.receipt_root.iterdir()),
            [f"{first}.json"],
        )

    def test_caller_cannot_override_system_digest_or_source_authority(self):
        signature = inspect.signature(produce_system_release_bundled_receipt)
        self.assertNotIn("source_digest", signature.parameters)
        self.assertNotIn("source_class", signature.parameters)
        self.assertNotIn("verification_owner", signature.parameters)

        self.write_handoff()
        verified_handoff = self.read_handoff()
        with self.assertRaises(TypeError):
            produce_system_release_bundled_receipt(
                verified_handoff,
                publisher_principal_id="ordax-official",
                app_id="notes",
                source_version="0.4.1",
                verification_policy="ordax.publisher-trust/1",
                verification_generation=1,
                source_digest="f" * 64,
                root=str(self.receipt_root),
                expected_uid=self.uid,
            )

    def test_missing_or_extra_handoff_fields_fail_closed(self):
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

    def test_handoff_symlink_is_rejected(self):
        target = self.temp / "real-handoff.json"
        target.write_text(json.dumps(handoff()), encoding="utf-8")
        os.chmod(target, 0o600)
        os.symlink(target.name, self.handoff_path)
        with self.assertRaises(VerifiedSystemReleaseHandoffError):
            self.read_handoff()

    def test_group_writable_handoff_is_rejected(self):
        self.write_handoff(mode=0o620)
        with self.assertRaisesRegex(VerifiedSystemReleaseHandoffError, "metadata"):
            self.read_handoff()

    def test_receipt_root_wrong_mode_is_rejected(self):
        self.write_handoff()
        verified_handoff = self.read_handoff()
        os.chmod(self.receipt_root, 0o750)
        with self.assertRaisesRegex(Exception, "root ownership/mode"):
            self.produce(verified_handoff)


if __name__ == "__main__":
    unittest.main()
