from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CHANNEL = ROOT / ".github/workflows/dev-base-channel.yml"
EXPERIMENT = ROOT / ".github/workflows/independent-base-experiment.yml"


class DevBaseChannelWorkflowTests(unittest.TestCase):
    def workflow(self) -> str:
        return CHANNEL.read_text(encoding="utf-8")

    def test_dev_channel_keeps_canonical_measured_builder_until_cutover(self) -> None:
        workflow = self.workflow()
        publish = workflow.split("  publish:\n", 1)[1]
        self.assertIn("bootstrap/dev-base/build.py", publish)
        self.assertIn("tools/dev-base-channel/build.py build", publish)
        self.assertIn("--rootfs-dir out/dev-rootfs", publish)
        # A verified QEMU candidate is not permission to change the active
        # Dev producer or the signed release/physical write policy.
        self.assertNotIn("bootstrap/independent-base/build.py build", publish)
        self.assertNotIn("tools/dev-base-channel/prove_independent_rootfs.py", publish)
        self.assertIn("--prerelease", publish)
        self.assertIn("python tools/dev-base-channel/build.py verify", publish)

    def test_independent_owner_candidate_has_separate_real_proof(self) -> None:
        experiment = EXPERIMENT.read_text(encoding="utf-8")
        self.assertIn('if: github.event_name != \'push\'', experiment)
        self.assertIn('if: github.event_name == \'push\'', experiment)
        self.assertIn("bootstrap/independent-base/build.py build", experiment)
        self.assertIn('--profile "$ORDAX_INDEPENDENT_PROFILE"', experiment)
        self.assertIn("ORDAX_KERNEL_MODULES_ARCHIVE", experiment)
        self.assertIn("ORDAX_KERNEL_MODULES_RECEIPT", experiment)
        self.assertIn("ORDAX_FIRMWARE_COVERAGE_RECEIPT", experiment)
        self.assertIn("tools/dev-base-channel/prove_independent_rootfs.py", experiment)
        self.assertIn("QEMU real kernel, EROFS and ext4 persistence/recovery", experiment)
        self.assertIn("ordax-independent-base-", experiment)

    def test_dev_channel_tracks_active_inputs_not_experimental_profile(self) -> None:
        trigger = self.workflow().split("permissions:", 1)[0]
        for path in (
            "bootstrap/kernel/**",
            "bootstrap/initramfs/**",
            "bootstrap/dev-base/**",
            "tools/dev-base-channel/**",
            "tests/test_dev_base_channel.py",
            ".github/workflows/dev-base-channel.yml",
        ):
            self.assertIn(f"      - '{path}'", trigger)
        # Independent Base is gated by its own experiment and QEMU.
        # Do not make the production producer rebuild on every experiment.
        self.assertNotIn("bootstrap/independent-base/**", trigger)

    def test_physical_validation_dispatch_requires_exact_draft_pr(self) -> None:
        workflow = self.workflow()
        self.assertIn("  workflow_dispatch:", workflow)
        self.assertIn("publish_owner_candidate:", workflow)
        self.assertIn("owner_validation_pr:", workflow)
        publish = workflow.split("  publish:\n", 1)[1]
        self.assertIn("github.event_name == 'push' && github.ref == 'refs/heads/main'", publish)
        self.assertIn("inputs.publish_owner_candidate == true", publish)
        self.assertIn("github.actor == 'ordaxos-admin'", publish)
        self.assertIn('test "$(jq -r \'.head.sha\' <<<"$pr_json")" = "$GITHUB_SHA"', publish)
        self.assertIn('test "$(jq -r \'.head.repo.full_name\' <<<"$pr_json")" = "$GITHUB_REPOSITORY"', publish)
        self.assertIn('test "$(jq -r \'.base.ref\' <<<"$pr_json")" = \'main\'', publish)
        self.assertIn('test "$(jq -r \'.draft\' <<<"$pr_json")" = \'true\'', publish)
        self.assertIn("DEV_BASE_OWNER_VALIDATION_EXACT_HEAD=PASS", publish)


if __name__ == "__main__":
    unittest.main()
