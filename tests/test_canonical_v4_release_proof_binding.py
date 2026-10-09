#!/usr/bin/env python3
"""Regress the non-destructive binding of the canonical Stable v4 release proof."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "creator" / "bind_canonical_v4_release_proof.py"
spec = importlib.util.spec_from_file_location("ordax_canonical_v4_binding_test", MODULE_PATH)
binding = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(binding)


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class CanonicalV4ReleaseProofBindingTests(unittest.TestCase):
    def fixture(self, root: Path) -> tuple[Path, Path]:
        trust_path = root / "bootstrap/trust/release-ed25519.json"
        write_json(
            trust_path,
            {
                "$schema": "prototype-ordax.release-trust/1",
                "key_id": "ordax-prototype-release-v1",
                "public_key_base64": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            },
        )
        trust_sha = sha256(trust_path)

        auth_path = root / "docs/contracts/physical-write-authorization.json"
        write_json(
            auth_path,
            {
                "$schema": "prototype-ordax.physical-write-authorization/3",
                "status": "blocked-canonical-v4-release-proof-pending",
                "physical_write_allowed": False,
                "explicit_owner_authorization": False,
                "scope": "first-real-stable-mvp-usb-proof",
                "source_repository": "ordaxsystems/ordax-os",
                "release_sequence": 1,
                "authorization_context_sha256": None,
                "bindings": {
                    "minimal_bootstrap_sha256": "8" * 64,
                    "release_trust_sha256": trust_sha,
                    "portable_usb_contract_sha256": "9" * 64,
                    "creator_portable_media_contract_sha256": "a" * 64,
                    "canonical_v4_release_proof_sha256": None,
                },
                "release_binding": {
                    "proof_path": "docs/evidence/canonical-v4-release-proof.json",
                    "proof_schema": "prototype-ordax.portable-v4-canonical-release-proof/1",
                    "source_commit": None,
                    "canonical_envelope_url": None,
                    "release_manifest_sha256": None,
                    "release_envelope_sha256": None,
                },
                "requirements": {"canonical_v4_release_proof_bound": False},
                "consumer_policy": {},
            },
        )

        proof_path = root / "operator" / "canonical-v4-release-proof.json"
        write_json(
            proof_path,
            {
                "schema": "prototype-ordax.portable-v4-canonical-release-proof/1",
                "source_commit": "b" * 40,
                "canonical_envelope_url": "https://releases.ordax.example/stable/v4/release-envelope.json",
                "canonical_trust_sha256": trust_sha,
                "release_manifest_sha256": "1" * 64,
                "release_envelope_sha256": "2" * 64,
                "artifacts": {
                    "system.erofs": {"sha256": "3" * 64, "size": 4096},
                    "native-surface-runtime.erofs": {"sha256": "4" * 64, "size": 8192},
                    "local-ai-runtime.erofs": {"sha256": "5" * 64, "size": 16384},
                },
                "signed_handoff_receipt_sha256": "6" * 64,
                "canonical_materialization_receipt_sha256": "7" * 64,
                "signed_handoff_verified": True,
                "canonical_materialization_verified": True,
                "release_activated": False,
                "physical_target_selected": False,
                "physical_write_authorized": False,
                "physical_write_performed": False,
            },
        )
        return auth_path, proof_path

    def test_binding_copies_only_public_proof_and_keeps_physical_write_disabled(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            auth_path, proof_path = self.fixture(root)

            result = binding.bind(root, proof_path)

            destination = root / "docs/evidence/canonical-v4-release-proof.json"
            self.assertTrue(destination.is_file())
            self.assertEqual(destination.read_bytes(), proof_path.read_bytes())
            contract = json.loads(auth_path.read_text(encoding="utf-8"))
            self.assertEqual(
                contract["status"],
                "blocked-explicit-physical-authorization-pending",
            )
            self.assertFalse(contract["physical_write_allowed"])
            self.assertFalse(contract["explicit_owner_authorization"])
            self.assertIsNone(contract["authorization_context_sha256"])
            self.assertTrue(contract["requirements"]["canonical_v4_release_proof_bound"])
            self.assertEqual(
                contract["bindings"]["canonical_v4_release_proof_sha256"],
                sha256(destination),
            )
            self.assertEqual(contract["release_binding"]["source_commit"], "b" * 40)
            self.assertEqual(
                contract["release_binding"]["canonical_envelope_url"],
                "https://releases.ordax.example/stable/v4/release-envelope.json",
            )
            self.assertEqual(result["status"], "canonical-v4-release-proof-bound")
            self.assertFalse(result["physical_write_authorized"])
            self.assertFalse(result["physical_device_touched"])
            self.assertFalse(result["writer_invoked"])
            self.assertFalse(result["candidate_materialized"])

    def test_rebinding_same_proof_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            auth_path, proof_path = self.fixture(root)

            binding.bind(root, proof_path)
            first_auth = auth_path.read_bytes()
            first_destination = (
                root / "docs/evidence/canonical-v4-release-proof.json"
            ).read_bytes()

            result = binding.bind(root, proof_path)

            self.assertEqual(auth_path.read_bytes(), first_auth)
            self.assertEqual(
                (root / "docs/evidence/canonical-v4-release-proof.json").read_bytes(),
                first_destination,
            )
            self.assertEqual(result["proof_sha256"], hashlib.sha256(first_destination).hexdigest())

    def test_rebinding_different_proof_requires_explicit_reset(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            auth_path, proof_path = self.fixture(root)

            binding.bind(root, proof_path)
            destination = root / "docs/evidence/canonical-v4-release-proof.json"
            before_auth = auth_path.read_bytes()
            before_destination = destination.read_bytes()

            replacement = json.loads(proof_path.read_text(encoding="utf-8"))
            replacement["source_commit"] = "c" * 40
            replacement["release_manifest_sha256"] = "d" * 64
            write_json(proof_path, replacement)

            with self.assertRaisesRegex(binding.BindingError, "already bound to different bytes"):
                binding.bind(root, proof_path)

            self.assertEqual(auth_path.read_bytes(), before_auth)
            self.assertEqual(destination.read_bytes(), before_destination)

    def test_unsafe_proof_is_rejected_without_mutating_authorization(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            auth_path, proof_path = self.fixture(root)
            before = auth_path.read_bytes()
            proof = json.loads(proof_path.read_text(encoding="utf-8"))
            proof["physical_write_authorized"] = True
            write_json(proof_path, proof)

            with self.assertRaisesRegex(binding.BindingError, "unsafe flag"):
                binding.bind(root, proof_path)

            self.assertEqual(auth_path.read_bytes(), before)
            self.assertFalse(
                (root / "docs/evidence/canonical-v4-release-proof.json").exists()
            )

    def test_proof_bound_to_different_trust_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            auth_path, proof_path = self.fixture(root)
            before = auth_path.read_bytes()
            proof = json.loads(proof_path.read_text(encoding="utf-8"))
            proof["canonical_trust_sha256"] = "f" * 64
            write_json(proof_path, proof)

            with self.assertRaisesRegex(binding.BindingError, "pinned public trust"):
                binding.bind(root, proof_path)

            self.assertEqual(auth_path.read_bytes(), before)

    def test_query_or_fragment_in_canonical_url_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            _auth_path, proof_path = self.fixture(root)
            proof = json.loads(proof_path.read_text(encoding="utf-8"))
            proof["canonical_envelope_url"] += "?token=temporary"
            write_json(proof_path, proof)

            with self.assertRaisesRegex(binding.BindingError, "stable public HTTPS"):
                binding.bind(root, proof_path)


if __name__ == "__main__":
    unittest.main()
