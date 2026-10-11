"""Regression fixtures are synthetic; never treat them as release evidence."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "tools/release-operator/validate_v4_publication_staging.py"
spec = importlib.util.spec_from_file_location("ordax_publication_gate", SOURCE)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
COMMIT = "a" * 40
TAG = "ordax-stable-v4-" + COMMIT


def encoded(value):
    return (json.dumps(value, separators=(",", ":")) + "\n").encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


class StableV4PublicationStagingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ordax-v4-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        self.trust = self.root / "trust.json"
        self.trust.write_bytes(b'{"public":true}\n')
        self.request_file = self.root / "request.json"
        self.receipt_file = self.root / "receipt.json"
        self.parts = {}
        manifest = {
            "$schema": "prototype-ordax.release-manifest/4",
            "source_repository": gate.REPO, "source_commit": COMMIT, "artifacts": [],
        }
        self.urls = {}
        for name in gate.FILES:
            payload = (name + "\n").encode()
            self.parts[name] = payload
            (self.bundle / name).write_bytes(payload)
            url = f"https://github.com/{gate.REPO}/releases/download/{TAG}/{name}"
            self.urls[name] = url
            manifest["artifacts"].append({
                "name": name, "url": url, "sha256": sha(payload), "size": len(payload),
            })
        manifest_bytes = encoded(manifest)
        (self.bundle / "release-manifest.json").write_bytes(manifest_bytes)
        envelope = {
            "$schema": "prototype-ordax.release-envelope/1",
            "payload": base64.b64encode(manifest_bytes).decode(),
            "key_id": "synthetic-not-authorized", "signature": "synthetic",
        }
        envelope_bytes = encoded(envelope)
        (self.bundle / "release-envelope.json").write_bytes(envelope_bytes)
        self.request = {
            "$schema": "prototype-ordax.canonical-v4-signing-request/1",
            "source_repository": gate.REPO, "source_commit": COMMIT,
            "operator_ref": "release-candidate/" + COMMIT,
            "release_tag": TAG, "artifact_urls": dict(self.urls),
            "publication_performed": False, "release_activated": False,
            "physical_target_selected": False, "physical_write_authorized": False,
            "physical_write_performed": False,
        }
        self.receipt = {
            "schema": "prototype-ordax.portable-v4-signed-handoff-verification/1",
            "source_commit": COMMIT, "signature_verified_by_release_agent": True,
            "signed_payload_matches_manifest_bytes": True,
            "local_artifacts_match_signed_manifest": True,
            "release_published": False, "release_activated": False,
            "portable_materialization_performed": False, "physical_target_selected": False,
            "physical_write_authorized_by_this_step": False, "physical_write_performed": False,
            "canonical_trust_sha256": sha(self.trust.read_bytes()),
            "release_manifest_sha256": sha(manifest_bytes),
            "release_envelope_sha256": sha(envelope_bytes),
            "artifacts": {n: {"sha256": sha(b), "size": len(b)} for n, b in self.parts.items()},
        }
        self.store()

    def store(self):
        self.request_file.write_bytes(encoded(self.request))
        self.receipt_file.write_bytes(encoded(self.receipt))

    def validate(self):
        return gate.verified_plan(bundle=self.bundle, request=self.request_file,
                                  receipt=self.receipt_file, trust=self.trust,
                                  source_commit=COMMIT)

    def test_ready_plan_does_not_authorize_publication(self):
        plan = self.validate()
        self.assertEqual(plan["status"], "ready-for-explicit-publication-review")
        self.assertFalse(plan["release_publication_performed"])
        self.assertFalse(plan["physical_write_authorized"])
        self.assertEqual([a["name"] for a in plan["assets"]],
                         ["release-manifest.json", "release-envelope.json", *gate.FILES])

    def test_source_and_artifact_url_are_exact(self):
        self.request["artifact_urls"]["system.erofs"] = "https://wrong.example/system.erofs"
        self.store()
        with self.assertRaisesRegex(gate.AdmissionError, "noncanonical"):
            self.validate()

    def test_corrupt_artifact_rejected(self):
        (self.bundle / "system.erofs").write_bytes(b"tampered")
        with self.assertRaisesRegex(gate.AdmissionError, "artifact differs"):
            self.validate()

    def test_signed_payload_bytes_must_equal_manifest(self):
        path = self.bundle / "release-manifest.json"
        path.write_bytes(path.read_bytes() + b"\n")
        with self.assertRaisesRegex(gate.AdmissionError, "signed payload"):
            self.validate()

    def test_signature_receipt_must_prove_success(self):
        self.receipt["signature_verified_by_release_agent"] = False
        self.store()
        with self.assertRaisesRegex(gate.AdmissionError, "not verified"):
            self.validate()

    def test_unsafe_consent_flags_rejected(self):
        self.request["physical_write_authorized"] = True
        self.store()
        with self.assertRaisesRegex(gate.AdmissionError, "unsafe"):
            self.validate()

    def test_symlink_and_duplicate_json_rejected(self):
        original = self.bundle / "system.erofs"
        original.unlink()
        original.symlink_to(self.trust)
        with self.assertRaisesRegex(gate.AdmissionError, "not a regular"):
            self.validate()
        original.unlink()
        original.write_bytes(self.parts["system.erofs"])
        self.request_file.write_bytes(b'{"source_commit":"X","source_commit":"Y"}')
        with self.assertRaisesRegex(gate.AdmissionError, "duplicate"):
            self.validate()


if __name__ == "__main__":
    unittest.main()
