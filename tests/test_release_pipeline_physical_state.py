from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "release-pipeline.yml"
AUTHORIZATION = ROOT / "docs" / "contracts" / "physical-write-authorization.json"


class ReleasePipelinePhysicalStateTests(unittest.TestCase):
    def test_pipeline_tracks_current_fail_closed_replacement_proof_state(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        authorization = json.loads(AUTHORIZATION.read_text(encoding="utf-8"))

        self.assertEqual(
            authorization["status"],
            "blocked-canonical-v4-release-proof-pending",
        )
        self.assertFalse(authorization["requirements"]["canonical_v4_release_proof_bound"])
        self.assertFalse(authorization["explicit_owner_authorization"])
        self.assertFalse(authorization["physical_write_allowed"])

        self.assertIn(
            "assert authorization['status'] == 'blocked-canonical-v4-release-proof-pending'",
            workflow,
        )
        self.assertIn(
            "assert authorization['requirements']['canonical_v4_release_proof_bound'] is False",
            workflow,
        )
        self.assertIn(
            "CANONICAL_V4_RELEASE_PROOF=PENDING_POST_HARDENING_REPLACEMENT",
            workflow,
        )
        self.assertNotIn(
            "assert authorization['status'] == 'blocked-explicit-physical-authorization-pending'",
            workflow,
        )
        self.assertNotIn(
            "CANONICAL_V4_RELEASE_PROOF=PASS_BOUND_VERSIONED_PRERELEASE",
            workflow,
        )

    def test_pipeline_retains_historical_proof_identity_without_rebinding_it(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        authorization = json.loads(AUTHORIZATION.read_text(encoding="utf-8"))

        historical_sha = authorization["bindings"]["canonical_v4_release_proof_sha256"]
        historical_source = authorization["release_binding"]["source_commit"]
        self.assertEqual(len(historical_sha), 64)
        self.assertEqual(len(historical_source), 40)
        self.assertIn(historical_sha, workflow)
        self.assertIn(historical_source, workflow)
        self.assertIn("physical_write_allowed'] is False", workflow)
        self.assertIn("explicit_owner_authorization'] is False", workflow)


if __name__ == "__main__":
    unittest.main()
