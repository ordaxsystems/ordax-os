from pathlib import Path
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "release-pipeline.yml"
AUTHORIZATION = ROOT / "docs" / "contracts" / "physical-write-authorization.json"
VERIFIER_PATH = ROOT / "tools" / "verify" / "current_release_trust.py"

spec = importlib.util.spec_from_file_location("current_release_trust", VERIFIER_PATH)
current_release_trust = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = current_release_trust
spec.loader.exec_module(current_release_trust)


class ReleasePipelinePhysicalStateTests(unittest.TestCase):
    def test_current_repository_passes_single_current_state_verifier(self):
        result = current_release_trust.validate(ROOT)
        authorization = json.loads(AUTHORIZATION.read_text(encoding="utf-8"))

        self.assertEqual(result["status"], "pass")
        self.assertEqual(
            result["currentAuthorizationStatus"],
            "blocked-canonical-v4-release-proof-pending",
        )
        self.assertFalse(result["replacementV4ProofBound"])
        self.assertFalse(result["explicitOwnerAuthorization"])
        self.assertFalse(result["physicalWriteAllowed"])
        self.assertEqual(
            result["historicalV4ProofSha256"],
            authorization["bindings"]["canonical_v4_release_proof_sha256"],
        )

    def test_verifier_fails_closed_if_replacement_proof_is_falsely_marked_bound(self):
        with tempfile.TemporaryDirectory() as raw:
            temp_root = Path(raw)
            for relative in (
                "docs/contracts/release-trust-policy.json",
                "docs/contracts/minimal-bootstrap.json",
                "docs/contracts/physical-write-authorization.json",
                "docs/evidence/canonical-v4-release-proof.json",
                "bootstrap/trust/release-ed25519.json",
            ):
                source = ROOT / relative
                destination = temp_root / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)

            authorization_path = temp_root / "docs/contracts/physical-write-authorization.json"
            authorization = json.loads(authorization_path.read_text(encoding="utf-8"))
            authorization["requirements"]["canonical_v4_release_proof_bound"] = True
            authorization_path.write_text(
                json.dumps(authorization, indent=2) + "\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                current_release_trust.ContractError,
                "replacement canonical v4 proof must not be marked bound",
            ):
                current_release_trust.validate(temp_root)

    def test_release_pipeline_validates_current_state_without_historical_replay(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("python tools/verify/current_release_trust.py", workflow)
        self.assertNotIn("public-trust-promotion-repository", workflow)
        self.assertNotIn("blocked-canonical-trust-pending", workflow)
        self.assertNotIn("promote_public_trust.py", workflow)
        self.assertNotIn("PUBLIC_TRUST_PROMOTION_APPLIED_TO_ISOLATED_COPY", workflow)
        self.assertNotIn("git archive --format=tar HEAD", workflow)

    def test_current_authorization_remains_fail_closed(self):
        authorization = json.loads(AUTHORIZATION.read_text(encoding="utf-8"))
        self.assertEqual(
            authorization["status"],
            "blocked-canonical-v4-release-proof-pending",
        )
        self.assertFalse(authorization["requirements"]["canonical_v4_release_proof_bound"])
        self.assertFalse(authorization["explicit_owner_authorization"])
        self.assertFalse(authorization["physical_write_allowed"])


if __name__ == "__main__":
    unittest.main()
