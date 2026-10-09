#!/usr/bin/env python3
"""Regression tests for runtime-component public trust promotion."""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROMOTER_PATH = (
    ROOT / "tools" / "runtime-component-channel" / "promote_public_trust.py"
)

spec = importlib.util.spec_from_file_location(
    "ordax_runtime_component_trust_promoter_test",
    PROMOTER_PATH,
)
promoter = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = promoter
spec.loader.exec_module(promoter)

SOURCE_COMMIT = "7" * 40
KEY_ID = "ordax-runtime-components-v1"


def json_bytes(value: dict) -> bytes:
    return (json.dumps(value, indent=2) + "\n").encode("utf-8")


class RuntimeComponentTrustPromotionTests(unittest.TestCase):
    def make_repo(self, root: Path) -> None:
        (root / "docs" / "contracts").mkdir(parents=True)
        (root / "docs" / "evidence").mkdir(parents=True)
        (root / "system" / "trust").mkdir(parents=True)

        policy = {
            "$schema": "prototype-ordax.runtime-component-trust-policy/1",
            "status": "operator-ceremony-pending",
            "trust_domain": "runtime-components",
            "key_id": KEY_ID,
            "trust_schema": "prototype-ordax.runtime-component-trust/1",
            "public_anchor": {
                "repository_path": "system/trust/runtime-components-ed25519.json",
                "runtime_path": "/srv/ordax-system/trust/runtime-components-ed25519.json",
                "pinned": False,
                "sha256": None,
            },
            "private_key": {
                "repository_allowed": False,
                "device_allowed": False,
                "actions_artifact_allowed": False,
                "chat_allowed": False,
                "external_custody_required": True,
                "encrypted_recovery_copy_required": True,
                "recovery_proof_required_before_public_anchor_pin": True,
            },
            "separation": {
                "whole_os_release_key_reuse_allowed": False,
                "whole_os_release_trust_alias_allowed": False,
                "ci_ephemeral_key_may_be_canonical": False,
                "component_publication_authority_separate_from_os_release_publication": True,
            },
            "ceremony": {
                "source_commit_binding_required": True,
                "independent_public_derivation_required": True,
                "private_public_match_required": True,
                "protocol_shaped_signing_proof_required": True,
                "recovered_private_key_signing_proof_required": True,
                "public_only_handoff_required": True,
                "manual_operator_action_required": True,
            },
            "promotion": {
                "canonical_anchor_pin_requires_completed_ceremony": True,
                "pinning_enables_publication": False,
                "pinning_enables_activation": False,
                "pinning_authorizes_physical_write": False,
                "component_slot_activation_requires_separate_runtime_health_proof": True,
            },
            "current_gates": {
                "canonical_component_trust_anchor_pinned": False,
                "component_publish_allowed": False,
                "production_component_slot_activation_allowed": False,
            },
        }
        package = {
            "$schema": "prototype-ordax.runtime-component-package-policy/1",
            "status": "signed-slot-staging",
            "canonical_component_trust_anchor_pinned": False,
            "publish_allowed": False,
            "slot_activation_available": False,
            "pending_health_promotion_available": False,
            "rollback_slot_activation_available": False,
            "native_slot_serving_available": False,
            "native_loopback_verified_read_broker_implemented": True,
            "native_loopback_broker_read_only": True,
            "internet_release_mode": "git-app",
        }
        (root / "docs" / "contracts" / "runtime-component-trust-policy.json").write_bytes(
            json_bytes(policy)
        )
        (root / "docs" / "contracts" / "runtime-component-package.json").write_bytes(
            json_bytes(package)
        )

    def make_verifier(self, root: Path, source_commit: str = SOURCE_COMMIT) -> Path:
        path = root / "fake-component-verifier"
        path.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' "
            "'RUNTIME_COMPONENT_ENVELOPE_VERIFIED=YES' "
            "'COMPONENT_ID=internet' "
            "'COMPONENT_VERSION=0.0.0-trust-proof' "
            f"'SOURCE_COMMIT={source_commit}' "
            "'PENDING_HEALTH_REQUIRED=YES'\n",
            encoding="utf-8",
        )
        path.chmod(0o755)
        return path

    def make_public_files(self, root: Path) -> dict[str, bytes]:
        public_key = bytes(range(32))
        trust = {
            "$schema": "prototype-ordax.runtime-component-trust/1",
            "key_id": KEY_ID,
            "public_key_base64": base64.b64encode(public_key).decode("ascii"),
        }
        trust_payload = json_bytes(trust)

        release = {
            "$schema": "prototype-ordax.runtime-component-release/1",
            "source_repository": "ordaxsystems/ordax-os",
            "source_commit": SOURCE_COMMIT,
            "created_from_ci_recipe": "runtime-component/package/1",
            "component": {
                "id": "internet",
                "version": "0.0.0-trust-proof",
                "release_mode": "component-slot",
                "package_schema": "prototype-ordax.runtime-component-package/1",
            },
            "package": {
                "name": "internet.zip",
                "sha256": "0" * 64,
                "size": 1,
                "manifest_sha256": "1" * 64,
            },
            "activation": {
                "direct_activation_allowed": False,
                "pending_health_required": True,
            },
        }
        release_payload = json_bytes(release)

        envelope = {
            "$schema": "prototype-ordax.runtime-component-envelope/1",
            "payload": base64.b64encode(release_payload).decode("ascii"),
            "signature": base64.b64encode(bytes(range(64))).decode("ascii"),
            "key_id": KEY_ID,
        }
        envelope_payload = json_bytes(envelope)

        evidence = {
            "$schema": "prototype-ordax.runtime-component-trust-ceremony-evidence/1",
            "status": "pass",
            "source_commit": SOURCE_COMMIT,
            "key_id": KEY_ID,
            "public_trust_sha256": hashlib.sha256(trust_payload).hexdigest(),
            "proof_release_sha256": hashlib.sha256(release_payload).hexdigest(),
            "recovery_envelope_sha256": hashlib.sha256(envelope_payload).hexdigest(),
            "primary_public_derivation_match": True,
            "recovered_public_derivation_match": True,
            "recovered_private_path_distinct": True,
            "recovered_signing_proof": True,
            "offline_encrypted_backup_recovery_verified": True,
            "private_key_in_public_evidence": False,
            "ready_to_pin_public_anchor": True,
        }
        evidence_payload = json_bytes(evidence)

        return {
            "runtime-components-ed25519.json": trust_payload,
            "ceremony-public-evidence.json": evidence_payload,
            "component-trust-proof-release.json": release_payload,
            "component-trust-proof-recovery-envelope.json": envelope_payload,
        }

    def write_promotion_dir(self, root: Path, files: dict[str, bytes]) -> Path:
        directory = root / "promotion"
        directory.mkdir()
        for name, payload in files.items():
            (directory / name).write_bytes(payload)
        return directory

    def write_zip(self, path: Path, files: dict[str, bytes]) -> None:
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, payload in files.items():
                archive.writestr(name, payload)

    def test_check_accepts_recovered_public_bundle_without_enabling_runtime(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            repo.mkdir()
            self.make_repo(repo)
            verifier = self.make_verifier(root)
            files = self.make_public_files(root)
            promotion = self.write_promotion_dir(root, files)

            plan = promoter.prepare_repository_promotion(repo, promotion, verifier)

            self.assertTrue(plan["ready"])
            self.assertEqual(plan["status"], "ready")
            self.assertEqual(plan["source_commit"], SOURCE_COMMIT)
            self.assertFalse(plan["component_publish_allowed"])
            self.assertFalse(plan["production_component_slot_activation_allowed"])
            self.assertFalse(plan["physical_write_allowed"])
            self.assertFalse(
                (repo / "system" / "trust" / "runtime-components-ed25519.json").exists()
            )

            policy = json.loads(
                plan["outputs"]["docs/contracts/runtime-component-trust-policy.json"]
            )
            package = json.loads(
                plan["outputs"]["docs/contracts/runtime-component-package.json"]
            )
            self.assertEqual(policy["status"], "canonical-public-trust-pinned")
            self.assertTrue(policy["public_anchor"]["pinned"])
            self.assertTrue(
                policy["current_gates"]["canonical_component_trust_anchor_pinned"]
            )
            self.assertFalse(policy["current_gates"]["component_publish_allowed"])
            self.assertFalse(
                policy["current_gates"]["production_component_slot_activation_allowed"]
            )
            self.assertTrue(package["canonical_component_trust_anchor_pinned"])
            self.assertFalse(package["publish_allowed"])
            self.assertFalse(package["slot_activation_available"])
            self.assertEqual(package["internet_release_mode"], "git-app")

    def test_apply_writes_only_public_material_and_keeps_activation_blocked(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            repo.mkdir()
            self.make_repo(repo)
            verifier = self.make_verifier(root)
            files = self.make_public_files(root)
            promotion = self.write_promotion_dir(root, files)

            result = promoter.apply_repository_promotion(repo, promotion, verifier)

            self.assertEqual(result["status"], "promoted")
            self.assertFalse(result["component_publish_allowed"])
            self.assertFalse(result["production_component_slot_activation_allowed"])
            self.assertFalse(result["physical_write_allowed"])
            self.assertEqual(
                (repo / "system" / "trust" / "runtime-components-ed25519.json").read_bytes(),
                files["runtime-components-ed25519.json"],
            )
            policy = json.loads(
                (repo / "docs" / "contracts" / "runtime-component-trust-policy.json").read_text(
                    encoding="utf-8"
                )
            )
            package = json.loads(
                (repo / "docs" / "contracts" / "runtime-component-package.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(policy["status"], "canonical-public-trust-pinned")
            self.assertFalse(policy["current_gates"]["component_publish_allowed"])
            self.assertFalse(package["slot_activation_available"])
            self.assertFalse(package["pending_health_promotion_available"])
            self.assertFalse(package["rollback_slot_activation_available"])
            self.assertFalse(package["native_slot_serving_available"])

    def test_zip_rejects_secret_looking_or_extra_entry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = self.make_public_files(root)
            files["private.pem"] = b"not-a-key\n"
            handoff = root / "handoff.zip"
            self.write_zip(handoff, files)
            output = root / "out"
            output.mkdir()

            with self.assertRaises(promoter.PromotionError):
                promoter._materialize_public_handoff_zip(handoff, output)

    def test_tampered_evidence_hash_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = self.make_public_files(root)
            evidence = json.loads(files["ceremony-public-evidence.json"])
            evidence["public_trust_sha256"] = "f" * 64
            files["ceremony-public-evidence.json"] = json_bytes(evidence)
            promotion = self.write_promotion_dir(root, files)
            verifier = self.make_verifier(root)

            with self.assertRaises(promoter.PromotionError):
                promoter.validate_public_promotion_directory(promotion, verifier)

    def test_verifier_source_commit_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = self.make_public_files(root)
            promotion = self.write_promotion_dir(root, files)
            verifier = self.make_verifier(root, source_commit="8" * 40)

            with self.assertRaises(promoter.PromotionError):
                promoter.validate_public_promotion_directory(promotion, verifier)

    def test_public_zip_check_uses_exact_four_file_handoff(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"
            repo.mkdir()
            self.make_repo(repo)
            verifier = self.make_verifier(root)
            files = self.make_public_files(root)
            handoff = root / "OrdaX-Component-Public-Trust-Handoff.zip"
            self.write_zip(handoff, files)

            plan = promoter.prepare_repository_promotion_zip(repo, handoff, verifier)

            self.assertTrue(plan["ready"])
            self.assertEqual(plan["source_commit"], SOURCE_COMMIT)
            self.assertFalse(plan["component_publish_allowed"])


if __name__ == "__main__":
    unittest.main()
