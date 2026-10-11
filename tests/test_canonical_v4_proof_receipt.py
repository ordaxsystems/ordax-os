"""Execute the public receipt boundary with fixtures, never private signing keys."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/release-signing/windows/7-Verify-PortableV4-Canonical-Proof.ps1"
SHELLS = [path for name in ("powershell.exe", "pwsh") if (path := shutil.which(name))]


@unittest.skipUnless(SHELLS, "PowerShell is required for receipt execution")
class CanonicalProofReceiptTests(unittest.TestCase):
    def fixture(self, root):
        trust = root / "bootstrap/trust/release-ed25519.json"
        trust.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "bootstrap/trust/release-ed25519.json", trust)
        auth = root / "docs/contracts/physical-write-authorization.json"
        auth.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "docs/contracts/physical-write-authorization.json", auth)
        authorization = json.loads(auth.read_text(encoding="utf-8"))
        authorization["status"] = "blocked-canonical-v4-release-proof-pending"
        authorization["requirements"]["canonical_v4_release_proof_bound"] = False
        authorization["physical_write_allowed"] = False
        authorization["explicit_owner_authorization"] = False
        authorization["authorization_context_sha256"] = None
        authorization["bindings"]["canonical_v4_release_proof_sha256"] = None
        for name in ("source_commit", "canonical_envelope_url", "release_manifest_sha256", "release_envelope_sha256"):
            authorization["release_binding"][name] = None
        auth.write_text(json.dumps(authorization, indent=2) + "\n", encoding="utf-8")
        common = dict(source_commit="b" * 40,
                      canonical_trust_sha256=hashlib.sha256(trust.read_bytes()).hexdigest(),
                      release_manifest_sha256="1" * 64, release_envelope_sha256="2" * 64,
                      release_activated=False, physical_target_selected=False,
                      physical_write_authorized_by_this_step=False, physical_write_performed=False)
        artifacts = {name: {"sha256": str(index) * 64, "size": 4096}
                     for index, name in enumerate(("system.erofs", "native-surface-runtime.erofs",
                                                   "local-ai-runtime.erofs"), start=3)}
        signed = dict(common, schema="prototype-ordax.portable-v4-signed-handoff-verification/1",
                      signature_verified_by_release_agent=True, signed_payload_matches_manifest_bytes=True,
                      local_artifacts_match_signed_manifest=True, release_published=False,
                      portable_materialization_performed=False, artifacts=artifacts)
        material = dict(common, schema="prototype-ordax.portable-v4-canonical-materialization-verification/1",
                        canonical_envelope_url="https://example.com/release-envelope.json",
                        release_agent_materialize_portable_v4=True, release_agent_verify_portable_v4_exact=True,
                        current_pointer_created=False, known_good_pointer_created=False,
                        candidate_created=False, activation_transaction_created=False,
                        artifacts={name: value["sha256"] for name, value in artifacts.items()})
        return trust, signed, material

    def execute(self, shell, root, trust, signed, material):
        for name, data in (("signed.json", signed), ("material.json", material)):
            (root / name).write_text(json.dumps(data), encoding="utf-8")
        return subprocess.run([
            shell, "-NoProfile", "-NonInteractive", "-File", str(SCRIPT),
            "-ExpectedCommit", "b" * 40, "-SignedHandoffReceiptPath", str(root / "signed.json"),
            "-MaterializationReceiptPath", str(root / "material.json"),
            "-TrustPath", str(trust), "-ReceiptPath", str(root / "proof.json"),
        ], capture_output=True, timeout=30,
            env={key: value for key, value in os.environ.items() if key.upper() != "PSMODULEPATH"})

    def test_real_shell_output_binds_without_encoding_rewrite(self):
        spec = importlib.util.spec_from_file_location("receipt_binding", ROOT / "tools/creator/bind_canonical_v4_release_proof.py")
        binding = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(binding)
        for shell in SHELLS:
            with self.subTest(shell=shell), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                trust, signed, material = self.fixture(root)
                signed["artifacts"]["system.erofs"]["size"] = 4294967296
                result = self.execute(shell, root, trust, signed, material)
                self.assertEqual(result.returncode, 0, result.stderr)
                proof = root / "proof.json"
                payload = proof.read_bytes()
                self.assertFalse(payload.startswith(b"\xef\xbb\xbf"), "receipt must be UTF-8 without BOM")
                self.assertNotIn(b"\r", payload, "receipt line endings must be canonical LF")
                bound = binding.bind(root, proof)
                self.assertEqual(bound["proof_sha256"], hashlib.sha256(payload).hexdigest())
                self.assertEqual((root / binding.DESTINATION_PATH).read_bytes(), payload)
                self.assertFalse(bound["physical_write_authorized"])

    def test_malformed_receipt_values_never_produce_proof(self):
        cases = [("release_activated", "False"), ("release_activated", 0),
                 ("signature_verified_by_release_agent", "True"),
                 ("signature_verified_by_release_agent", 1),
                 ("size", True), ("size", "4096"), ("size", 4096.5)]
        for shell in SHELLS:
            for field, value in cases:
                with self.subTest(shell=shell, field=field, value=value), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    trust, signed, material = self.fixture(root)
                    if field == "size":
                        signed["artifacts"]["system.erofs"]["size"] = value
                    else:
                        signed[field] = value
                    result = self.execute(shell, root, trust, signed, material)
                    self.assertNotEqual(result.returncode, 0, "malformed receipt was accepted")
                    self.assertFalse((root / "proof.json").exists())


if __name__ == "__main__":
    unittest.main()
