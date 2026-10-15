import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/independent-base-experiment.yml"
POST_BUILD = ROOT / "bootstrap/independent-base/post-build.sh"
PARITY_PATH = ROOT / "bootstrap/independent-base/module_parity.py"
PARITY_SPEC = importlib.util.spec_from_file_location("ordax_independent_module_parity_contract", PARITY_PATH)
assert PARITY_SPEC and PARITY_SPEC.loader
PARITY = importlib.util.module_from_spec(PARITY_SPEC)
PARITY_SPEC.loader.exec_module(PARITY)


class IndependentKernelModuleWorkflowTests(unittest.TestCase):
    def workflow(self) -> str:
        return WORKFLOW.read_text(encoding="utf-8")

    def step_block(self, text: str, name: str) -> str:
        marker = f"      - name: {name}\n"
        start = text.index(marker)
        next_step = text.find("\n      - name: ", start + len(marker))
        if next_step < 0:
            next_step = len(text)
        return text[start:next_step]

    def test_verified_kernel_precedes_rootfs_module_consumption(self):
        workflow = self.workflow()
        restore = workflow.index("      - name: Restore verified kernel component\n")
        build_kernel = workflow.index("      - name: Build canonical OrdaX kernel on verified cache miss\n")
        verify_kernel = workflow.index("      - name: Verify kernel component and exact integration binding\n")
        build_rootfs = workflow.index(
            "      - name: Build rootfs from official Buildroot source with verified kernel modules\n"
        )
        qemu = workflow.index("      - name: QEMU real kernel, EROFS and ext4 persistence/recovery\n")
        self.assertLess(restore, build_kernel)
        self.assertLess(build_kernel, verify_kernel)
        self.assertLess(verify_kernel, build_rootfs)
        self.assertLess(build_rootfs, qemu)

    def test_module_inputs_are_canonical_causal_and_not_hardcoded(self):
        workflow = self.workflow()
        self.assertIn("      - 'bootstrap/kernel/module_archive.py'", workflow)
        self.assertIn("      - 'docs/contracts/hardware-support-matrix.json'", workflow)
        self.assertEqual(workflow.count("      - '!bootstrap/independent-base/**/*.md'"), 1)
        rootfs = self.step_block(
            workflow,
            "Build rootfs from official Buildroot source with verified kernel modules",
        )
        self.assertNotIn("if: steps.kernel-cache", rootfs)
        self.assertIn('module_archive="$kernel_dir/kernel-modules-$kernel_version.tar"', rootfs)
        self.assertNotIn("kernel-modules-6.6.", rootfs)
        self.assertIn('export ORDAX_HOST_PYTHON="$(command -v python3)"', rootfs)
        self.assertIn('export ORDAX_KERNEL_MODULES_ARCHIVE="$module_archive"', rootfs)
        self.assertIn('export ORDAX_KERNEL_MODULES_RECEIPT="$base_out/kernel-module-selection.json"', rootfs)
        self.assertIn("bootstrap/independent-base/module_parity.py verify", rootfs)
        self.assertIn('--base-provenance "$base_out/provenance.json"', rootfs)
        self.assertIn('--out "$base_out/kernel-module-parity.json"', rootfs)

    def test_module_receipts_are_uploaded_and_physical_claim_stays_forbidden(self):
        workflow = self.workflow()
        upload = self.step_block(workflow, "Upload candidate/provenance and observed QEMU result")
        self.assertIn("kernel-module-selection.json", upload)
        self.assertIn("kernel-module-parity.json", upload)
        post_build = POST_BUILD.read_text(encoding="utf-8")
        for variable in (
            "ORDAX_HOST_PYTHON",
            "ORDAX_KERNEL_MODULES_ARCHIVE",
            "ORDAX_KERNEL_MODULES_RECEIPT",
        ):
            self.assertIn(f'${{{variable}:?', post_build)
        self.assertIn("bootstrap/kernel/module_archive.py", post_build)
        self.assertNotIn("alpine_core", post_build)
        self.assertNotIn(" apk ", post_build)

    def test_parity_receipt_binds_same_rootfs_as_base_provenance(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            rootfs = root / "rootfs.tar"
            rootfs.write_bytes(b"rootfs bytes\n")
            rootfs_sha = hashlib.sha256(rootfs.read_bytes()).hexdigest()
            provenance = root / "provenance.json"
            provenance.write_text(
                json.dumps(
                    {
                        "$schema": PARITY.BASE_PROVENANCE_SCHEMA,
                        "physical_artifact_authorized": False,
                        "kernel_source_version": "6.6.158",
                        "source_commit": "a" * 40,
                        "artifacts": {"rootfs.tar": rootfs_sha},
                    }
                ),
                encoding="utf-8",
            )
            result = {
                "$schema": PARITY.SCHEMA,
                "kernel_release": "6.6.158",
                "rootfs_tar_sha256": rootfs_sha,
                "physical_support_claimed": False,
            }
            bound = PARITY.bind_base_provenance(
                result,
                base_provenance=provenance,
                rootfs_tar=rootfs,
            )
            self.assertEqual(bound["base_rootfs_tar_sha256"], rootfs_sha)
            self.assertEqual(bound["base_source_commit"], "a" * 40)
            self.assertEqual(len(bound["base_provenance_sha256"]), 64)

    def test_base_provenance_digest_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            rootfs = root / "rootfs.tar"
            rootfs.write_bytes(b"rootfs bytes\n")
            rootfs_sha = hashlib.sha256(rootfs.read_bytes()).hexdigest()
            provenance = root / "provenance.json"
            provenance.write_text(
                json.dumps(
                    {
                        "$schema": PARITY.BASE_PROVENANCE_SCHEMA,
                        "physical_artifact_authorized": False,
                        "kernel_source_version": "6.6.158",
                        "source_commit": "b" * 40,
                        "artifacts": {"rootfs.tar": "0" * 64},
                    }
                ),
                encoding="utf-8",
            )
            result = {
                "$schema": PARITY.SCHEMA,
                "kernel_release": "6.6.158",
                "rootfs_tar_sha256": rootfs_sha,
                "physical_support_claimed": False,
            }
            with self.assertRaisesRegex(
                PARITY.ModuleParityError,
                "not bound to the verified rootfs tar",
            ):
                PARITY.bind_base_provenance(
                    result,
                    base_provenance=provenance,
                    rootfs_tar=rootfs,
                )


if __name__ == "__main__":
    unittest.main()
