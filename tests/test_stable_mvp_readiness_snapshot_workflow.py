#!/usr/bin/env python3
"""Guards for read-only, continuously collected Stable/MVP readiness evidence."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/stable-mvp-readiness-snapshot.yml"
DOC = ROOT / "docs/MVP-PRONTIDAO-CONTINUA.md"


class ContinuousReadinessSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.document = DOC.read_text(encoding="utf-8")

    def test_every_main_commit_has_read_only_snapshot_without_release_authority(self):
        workflow = self.workflow
        self.assertIn("  push:\n    branches: [main]", workflow)
        self.assertIn("  workflow_dispatch:", workflow)
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("github.event.pull_request.head.sha || github.sha", workflow)
        self.assertIn("python tools/creator/stable_mvp_usb_readiness.py --repo-root . > out/mvp-readiness/status.json", workflow)
        self.assertIn("stable-mvp-readiness-", workflow)
        self.assertIn("retention-days: 14", workflow)
        self.assertNotIn("--require-authorized-candidate", workflow)
        self.assertNotIn("actions: write", workflow)
        self.assertNotIn("id-token: write", workflow)

    def test_blocked_readiness_is_reported_but_not_silently_promoted(self):
        workflow = self.workflow
        self.assertIn('state.get("status") not in {"blocked", "ready"}', workflow)
        self.assertIn('state.get("stage") == "readiness-evaluation-failed"', workflow)
        self.assertIn('"remaining_gates"', workflow)
        self.assertIn('state.get(key) is not False', workflow)
        for key in (
            "physical_target_selected",
            "target_specific_destructive_confirmation_recorded",
            "writer_invoked",
            "physical_write_performed",
            "physical_proof_completed",
        ):
            self.assertIn(key, workflow)
        self.assertIn("sem autorização de lançamento", workflow)
        self.assertIn("Read-only readiness evidence (not release authorization)", workflow)

    def test_handoff_uses_existing_authoritative_owners_and_allows_optional_evolution(self):
        document = self.document
        for path in (
            "docs/contracts/mvp-app-delivery.json",
            "system/services/apps/mvp-delivery-policy.mjs",
            "tools/creator/stable_mvp_usb_readiness.py",
            "docs/contracts/physical-write-authorization.json",
            "docs/PROMOTION-GATES.md",
            "docs/MVP-PRE-PHYSICAL-HANDOFF.md",
            "docs/contracts/application-compatibility.json",
        ):
            self.assertIn(path, document)
        self.assertIn("Loja completa, Wine", document)
        self.assertIn("rollback", document)
        self.assertIn("commit candidato exato", document)
        self.assertIn("autorização explícita", document)


if __name__ == "__main__":
    unittest.main()
