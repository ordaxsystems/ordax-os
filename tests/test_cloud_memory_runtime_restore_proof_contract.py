#!/usr/bin/env python3
"""Regression guards for the Cloud Memory runtime restore proof boundary."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "cloud-memory-runtime-restore-proof.json"
BACKEND_PROOF = ROOT / "tools" / "cloud-memory" / "prove_authenticated_atomic_sync.py"
OPERATOR_RUNNER = ROOT / "tools" / "cloud-memory" / "run_operator_authenticated_proof.py"
NATIVE_ACCOUNT_SYNC = ROOT / "system" / "composition" / "native" / "account-sync.mjs"
NATIVE_ACCOUNT_MEMORY = ROOT / "system" / "composition" / "native" / "account-memory-foundation.mjs"


class CloudMemoryRuntimeRestoreProofContractTests(unittest.TestCase):
    def test_backend_two_session_proof_cannot_be_misclassified_as_native_reinstall(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        backend = contract["evidenceClasses"]["backendTwoSession"]
        native_restore = contract["evidenceClasses"]["nativeFreshInstallRestore"]

        self.assertTrue(backend["required"])
        self.assertTrue(native_restore["required"])
        self.assertEqual(native_restore["status"], "required-not-proven")
        self.assertFalse(contract["publicCloudMemoryPromoted"])
        self.assertIn(
            "Backend two-session success alone must never be interpreted as Native reinstall success.",
            contract["completionRule"],
        )
        self.assertIn("Native composition execution", backend["doesNotProve"])
        self.assertIn(
            "fresh-install restore through createNativeAccountSyncRuntime",
            backend["doesNotProve"],
        )

    def test_native_restore_evidence_requires_real_composition_and_checkpoint_ordering(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        required = set(contract["evidenceClasses"]["nativeFreshInstallRestore"]["mustExercise"])
        fail_closed = set(contract["evidenceClasses"]["nativeFreshInstallRestore"]["mustFailClosedWhen"])

        self.assertIn("createNativeAccountMemoryFoundation", required)
        self.assertIn("createNativeAccountSyncRuntime", required)
        self.assertIn("empty local account checkpoint", required)
        self.assertIn("Memory persistence before checkpoint advancement", required)
        self.assertIn("fresh checkpoint bound to the authenticated subject and remote cursor", required)
        self.assertIn("entitlement is denied, unresolved or expired", fail_closed)
        self.assertIn("remote Memory is non-portable", fail_closed)
        self.assertIn("Memory persistence cannot confirm durability", fail_closed)
        self.assertIn("coordination state requires recovery", fail_closed)

        self.assertIn("createNativeAccountSyncRuntime", NATIVE_ACCOUNT_SYNC.read_text(encoding="utf-8"))
        self.assertIn("createNativeAccountMemoryFoundation", NATIVE_ACCOUNT_MEMORY.read_text(encoding="utf-8"))

    def test_current_operator_backend_proof_does_not_claim_native_runtime_execution(self):
        proof = BACKEND_PROOF.read_text(encoding="utf-8")
        runner = OPERATOR_RUNNER.read_text(encoding="utf-8")
        combined = f"{proof}\n{runner}"

        self.assertIn("two-client", combined)
        self.assertIn("SupabaseMemoryProvider", proof)
        self.assertIn("SupabaseSyncProvider", proof)
        self.assertNotIn("createNativeAccountSyncRuntime", combined)
        self.assertNotIn("createNativeAccountMemoryFoundation", combined)
        self.assertNotIn("system/composition/native", combined)


if __name__ == "__main__":
    unittest.main()
