"""The OS handoff verifies CI evidence, never installs an unsigned Runtime."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "tools/ci/verify_native_product_candidate.py"
spec = importlib.util.spec_from_file_location("candidate_verifier", SCRIPT)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)

COMMIT = "a" * 40
ELF = b"\x7fELF\x02" + b"\x00" * 13 + b"\x3e\x00" + b"mock-binary"
PROOF = {"ok": True, "network_used": False, "device_credential_used": False,
         "graphical_actions": [], "probes": ["filesystem", "terminal", "supervised-process"],
         "profile": "owner-development-usb"}


class CandidateVerifierTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        root = Path(self.folder.name)
        self.archive = root / "candidate.zip"
        self.lockfile = root / "source.json"
        self.manifest = {
            "schema": "ordax.native-product-runtime-candidate/1",
            "source_repository": "ordaxsystems/ordax-runtime", "source_commit": COMMIT,
            "platform": "linux-amd64-musl", "artifact": "ordax-product-agent",
            "size_bytes": len(ELF), "sha256": hashlib.sha256(ELF).hexdigest(),
            "python_required_on_device": False, "graphical_control_implemented": False,
            "signature_present": False, "installation_authorized_by_candidate": False,
            "stable_activation_authorized": False,
        }
        self.proof = dict(PROOF)
        self.lock = {
            "$schema": "prototype-ordax.studio-runtime-source-lock/1",
            "source": {"commit": COMMIT},
            "candidate_evidence": {
                "kind": "ci-only-unsigned", "source_commit": COMMIT,
                "platform": "linux-amd64-musl", "archive_sha256": "",
                "executable_sha256": hashlib.sha256(ELF).hexdigest(),
                "executable_size_bytes": len(ELF), "offline_proof_verified": True,
                "device_execution_proven": False, "signed_distribution_authorized": False,
                "native_graphical_control_proven": False,
            },
            "distribution": {"runtime_artifact_claimed": False, "runtime_packaged_in_stable": False,
                             "source_binding_only": True},
            "activation": {"dispatch_enabled": False, "requires_signed_runtime_slot": True},
        }
        self.write_fixture()

    def write_fixture(self, extras=None):
        with zipfile.ZipFile(self.archive, "w") as archive:
            archive.writestr("candidate.json", json.dumps(self.manifest))
            archive.writestr("self-test.json", json.dumps(self.proof))
            archive.writestr("ordax-product-agent", ELF)
            archive.writestr("SHA256SUMS", self.manifest["sha256"] + "  ordax-product-agent\n")
            for name, value in (extras or []):
                archive.writestr(name, value)
        self.lock["candidate_evidence"]["archive_sha256"] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.lockfile.write_text(json.dumps(self.lock))

    def verify(self):
        return verifier.verify(self.archive, self.lockfile)

    def test_valid_offline_proof_does_not_activate(self):
        result = self.verify()
        self.assertEqual(result["source_commit"], COMMIT)
        self.assertFalse(result["activation_authorized"])
        self.assertFalse(result["device_execution_proven"])

    def test_tampered_archive_fails_sha(self):
        with self.archive.open("ab") as out:
            out.write(b"tampered")
        with self.assertRaisesRegex(verifier.CandidateError, "archive digest"):
            self.verify()

    def test_mismatched_source_fails_closed_even_with_valid_archive_sha(self):
        self.manifest["source_commit"] = "b" * 40
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "not pinned"):
            self.verify()

    def test_offline_proof_cannot_use_network(self):
        self.proof["network_used"] = True
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "offline execution proof"):
            self.verify()

    def test_unsigned_candidate_cannot_claim_installation_authority(self):
        self.manifest["installation_authorized_by_candidate"] = True
        self.write_fixture()
        with self.assertRaisesRegex(verifier.CandidateError, "signature/activation"):
            self.verify()

    def test_zip_may_not_include_extra_path(self):
        self.write_fixture(extras=[("../../outside", "data")])
        with self.assertRaisesRegex(verifier.CandidateError, "ZIP members"):
            self.verify()

    def test_dispatch_must_remain_off(self):
        self.lock["activation"]["dispatch_enabled"] = True
        self.lockfile.write_text(json.dumps(self.lock))
        with self.assertRaisesRegex(verifier.CandidateError, "activation gates"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
