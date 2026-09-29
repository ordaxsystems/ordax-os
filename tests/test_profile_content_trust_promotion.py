#!/usr/bin/env python3
"""Regression tests for Profile-content public trust promotion."""

from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROMOTER_PATH = ROOT / "tools" / "profile-content-channel" / "promote_public_trust.py"
spec = importlib.util.spec_from_file_location("ordax_profile_content_trust_promoter_test", PROMOTER_PATH)
promoter = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = promoter
spec.loader.exec_module(promoter)

SOURCE_COMMIT = "7" * 40
KEY_ID = "ordax-profile-content-v1"


def json_bytes(value: dict) -> bytes:
    return (json.dumps(value, indent=2) + "\n").encode("utf-8")


class ProfileContentTrustPromotionTests(unittest.TestCase):
    def make_repo(self, root: Path) -> None:
        (root / "docs" / "contracts").mkdir(parents=True)
        (root / "docs" / "evidence").mkdir(parents=True)
        (root / "system" / "trust").mkdir(parents=True)
        policy = {
            "$schema": "prototype-ordax.profile-content-trust-policy/1",
            "status": "operator-ceremony-not-started",
            "trust_domain": "profile-content",
            "key_id": KEY_ID,
            "trust_schema": "prototype-ordax.profile-content-trust/1",
            "manifest_schema": "prototype-ordax.profile-content-manifest/1",
            "envelope_schema": "prototype-ordax.profile-content-envelope/1",
            "signature_algorithm": "ed25519",
            "scope": {},
            "public_anchor": {
                "repository_path": "system/trust/profile-content-ed25519.json",
                "runtime_path": "/srv/ordax-system/trust/profile-content-ed25519.json",
                "pinned": False,
                "sha256": None,
            },
            "private_key": {},
            "separation": {},
            "verification": {},
            "promotion": {
                "canonical_anchor_pin_requires_operator_ceremony": True,
                "pinning_enables_publication": False,
                "pinning_enables_installation": False,
                "pinning_enables_activation": False,
                "healthy_stage_and_receipt_required_before_inventory_admission": True,
                "public_promoter_source_path": "tools/profile-content-channel/promote_public_trust.py",
                "public_handoff_zip_required": True,
                "public_reverification_required": True,
                "check_before_apply_required": True,
            },
            "current_gates": {
                "canonical_profile_content_trust_anchor_pinned": False,
                "profile_content_publish_allowed": False,
                "profile_content_install_allowed": False,
                "profile_content_activation_allowed": False,
            },
        }
        provisioning = {
            "$schema": "prototype-ordax.profile-provisioning/1",
            "status": "mvp-source-planner-download-executor-disabled",
            "runtime_schema": "ordax.profile-provisioning/1",
            "distribution_schema": "ordax.profile-distribution/1",
            "architecture": {},
            "trust": {},
            "mvp": {"public_profile_install_enabled": False},
            "next_gates": ["first-public-profile-proof"],
            "inventory": {},
            "receipt": {},
            "content_proof": {
                "public_release_trust_pinned": False,
                "activation_allowed": False,
            },
            "content_staging": {},
            "structural_health": {},
            "completed_gates": [],
        }
        (root / "docs/contracts/profile-content-trust-policy.json").write_bytes(json_bytes(policy))
        (root / "docs/contracts/profile-provisioning.json").write_bytes(json_bytes(provisioning))

    def make_verifier(self, root: Path) -> Path:
        path = root / "fake-profile-content-verifier"
        path.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' "
            "'PROFILE_CONTENT_VERIFY=PASS' "
            "'PROFILE_CONTENT_ID=knowledge.trust-ceremony-proof' "
            "'PROFILE_CONTENT_KIND=knowledge-pack' "
            "'PROFILE_CONTENT_VERSION=0.0.0-trust-proof' "
            "'PROFILE_CONTENT_ACTIVATION_ALLOWED=NO'\n",
            encoding="utf-8",
        )
        path.chmod(0o755)
        return path

    def make_public_files(self) -> dict[str, bytes]:
        trust = {
            "$schema": "prototype-ordax.profile-content-trust/1",
            "algorithm": "ed25519",
            "key_id": KEY_ID,
            "public_key_base64": base64.b64encode(bytes(range(32))).decode("ascii"),
        }
        trust_payload = json_bytes(trust)
        content = json_bytes({
            "schema": "ordax.profile-content-pack/1",
            "kind": "knowledge-pack",
            "entries": [{
                "id": "trust.ceremony-proof",
                "mediaType": "text/plain",
                "content": "proof",
                "contentSha256": hashlib.sha256(b"proof").hexdigest(),
                "source": {
                    "uri": "urn:ordax:profile-content:trust-ceremony-proof",
                    "revision": SOURCE_COMMIT,
                    "license": "internal-proof-only",
                    "jurisdiction": None,
                    "title": "Profile content trust ceremony proof",
                },
            }],
        })
        manifest = {
            "$schema": "prototype-ordax.profile-content-manifest/1",
            "id": "knowledge.trust-ceremony-proof",
            "kind": "knowledge-pack",
            "version": "0.0.0-trust-proof",
            "publisher": "ordax",
            "content_hash": hashlib.sha256(content).hexdigest(),
            "content_size": len(content),
            "content_format": "ordax.profile-content-pack/1",
            "source": {
                "uri": "urn:ordax:profile-content:trust-ceremony-proof",
                "revision": SOURCE_COMMIT,
                "license": "internal-proof-only",
                "jurisdiction": None,
            },
            "requested_capabilities": [],
            "runtime_network_allowed": False,
            "mutable_host_access_allowed": False,
        }
        manifest_payload = json_bytes(manifest)
        envelope = {
            "$schema": "prototype-ordax.profile-content-envelope/1",
            "algorithm": "ed25519",
            "key_id": KEY_ID,
            "signature_base64": base64.b64encode(bytes(range(64))).decode("ascii"),
        }
        envelope_payload = json_bytes(envelope)
        evidence = {
            "$schema": "prototype-ordax.profile-content-trust-ceremony-evidence/1",
            "status": "pass",
            "source_commit": SOURCE_COMMIT,
            "key_id": KEY_ID,
            "public_trust_sha256": hashlib.sha256(trust_payload).hexdigest(),
            "proof_manifest_sha256": hashlib.sha256(manifest_payload).hexdigest(),
            "proof_content_sha256": hashlib.sha256(content).hexdigest(),
            "recovery_envelope_sha256": hashlib.sha256(envelope_payload).hexdigest(),
            "primary_public_derivation_match": True,
            "recovered_public_derivation_match": True,
            "recovered_private_path_distinct": True,
            "recovered_signing_proof": True,
            "offline_encrypted_backup_recovery_verified": True,
            "private_key_in_public_evidence": False,
            "ready_to_pin_public_anchor": True,
        }
        return {
            "profile-content-ed25519.json": trust_payload,
            "ceremony-public-evidence.json": json_bytes(evidence),
            "profile-content-trust-proof-manifest.json": manifest_payload,
            "profile-content-trust-proof-recovery-envelope.json": envelope_payload,
            "content.pack": content,
        }

    def write_dir(self, root: Path, files: dict[str, bytes]) -> Path:
        path = root / "promotion"
        path.mkdir()
        for name, payload in files.items():
            (path / name).write_bytes(payload)
        return path

    def test_check_pins_only_public_trust_in_plan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"; repo.mkdir()
            self.make_repo(repo)
            files = self.make_public_files()
            promotion = self.write_dir(root, files)
            plan = promoter.prepare_repository_promotion(repo, promotion, self.make_verifier(root))
            self.assertTrue(plan["ready"])
            self.assertFalse(plan["profile_content_publish_allowed"])
            self.assertFalse(plan["profile_content_install_allowed"])
            self.assertFalse(plan["profile_content_activation_allowed"])
            self.assertEqual(plan["next_gate"], "first-public-profile-proof")
            policy = json.loads(plan["outputs"]["docs/contracts/profile-content-trust-policy.json"])
            provisioning = json.loads(plan["outputs"]["docs/contracts/profile-provisioning.json"])
            self.assertTrue(policy["public_anchor"]["pinned"])
            self.assertFalse(policy["current_gates"]["profile_content_publish_allowed"])
            self.assertTrue(provisioning["content_proof"]["public_release_trust_pinned"])
            self.assertFalse(provisioning["mvp"]["public_profile_install_enabled"])
            self.assertFalse((repo / "system/trust/profile-content-ed25519.json").exists())

    def test_apply_writes_public_material_but_keeps_product_blocked(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo = root / "repo"; repo.mkdir()
            self.make_repo(repo)
            files = self.make_public_files()
            promotion = self.write_dir(root, files)
            result = promoter.apply_repository_promotion(repo, promotion, self.make_verifier(root))
            self.assertEqual(result["status"], "promoted")
            self.assertFalse(result["profile_content_publish_allowed"])
            self.assertFalse(result["profile_content_install_allowed"])
            self.assertFalse(result["profile_content_activation_allowed"])
            self.assertEqual(
                (repo / "system/trust/profile-content-ed25519.json").read_bytes(),
                files["profile-content-ed25519.json"],
            )

    def test_tampered_hash_and_secret_zip_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = self.make_public_files()
            evidence = json.loads(files["ceremony-public-evidence.json"])
            evidence["proof_content_sha256"] = "f" * 64
            files["ceremony-public-evidence.json"] = json_bytes(evidence)
            promotion = self.write_dir(root, files)
            with self.assertRaises(promoter.PromotionError):
                promoter.validate_public_promotion_directory(promotion, self.make_verifier(root))

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = self.make_public_files()
            files["private.pem"] = b"forbidden\n"
            archive = root / "handoff.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                for name, payload in files.items():
                    bundle.writestr(name, payload)
            output = root / "out"; output.mkdir()
            with self.assertRaises(promoter.PromotionError):
                promoter._materialize_public_handoff_zip(archive, output)


if __name__ == "__main__":
    unittest.main()
