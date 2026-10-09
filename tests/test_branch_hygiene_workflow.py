#!/usr/bin/env python3
"""Regress the automatic branch-hygiene safety boundary."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "branch-hygiene.yml"
IMPLEMENTATION = ROOT / "tools" / "ops" / "branch_hygiene.py"


class BranchHygieneWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.implementation = IMPLEMENTATION.read_text(encoding="utf-8")

    def test_main_push_always_runs_general_prune(self):
        trigger = self.workflow.split("on:", 1)[1].split("permissions:", 1)[0]
        self.assertIn("push:\n    branches:\n      - main", trigger)
        self.assertNotIn("paths:", trigger)
        self.assertIn(
            "if: github.event_name == 'workflow_dispatch' || github.event_name == 'push'",
            self.workflow,
        )
        self.assertIn(
            'python tools/ops/branch_hygiene.py prune --repository "$REPOSITORY"',
            self.workflow,
        )

    def test_cleanup_is_single_process_and_workflow_runs_are_serialized(self):
        self.assertIn("group: branch-hygiene", self.workflow)
        self.assertIn("cancel-in-progress: false", self.workflow)
        self.assertIn("  prune-branches:\n", self.workflow)
        self.assertNotIn("prune-existing-merged-heads", self.workflow)
        self.assertNotIn("prune-closed-unmerged-heads", self.workflow)
        self.assertNotIn("prune-fully-contained-heads", self.workflow)
        self.assertIn("Return each deletable branch at most once", self.implementation)

    def test_protected_and_open_pr_heads_are_preserved(self):
        self.assertIn(
            'PROTECTED_BRANCHES = frozenset({"main", "ordax-rescue"})',
            self.implementation,
        )
        self.assertIn(
            "preserve = {ref for ref in current if is_protected_ref(ref, current[ref])} | open_heads",
            self.implementation,
        )
        self.assertIn(
            'ref == f"release-candidate/{source_sha}"',
            self.implementation,
        )
        self.assertIn(
            'if is_protected_ref(head_ref, merged_head_sha):',
            self.implementation,
        )

    def test_merged_head_is_deleted_only_if_unchanged(self):
        self.assertIn(
            'python tools/ops/branch_hygiene.py delete-merged-head',
            self.workflow,
        )
        self.assertIn(
            'current_sha = api.get_branch_sha(head_ref)',
            self.implementation,
        )
        self.assertIn(
            'if current_sha != merged_head_sha:',
            self.implementation,
        )
        self.assertIn(
            'print(f"Preserving {head_ref}: branch changed after merged PR")',
            self.implementation,
        )

    def test_closed_unmerged_prune_requires_exact_closed_head_and_no_open_pr(self):
        self.assertIn(
            "latest_unmerged = _latest_pr_by_ref(closed_prs, repository, merged=False)",
            self.implementation,
        )
        self.assertIn(
            "if ref in preserve or ref not in current or ref in selected:",
            self.implementation,
        )
        self.assertIn(
            'expected_sha = pr["head"]["sha"]',
            self.implementation,
        )
        self.assertIn(
            'if current[ref] == expected_sha:',
            self.implementation,
        )
        self.assertIn(
            'DeleteCandidate(ref, expected_sha, "closed-unmerged-head-unchanged")',
            self.implementation,
        )

    def test_general_prune_binds_containment_to_snapshot_sha(self):
        self.assertIn(
            "for ref, expected_sha in sorted(current.items()):",
            self.implementation,
        )
        self.assertIn(
            "if compare_ahead_by(ref, expected_sha) == 0:",
            self.implementation,
        )
        self.assertIn(
            'f"repos/{self.repository}/compare/main...{expected_sha}"',
            self.implementation,
        )
        self.assertIn(
            'DeleteCandidate(ref, expected_sha, "fully-contained-in-main")',
            self.implementation,
        )

    def test_destructive_delete_revalidates_sha_and_only_absence_is_idempotent(self):
        self.assertIn(
            "current_sha = api.get_branch_sha(candidate.ref)",
            self.implementation,
        )
        self.assertIn(
            "if current_sha != candidate.expected_sha:",
            self.implementation,
        )
        self.assertIn(
            'if "Reference does not exist" in result.stderr:',
            self.implementation,
        )
        self.assertIn(
            'self._raise(result, f"delete branch {ref}")',
            self.implementation,
        )
        self.assertNotIn("continue-on-error", self.workflow)
        self.assertNotIn("|| true", self.workflow)


if __name__ == "__main__":
    unittest.main()
