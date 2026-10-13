"""Patch manifest changes must not rebuild the current Stable/Portable OS."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = (
    "kernel-candidate.yml",
    "stable-base-candidate.yml",
    "dev-base-channel.yml",
    "creator-payload-candidate.yml",
    "native-esp-candidate.yml",
    "kernel-pinned-environment.yml",
    "portable-initramfs-capsule-pin.yml",
    "full-bootstrap-media-proof.yml",
    "creator-owner-dev-git.yml",
    "portable-v2-pinned-initramfs-proof.yml",
    "portable-v2-qemu-boot-proof.yml",
)
EXCLUSIONS = (
    "!bootstrap/kernel/candidates/**",
    "!bootstrap/kernel/candidate_pipeline.py",
    "!bootstrap/kernel/update_engine.py",
)


class KernelCandidateCIScopeTests(unittest.TestCase):
    def test_stable_consumers_exclude_only_candidate_metadata(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow):
                value = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
                lines = value.splitlines()
                for i, line in enumerate(lines):
                    if "bootstrap/kernel/**" not in line or "!bootstrap/kernel" in line:
                        continue
                    # Order matters: GitHub path filters can re-include with later positives.
                    exclusions = "\n".join(lines[i + 1:i + 4])
                    for expected in EXCLUSIONS:
                        self.assertIn(expected, exclusions, (workflow, expected))
                self.assertIn("bootstrap/kernel/**", value)
                self.assertIn("!bootstrap/kernel/candidates/**", value)

    def test_proposed_kernels_have_one_generic_owner(self):
        generic = (ROOT / ".github/workflows/kernel-lts-candidate.yml").read_text(encoding="utf-8")
        self.assertIn("'bootstrap/kernel/candidates/**'", generic)
        self.assertIn("bootstrap/kernel/candidate_pipeline.py", generic)
        self.assertIn("bootstrap/kernel/update_engine.py", generic)
        self.assertNotIn("6.6.158", generic)
        self.assertNotIn("6.6.52", generic)
        self.assertFalse((ROOT / ".github/workflows/kernel-next-6-6-158-candidate.yml").exists())
        self.assertFalse((ROOT / ".github/workflows/kernel-next-upstream-provenance.yml").exists())

    def test_automatic_proposal_never_auto_merges(self):
        scheduled = (ROOT / ".github/workflows/kernel-lts-update-proposal.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", scheduled)
        self.assertIn("schedule:", scheduled)
        self.assertIn("persist-credentials: false", scheduled)
        self.assertIn("actions: write", scheduled)  # required for workflow_dispatch
        self.assertIn("gh workflow run kernel-lts-candidate.yml", scheduled)
        self.assertNotIn("gh pr merge", scheduled)
        self.assertIn('git show "FETCH_HEAD:bootstrap/kernel/candidates/$CANDIDATE_VERSION.json"', scheduled)
        self.assertIn('gh pr list --state all --head "$branch"', scheduled)
        self.assertIn('gh pr create', scheduled)
        # Recovery from branch-only or PR-only publication must dispatch missing
        # exact-head CI without rerunning an existing job or reopening closed PRs.
        self.assertIn('if test "$state" = "OPEN"; then', scheduled)
        self.assertIn('if test "$state" = "CLOSED" || test "$state" = "MERGED"; then', scheduled)
        self.assertIn('gh run list --workflow kernel-lts-candidate.yml', scheduled)
        self.assertIn('select(.headSha ==', scheduled)
        self.assertIn('if test -n "$existing_run"; then', scheduled)
        self.assertIn('gh pr create', scheduled)
        self.assertNotIn("physical_write_allowed: true", scheduled)


if __name__ == "__main__":
    unittest.main()
