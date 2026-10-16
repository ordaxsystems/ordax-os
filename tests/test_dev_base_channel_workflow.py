from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/dev-base-channel.yml"


class DevBaseChannelWorkflowTests(unittest.TestCase):
    def workflow(self) -> str:
        return WORKFLOW.read_text(encoding="utf-8")

    def step_block(self, text: str, name: str) -> str:
        marker = f"      - name: {name}\n"
        start = text.index(marker)
        next_step = text.find("\n      - name: ", start + len(marker))
        if next_step < 0:
            next_step = len(text)
        return text[start:next_step]

    def test_publish_uses_independent_owner_rootfs_without_legacy_builder(self):
        workflow = self.workflow()
        build = self.step_block(
            workflow,
            "Build exact-commit development Base and initramfs",
        )
        self.assertIn("bootstrap/independent-base/build.py build", build)
        self.assertIn('--profile owner-development', build)
        self.assertIn("ORDAX_KERNEL_MODULES_ARCHIVE", build)
        self.assertIn("ORDAX_KERNEL_MODULES_RECEIPT", build)
        self.assertIn("ORDAX_FIRMWARE_COVERAGE_RECEIPT", build)
        self.assertIn("tools/dev-base-channel/prove_independent_rootfs.py", build)
        self.assertIn("tools/dev-base-channel/build.py build", build)
        self.assertIn('--rootfs-dir "$independent"', build)
        self.assertIn('cmp -s "$independent/rootfs.tar" out/dev-base/rootfs.tar', build)
        self.assertNotIn("bootstrap/dev-base/build.py", workflow)

    def test_channel_tracks_every_independent_owner_input(self):
        workflow = self.workflow()
        trigger = workflow.split("permissions:", 1)[0]
        for path in (
            "bootstrap/base/firmware_policy.py",
            "bootstrap/base/kernel_module_payload.py",
            "bootstrap/independent-base/**",
            "docs/contracts/hardware-support-matrix.json",
            "tools/dev-base-channel/**",
            "tests/test_dev_base_channel.py",
            "tests/test_dev_base_channel_workflow.py",
        ):
            self.assertIn(f"      - '{path}'", trigger)

    def test_publication_remains_main_only(self):
        workflow = self.workflow()
        publish = workflow.split("  publish:\n", 1)[1]
        self.assertIn(
            "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
            publish,
        )


if __name__ == "__main__":
    unittest.main()
