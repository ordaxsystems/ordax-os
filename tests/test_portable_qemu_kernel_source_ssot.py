"""Portable QEMU/OVMF proof must consume the shared kernel source identity."""

from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml"
SOURCE = ROOT / "bootstrap/kernel/source.json"


class PortableQemuKernelSourceSSOTTests(unittest.TestCase):
    def test_workflow_resolves_version_from_shared_kernel_owner(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Resolve canonical kernel ABI for build artifacts", workflow)
        self.assertIn('python3 bootstrap/kernel/ci_env.py --github-env "$GITHUB_ENV"', workflow)
        self.assertNotIn("6.6.52", workflow)

    def test_all_qemu_and_uefi_artifact_paths_use_canonical_version(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        expected = {
            'vmlinuz-$ORDAX_KERNEL_VERSION': 4,
            'kernel-modules-$ORDAX_KERNEL_VERSION.tar': 2,
            'kernel-$ORDAX_KERNEL_VERSION.config': 3,
        }
        for artifact, count in expected.items():
            self.assertEqual(workflow.count(artifact), count, artifact)
        for step in (
            "Build exact kernel and kernel modules",
            "Build and verify exact Stable Base",
            "Boot portable-v2 candidate PID1 in QEMU",
            "Prove armed candidate one-shot fallback in QEMU",
            "Boot same portable-v2 disk through OVMF and systemd-boot",
        ):
            self.assertIn(step, workflow)

    def test_other_active_workflows_use_the_same_kernel_owner(self):
        workflows = {
            ".github/workflows/native-esp-candidate.yml": {
                'vmlinuz-$ORDAX_KERNEL_VERSION': 2,
            },
            ".github/workflows/stable-base-candidate.yml": {
                'kernel-modules-$ORDAX_KERNEL_VERSION.tar': 2,
            },
            ".github/workflows/portable-v2-pinned-initramfs-proof.yml": {
                'kernel-modules-$ORDAX_KERNEL_VERSION.tar': 2,
            },
        }
        for name, occurrences in workflows.items():
            with self.subTest(workflow=name):
                source = (ROOT / name).read_text(encoding="utf-8")
                self.assertNotIn("6.6.52", source)
                self.assertIn(
                    'python3 bootstrap/kernel/ci_env.py --github-env "$GITHUB_ENV"',
                    source,
                )
                for reference, count in occurrences.items():
                    self.assertEqual(source.count(reference), count, reference)

    def test_kernel_source_version_is_schema_checked_and_derived(self):
        source = json.loads(SOURCE.read_text(encoding="utf-8"))
        self.assertEqual(source["$schema"], "prototype-ordax.kernel-source/1")
        self.assertRegex(source["version"], r"^[0-9]+[.][0-9]+[.][0-9]+$")
        self.assertEqual(
            f"kernel-modules-{source['version']}.tar",
            "kernel-modules-" + source["version"] + ".tar",
        )


if __name__ == "__main__":
    unittest.main()
