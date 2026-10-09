import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "ops" / "branch_hygiene.py"

spec = importlib.util.spec_from_file_location("branch_hygiene", MODULE_PATH)
branch_hygiene = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = branch_hygiene
spec.loader.exec_module(branch_hygiene)


REPO = "ordaxsystems/ordax-os"


def pr(ref, sha, *, merged_at=None, closed_at="2026-09-28T00:00:00Z"):
    return {
        "head": {
            "ref": ref,
            "sha": sha,
            "repo": {"full_name": REPO},
        },
        "merged_at": merged_at,
        "closed_at": closed_at,
        "updated_at": closed_at,
    }


def branch(ref, sha):
    return {"name": ref, "commit": {"sha": sha}}


class FakeApi:
    def __init__(self, current):
        self.current = dict(current)
        self.deleted = []

    def get_branch_sha(self, ref):
        return self.current.get(ref)

    def delete_branch(self, ref):
        if ref not in self.current:
            return False
        self.deleted.append(ref)
        del self.current[ref]
        return True


class BranchHygieneTests(unittest.TestCase):
    def test_planner_selects_each_branch_once_with_rule_precedence(self):
        open_prs = []
        closed_prs = [
            pr("merged", "a" * 40, merged_at="2026-09-28T01:00:00Z"),
            pr("abandoned", "b" * 40),
        ]
        branches = [
            branch("main", "0" * 40),
            branch("merged", "a" * 40),
            branch("abandoned", "b" * 40),
            branch("feature/contained", "c" * 40),
        ]
        compared = []

        def ahead(ref, expected_sha):
            compared.append((ref, expected_sha))
            return 0

        candidates = branch_hygiene.plan_deletions(
            REPO,
            open_prs,
            closed_prs,
            branches,
            ahead,
        )
        by_ref = {candidate.ref: candidate for candidate in candidates}

        self.assertEqual(set(by_ref), {"merged", "abandoned", "feature/contained"})
        self.assertEqual(by_ref["merged"].reason, "merged-head-unchanged")
        self.assertEqual(by_ref["abandoned"].reason, "closed-unmerged-head-unchanged")
        self.assertEqual(by_ref["feature/contained"].reason, "fully-contained-in-main")
        self.assertEqual(compared, [("feature/contained", "c" * 40)])
        self.assertEqual(len(candidates), len(set(by_ref)))

    def test_open_pr_and_protected_branches_are_never_candidates(self):
        open_prs = [pr("active", "d" * 40)]
        branches = [
            branch("main", "0" * 40),
            branch("ordax-rescue", "1" * 40),
            branch("active", "d" * 40),
        ]
        candidates = branch_hygiene.plan_deletions(
            REPO,
            open_prs,
            [],
            branches,
            lambda _ref, _sha: 0,
        )
        self.assertEqual(candidates, [])

    def test_exact_frozen_release_ref_survives_containment_but_lookalikes_do_not(self):
        sha = "a" * 40
        protected = "release-candidate/" + sha
        lookalikes = [
            protected + "-suffix",
            "release-candidate/" + sha.upper(),
            "release-candidate/not-a-sha",
            "feature/contained",
        ]
        candidates = branch_hygiene.plan_deletions(
            REPO, [], [],
            [branch(protected, sha)] + [branch(name, sha) for name in lookalikes],
            lambda _ref, _sha: 0,
        )
        self.assertEqual({item.ref for item in candidates}, set(lookalikes))
        self.assertTrue(branch_hygiene.is_protected_ref(protected, sha))
        self.assertTrue(all(not branch_hygiene.is_protected_ref(ref, sha) for ref in lookalikes))

    def test_candidate_name_with_mismatched_target_sha_remains_deletable(self):
        sha = "a" * 40
        ref = "release-candidate/" + sha
        self.assertFalse(branch_hygiene.is_protected_ref(ref, "b" * 40))
        candidates = branch_hygiene.plan_deletions(
            REPO, [], [], [branch(ref, "b" * 40)], lambda _ref, _sha: 0,
        )
        self.assertEqual([item.ref for item in candidates], [ref])

    def test_exact_release_candidate_head_is_exempt_from_merged_branch_deletion(self):
        from unittest import mock

        sha = "a" * 40
        with mock.patch.object(branch_hygiene, "GitHubApi") as api:
            self.assertEqual(
                branch_hygiene.delete_merged_head(
                    REPO, "release-candidate/" + sha, sha
                ),
                0,
            )
            api.assert_not_called()

    def test_changed_branch_is_preserved_at_delete_boundary(self):
        candidate = branch_hygiene.DeleteCandidate(
            ref="feature",
            expected_sha="a" * 40,
            reason="fully-contained-in-main",
        )
        api = FakeApi({"feature": "b" * 40})
        summary = branch_hygiene.apply_candidates(api, [candidate])

        self.assertEqual(api.deleted, [])
        self.assertEqual(summary, {"deleted": 0, "already_absent": 0, "changed": 1})

    def test_absent_branch_is_an_explicit_idempotent_noop(self):
        candidate = branch_hygiene.DeleteCandidate(
            ref="gone",
            expected_sha="a" * 40,
            reason="merged-head-unchanged",
        )
        api = FakeApi({})
        summary = branch_hygiene.apply_candidates(api, [candidate])

        self.assertEqual(api.deleted, [])
        self.assertEqual(summary, {"deleted": 0, "already_absent": 1, "changed": 0})

    def test_workflow_uses_single_pruner_and_no_error_masking(self):
        workflow = (ROOT / ".github" / "workflows" / "branch-hygiene.yml").read_text(encoding="utf-8")
        self.assertIn("python tools/ops/branch_hygiene.py prune", workflow)
        self.assertIn("python tools/ops/branch_hygiene.py delete-merged-head", workflow)
        self.assertNotIn("prune-existing-merged-heads", workflow)
        self.assertNotIn("prune-closed-unmerged-heads", workflow)
        self.assertNotIn("prune-fully-contained-heads", workflow)
        self.assertNotIn("continue-on-error", workflow)
        self.assertNotIn("|| true", workflow)


if __name__ == "__main__":
    unittest.main()
