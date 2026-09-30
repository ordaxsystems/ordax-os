#!/usr/bin/env python3
"""Source guards for the operator-managed authenticated cloud Memory proof."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "cloud-memory-operator-authenticated-proof.yml"
RUNNER = ROOT / "tools" / "cloud-memory" / "run_operator_authenticated_proof.py"
VALIDATOR = ROOT / "tools" / "cloud-memory" / "validate_authenticated_proof_receipt.py"
BIDIRECTIONAL_VALIDATOR = ROOT / "tools" / "cloud-memory" / "validate_bidirectional_restore_receipt.py"
CONTRACT = ROOT / "docs" / "contracts" / "cloud-memory-sync-boundary.json"


class CloudMemoryOperatorProofWorkflowTests(unittest.TestCase):
    def test_workflow_is_manual_serialized_and_exact_source_bound(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", text)
        self.assertNotIn("pull_request:", text)
        self.assertNotIn("push:", text)
        self.assertIn("group: cloud-memory-operator-authenticated-proof", text)
        self.assertIn("cancel-in-progress: false", text)
        self.assertIn("if: github.ref == 'refs/heads/main'", text)
        self.assertIn("ORDAX_MEMORY_PROOF_SOURCE_COMMIT: ${{ github.sha }}", text)
        self.assertIn('test "${GITHUB_REF}" = \'refs/heads/main\'', text)
        self.assertIn('test "${GITHUB_SHA}" = "${ORDAX_MEMORY_PROOF_SOURCE_COMMIT}"', text)
        self.assertIn('test "${ORDAX_MEMORY_PROOF_SOURCE_COMMIT}" = "${GITHUB_SHA}"', text)
        self.assertIn("CLOUD_MEMORY_OPERATOR_PROOF_REF=MAIN_ONLY", text)
        self.assertIn("persist-credentials: false", text)

    def test_workflow_requires_operator_and_account_secrets_without_service_role(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        for secret in (
            "ORDAX_SUPABASE_URL",
            "ORDAX_SUPABASE_PUBLISHABLE_KEY",
            "ORDAX_MEMORY_PROOF_ACCOUNT_EMAIL",
            "ORDAX_MEMORY_PROOF_ACCOUNT_PASSWORD",
            "ORDAX_MEMORY_PROOF_PGHOST",
            "ORDAX_MEMORY_PROOF_PGDATABASE",
            "ORDAX_MEMORY_PROOF_PGUSER",
            "ORDAX_MEMORY_PROOF_PGPASSWORD",
        ):
            self.assertIn(f"secrets.{secret}", text)
        self.assertIn("PGSSLMODE: require", text)
        self.assertIn("command -v psql", text)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", text)
        self.assertNotIn("service_role", text.lower())
        self.assertNotIn('echo "$PGPASSWORD"', text)
        self.assertNotIn('echo "$ORDAX_MEMORY_PROOF_ACCOUNT_PASSWORD"', text)

    def test_workflow_uses_one_runner_and_two_sanitized_receipt_contracts(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("run_operator_authenticated_proof.py", text)
        self.assertIn("validate_authenticated_proof_receipt.py", text)
        self.assertIn("validate_bidirectional_restore_receipt.py", text)
        self.assertIn("cloud-memory-authenticated-proof.json", text)
        self.assertIn("cloud-memory-bidirectional-restore-proof.json", text)
        self.assertIn("retention-days: 14", text)
        self.assertNotIn("ordax_issue_cloud_memory_proof_entitlement_v1", text)
        self.assertNotIn("ordax_revoke_cloud_memory_proof_entitlement_v1", text)

    def test_runner_owns_single_issue_both_proofs_and_finally_revoke(self):
        text = RUNNER.read_text(encoding="utf-8")
        self.assertEqual(text.count("grant_id = issue_grant("), 1)
        self.assertIn("prove_authenticated_atomic_sync.py", text)
        self.assertIn("prove_authenticated_bidirectional_restore.py", text)
        first = text.index('"prove_authenticated_atomic_sync.py"')
        second = text.index('"prove_authenticated_bidirectional_restore.py"')
        self.assertLess(first, second)
        self.assertIn("finally:", text)
        finally_body = text[text.index("finally:"):]
        self.assertIn("revoke_grant(", finally_body)
        self.assertIn("CLOUD_MEMORY_OPERATOR_ENTITLEMENT=REVOKED", finally_body)
        self.assertIn("PGSSLMODE", text)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", text)

    def test_both_validators_are_secret_averse(self):
        text = VALIDATOR.read_text(encoding="utf-8")
        for key in (
            '"password"',
            '"access_token"',
            '"refresh_token"',
            '"cookie"',
            '"memory_id"',
            '"subject_id"',
            '"account_email"',
        ):
            self.assertIn(key, text)
        self.assertIn("CLOUD_MEMORY_AUTHENTICATED_RECEIPT=PASS_SANITIZED", text)
        self.assertNotIn("service_role_used\": True", text)

        bidirectional = BIDIRECTIONAL_VALIDATOR.read_text(encoding="utf-8")
        self.assertIn("ALLOWED_KEYS", bidirectional)
        self.assertIn("REQUIRED_TRUE", bidirectional)
        self.assertIn("REQUIRED_FALSE", bidirectional)
        self.assertIn("CLOUD_MEMORY_BIDIRECTIONAL_RECEIPT=PASS", bidirectional)
        self.assertNotIn("SUPABASE_SERVICE_ROLE", bidirectional)

    def test_contract_records_workflow_readiness_without_claiming_execution(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertFalse(contract["public_mvp_enabled"])
        self.assertFalse(contract["implementation"]["public_rollout_enabled"])
        authenticated = contract["implementation"]["authenticated_proof"]
        self.assertEqual(authenticated["status"], "two-client-source-ready-execution-pending")
        self.assertTrue(authenticated["requires_preprovisioned_entitlement"])
        self.assertFalse(authenticated["creates_entitlement"])
        operator = contract["implementation"]["operator_proof_runner"]
        self.assertEqual(operator["status"], "workflow-ready-not-executed")
        self.assertEqual(
            operator["workflow"],
            ".github/workflows/cloud-memory-operator-authenticated-proof.yml",
        )
        self.assertTrue(operator["workflow_dispatch_only"])
        self.assertTrue(operator["default_branch_only"])
        self.assertEqual(operator["required_git_ref"], "refs/heads/main")
        self.assertTrue(operator["serial_execution"])
        self.assertTrue(operator["issue_then_proof_then_revoke"])
        self.assertTrue(operator["revoke_in_finally"])
        self.assertFalse(operator["service_role_allowed"])
        self.assertFalse(operator["backend_mutation_on_source_merge"])


if __name__ == "__main__":
    unittest.main()
