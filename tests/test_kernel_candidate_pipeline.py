"""Regression tests for the version-independent LTS candidate lane."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "bootstrap/kernel/candidate_pipeline.py"
spec = importlib.util.spec_from_file_location("ordax_kernel_candidate_pipeline", MODULE)
PIPELINE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(PIPELINE)


class KernelCandidatePipelineTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.candidates = self.root / "bootstrap/kernel/candidates"
        self.candidates.mkdir(parents=True)
        self.active = self.root / "bootstrap/kernel/source.json"
        self.active.write_text(json.dumps({
            "$schema": "prototype-ordax.kernel-source/1", "version": "6.6.52"
        }), encoding="utf-8")
        self.selector = self.candidates / "proposal.json"
        self.contract = self.candidates / "6.6.158.json"
        self.version = "6.6.158"
        self.source = {
            "$schema": "prototype-ordax.kernel-source/1",
            "version": self.version,
            "archive_url": "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.6.158.tar.xz",
            "signature_url": "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.6.158.tar.sign",
            "archive_sha256": "a" * 64,
            "upstream_signature": {
                "algorithm": "openpgp-detached-tar",
                "trusted_primary_fingerprint": "A" * 40,
                "trusted_public_key_url": "https://immutable.example.test/key"
            },
            "build": {
                "pinned_environment_resolved": False,
                "physical_artifact_authorized": False
            }
        }
        self.write()

    def write(self):
        self.contract.write_text(json.dumps(self.source), encoding="utf-8")
        self.selector.write_text(json.dumps({
            "$schema": "prototype-ordax.kernel-candidate-selection/1",
            "source_contract": "bootstrap/kernel/candidates/6.6.158.json"
        }), encoding="utf-8")

    def test_real_selected_candidate_is_newer_than_active(self):
        path, source = PIPELINE.select_candidate()
        self.assertEqual(source["version"], "6.6.158")
        self.assertEqual(path.name, "6.6.158.json")

    def test_derived_identity_has_no_duplicate_version_or_digest(self):
        path, source = PIPELINE.select_candidate(self.root)
        self.assertEqual(path, self.contract)
        self.assertEqual(source["archive_sha256"], "a" * 64)

    def test_old_or_cross_series_candidate_rejected(self):
        for value in ["6.6.52", "6.6.10", "6.12.158", "7.0.0", "6.6.158-rc1"]:
            with self.subTest(version=value):
                self.source["version"] = value
                self.contract.write_text(json.dumps(self.source), encoding="utf-8")
                with self.assertRaises(PIPELINE.CandidateError):
                    PIPELINE.select_candidate(self.root)

    def test_mismatched_upstream_urls_and_hashes_rejected(self):
        for key, invalid in [
            ("archive_url", "https://attacker.invalid/kernel.tar.xz"),
            ("signature_url", "https://attacker.invalid/sign"),
            ("archive_sha256", "not-a-sha256"),
        ]:
            with self.subTest(key=key):
                original = self.source[key]
                self.source[key] = invalid
                self.contract.write_text(json.dumps(self.source), encoding="utf-8")
                with self.assertRaises(PIPELINE.CandidateError):
                    PIPELINE.select_candidate(self.root)
                self.source[key] = original
        self.source["upstream_signature"] = None
        self.contract.write_text(json.dumps(self.source), encoding="utf-8")
        with self.assertRaises(PIPELINE.CandidateError):
            PIPELINE.select_candidate(self.root)

    def test_no_path_traversal_or_symlink(self):
        for relative in ["../../etc/passwd", "bootstrap/kernel/candidates/../source.json",
                         "bootstrap/kernel/candidates/proposal.json", "6.6.158.json"]:
            self.selector.write_text(json.dumps({
                "$schema": PIPELINE.SELECTION_SCHEMA, "source_contract": relative
            }), encoding="utf-8")
            with self.assertRaises(PIPELINE.CandidateError):
                PIPELINE.select_candidate(self.root)
        self.write()
        self.contract.unlink()
        self.contract.symlink_to(self.active)
        with self.assertRaises(PIPELINE.CandidateError):
            PIPELINE.select_candidate(self.root)

    def test_staging_never_bypasses_physical_authorization(self):
        for name in ("physical_artifact_authorized", "pinned_environment_resolved"):
            self.source["build"][name] = True
            self.contract.write_text(json.dumps(self.source), encoding="utf-8")
            with self.assertRaises(PIPELINE.CandidateError):
                PIPELINE.select_candidate(self.root)
            self.source["build"][name] = False

    def proof_fixture(self):
        output = self.root / "staged"
        output.mkdir()
        artifacts = {}
        for name in ("vmlinuz-6.6.158", "kernel-modules-6.6.158.tar", "kernel-6.6.158.config"):
            artifact = output / name
            artifact.write_bytes(name.encode("ascii"))
            artifacts[name] = hashlib.sha256(artifact.read_bytes()).hexdigest()
        source_hash = hashlib.sha256(self.contract.read_bytes()).hexdigest()
        proof = {
            "$schema": PIPELINE.PROVENANCE_SCHEMA,
            "source_commit": "f" * 40,
            "kernel_version": "6.6.158",
            "source_contract_sha256": source_hash,
            "upstream_archive_sha256": "a" * 64,
            "upstream_archive_url": self.source["archive_url"],
            "physical_artifact_authorized": False,
            "promotable_to_physical": False,
            "artifacts": artifacts,
            "upstream_authentication": {
                "$schema": PIPELINE.RECEIPT_SCHEMA,
                "status": "verified",
                "kernel_version": "6.6.158",
                "archive_sha256": "a" * 64,
                "source_contract_sha256": source_hash,
                "trusted_primary_fingerprint": "A" * 40,
                "physical_write_authorized": False
            },
        }
        proof_file = output / "kernel-provenance.json"
        proof_file.write_text(json.dumps(proof), encoding="utf-8")
        return output, proof, proof_file

    def test_proof_checks_actual_artifact_bytes_and_signed_source(self):
        output, proof, proof_file = self.proof_fixture()
        result = PIPELINE.verify_candidate(output, root=self.root, source_commit="f" * 40)
        self.assertEqual(result["status"], "verified")
        self.assertFalse(result["physical_write_authorized"])
        (output / "vmlinuz-6.6.158").write_bytes(b"tampered")
        with self.assertRaises(PIPELINE.CandidateError):
            PIPELINE.verify_candidate(output, root=self.root, source_commit="f" * 40)

    def test_proof_rejects_forged_receipt_and_fake_physical_approval(self):
        output, proof, proof_file = self.proof_fixture()
        proof["upstream_authentication"]["status"] = "failed"
        proof_file.write_text(json.dumps(proof), encoding="utf-8")
        with self.assertRaises(PIPELINE.CandidateError):
            PIPELINE.verify_candidate(output, root=self.root, source_commit="f" * 40)
        proof["upstream_authentication"]["status"] = "verified"
        proof["physical_artifact_authorized"] = True
        proof_file.write_text(json.dumps(proof), encoding="utf-8")
        with self.assertRaises(PIPELINE.CandidateError):
            PIPELINE.verify_candidate(output, root=self.root, source_commit="f" * 40)


if __name__ == "__main__":
    unittest.main()
