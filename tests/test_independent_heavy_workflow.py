from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/independent-base-experiment.yml"


class IndependentHeavyWorkflowTests(unittest.TestCase):
    def text(self) -> str:
        return WORKFLOW.read_text(encoding="utf-8")

    def test_owner_profile_is_explicit_and_dispatchable(self) -> None:
        text = self.text()
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("profile:", text)
        self.assertIn("- owner-development", text)
        self.assertIn('PR_HEAD_REF" = platform/remove-alpine', text)
        self.assertIn("profile=owner-development", text)
        self.assertIn("ORDAX_INDEPENDENT_PROFILE", text)

    def test_verified_kernel_precedes_rootfs_consumer_proof_and_qemu(self) -> None:
        text = self.text()
        verify = text.index("- name: Verify kernel component and exact integration binding")
        bind = text.index("- name: Bind verified kernel modules to Independent Base")
        rootfs = text.index("- name: Build rootfs from official Buildroot source")
        consumer = text.index("- name: Prove Owner rootfs against the real Dev Channel consumer")
        qemu = text.index("- name: QEMU real kernel, EROFS and ext4 persistence/recovery")
        self.assertLess(verify, bind)
        self.assertLess(bind, rootfs)
        self.assertLess(rootfs, consumer)
        self.assertLess(consumer, qemu)
        self.assertEqual(text.count("python3 bootstrap/kernel/build.py build"), 1)

    def test_module_binding_uses_exact_canonical_kernel_artifact(self) -> None:
        text = self.text()
        self.assertIn("kernel-modules-$kernel_version.tar", text)
        self.assertIn("ORDAX_KERNEL_MODULES_ARCHIVE", text)
        self.assertIn("ORDAX_KERNEL_MODULES_RECEIPT", text)
        self.assertIn("kernel-module-payload.json", text)
        self.assertIn('python3 -c \'import json; from pathlib import Path;', text)
        self.assertNotIn("<<'PY'", text)

    def test_owner_receipt_paths_are_explicit_and_external(self) -> None:
        text = self.text()
        self.assertIn("ORDAX_KERNEL_MODULES_RECEIPT", text)
        self.assertIn("ORDAX_FIRMWARE_COVERAGE_RECEIPT", text)
        self.assertIn(
            '$RUNNER_TEMP/ordax-independent/kernel-module-payload.json',
            text,
        )
        self.assertIn(
            '$RUNNER_TEMP/ordax-independent/firmware-coverage.json',
            text,
        )

    def test_rootfs_build_and_verify_use_same_profile(self) -> None:
        text = self.text()
        self.assertGreaterEqual(
            text.count('--profile "$ORDAX_INDEPENDENT_PROFILE"'),
            2,
        )

    def test_owner_rootfs_is_proved_by_real_dev_channel_consumer_without_publication(self) -> None:
        text = self.text()
        self.assertIn("tools/dev-base-channel/prove_independent_rootfs.py", text)
        self.assertIn('if: env.ORDAX_INDEPENDENT_PROFILE == \'owner-development\'', text)
        self.assertIn('--rootfs "$RUNNER_TEMP/ordax-independent/rootfs.tar"', text)
        self.assertIn('--provenance "$RUNNER_TEMP/ordax-independent/provenance.json"', text)
        self.assertIn('--expected-commit "$ORDAX_SOURCE_COMMIT"', text)
        self.assertIn("dev-channel-rootfs-compatibility.json", text)
        self.assertNotIn("dev-base-channel/build.py publish", text)
        self.assertNotIn("publish-channel", text)

    def test_evidence_upload_includes_owner_hardware_and_consumer_receipts(self) -> None:
        text = self.text()
        self.assertIn("kernel-module-payload.json", text)
        self.assertIn("firmware-coverage.json", text)
        self.assertIn("dev-channel-rootfs-compatibility.json", text)
        self.assertIn("kernel-component-reuse.json", text)
        self.assertIn("provenance.json", text)
        upload = text[text.index("- name: Upload candidate/provenance and observed QEMU result") :]
        self.assertNotIn("/rootfs.tar", upload)


if __name__ == "__main__":
    unittest.main()
