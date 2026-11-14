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
MODULE_ARCHIVE_NON_CONSUMERS = (
    "kernel-candidate.yml",
    "dev-base-channel.yml",
    "creator-payload-candidate.yml",
    "native-esp-candidate.yml",
    "kernel-pinned-environment.yml",
    "portable-initramfs-capsule-pin.yml",
    "full-bootstrap-media-proof.yml",
)
MODULE_ARCHIVE_FINGERPRINT_CONSUMERS = (
    "stable-base-candidate.yml",
    "portable-v2-pinned-initramfs-proof.yml",
)


class KernelCandidateCIScopeTests(unittest.TestCase):
    def test_test_only_kernel_changes_are_covered_without_rebuilding(self):
        # Foundation is an unconditional PR/main-push owner for Python
        # regressions. A change to a test cannot alter kernel build bytes.
        foundation = (
            ROOT / ".github/workflows/foundation.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("  push:\n    branches: [main]", foundation)
        self.assertIn("  pull_request:\n", foundation)
        self.assertIn("python -m unittest discover -s tests -p 'test_*.py' -v", foundation)
        self.assertIn("if: steps.impact.outputs.full != 'false'", foundation)
        for workflow, test_paths, source_path in (
            (
                "kernel-candidate.yml",
                ("tests/test_kernel_artifact_verifier.py",
                 "tests/test_kernel_build_authentication_gate.py"),
                "bootstrap/kernel/**",
            ),
            (
                "kernel-pinned-environment.yml",
                ("tests/test_kernel_build_environment_contract.py",
                 "tests/test_kernel_reproducibility_ssot.py"),
                "docs/contracts/kernel-build-environment.json",
            ),
        ):
            source = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
            trigger = source.split("\njobs:\n", 1)[0]
            with self.subTest(workflow=workflow):
                for path in test_paths:
                    self.assertNotIn(path, trigger)
                self.assertEqual(trigger.count(source_path), 2)
                self.assertIn(f".github/workflows/{workflow}", trigger)
                self.assertIn("workflow_dispatch:", trigger)
                self.assertIn("github.event_name != 'pull_request' || !github.event.pull_request.draft",
                              source)
                self.assertIn("actions/upload-artifact@", source)

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

    def test_module_archive_helper_does_not_trigger_unrelated_heavy_producers(self):
        exclusion = "!bootstrap/kernel/module_archive.py"
        for workflow in MODULE_ARCHIVE_NON_CONSUMERS:
            with self.subTest(workflow=workflow):
                value = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
                self.assertEqual(value.count(exclusion), 2, workflow)

    def test_module_archive_fingerprint_consumers_trigger_on_helper_changes(self):
        exclusion = "!bootstrap/kernel/module_archive.py"
        fingerprint = "hashFiles('bootstrap/kernel/module_archive.py'"
        for workflow in MODULE_ARCHIVE_FINGERPRINT_CONSUMERS:
            with self.subTest(workflow=workflow):
                value = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
                self.assertEqual(value.count(exclusion), 0, workflow)
                self.assertGreaterEqual(value.count(fingerprint), 1, workflow)

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
