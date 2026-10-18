"""Owner QEMU boot uses verified disposable media; no simulated pass markers."""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "owner_qemu", ROOT / "tools/creator/proof/owner_qemu_offline_boot.py"
)
assert SPEC and SPEC.loader
PROOF = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROOF)


class OwnerQemuHandoffTests(unittest.TestCase):
    def fixture(self, directory: Path):
        raw = directory / "usb.raw"
        raw.write_bytes(b"disposable-usb-data")
        kernel = directory / "vmlinuz"
        kernel.write_bytes(b"kernel")
        initramfs = directory / "initramfs.cpio.gz"
        initramfs.write_bytes(b"initramfs")
        report = directory / "proof.json"
        report.write_text(json.dumps({
            "$schema": "prototype-ordax.creator-disposable-media-proof/1",
            "status": "pass", "physical_write_authorized": False,
            "image_bytes": raw.stat().st_size, "partition_table": "gpt",
            "image_sha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
            "checks": {"gpt_valid": True, "physical_write_remains_blocked": True},
        }), encoding="utf-8")
        return raw, report, kernel, initramfs

    def test_real_raw_hash_bound_and_rejects_tampering_and_device_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw, receipt, kernel, initramfs = self.fixture(root)
            self.assertEqual(
                PROOF.validate(raw, receipt, kernel, initramfs, "a" * 40),
                hashlib.sha256(raw.read_bytes()).hexdigest(),
            )
            raw.write_bytes(b"unexpected")
            with self.assertRaises(PROOF.ProofError):
                PROOF.validate(raw, receipt, kernel, initramfs, "a" * 40)
            raw.unlink()
            raw.symlink_to(kernel)
            with self.assertRaises(PROOF.ProofError):
                PROOF.validate(raw, receipt, kernel, initramfs, "a" * 40)

    def test_no_network_and_actual_owner_initramfs_not_fake_sentinel(self):
        disk = Path("/tmp/owner.raw")
        command = PROOF.qemu_command(
            disk, Path("/tmp/vmlinuz"), Path("/tmp/initrd.gz"), Path("/tmp/serial")
        )
        self.assertIn("-net", command)
        self.assertEqual(command[command.index("-net") + 1], "none")
        self.assertIn("usb-storage,bus=owner-xhci.0,drive=ownerusb,bootindex=1", command)
        self.assertIn("rdinit=/init", command[command.index("-append") + 1])
        self.assertIn("ordax.distribution_profile=owner-development", command[command.index("-append") + 1])
        self.assertNotIn("user,hostfwd", " ".join(command))
        self.assertFalse(PROOF.observed("OrdaX Development Base", "a" * 40)["offline_surface_handoff"])
        self.assertFalse(PROOF.observed("Checkout local verificado: " + "b" * 40, "a" * 40)["exact_local_checkout"])
        self.assertFalse(PROOF.observed("ordax-dev-bootstrap: entering local recovery shell", "a" * 40)["recovery_not_entered"])

    def test_creator_runs_real_qemu_only_after_disposable_raw_proof(self):
        workflow = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text(encoding="utf-8")
        materialize = workflow.index("- name: Materialize and verify RAW development seed")
        qemu = workflow.index("- name: Prove actual Owner USB offline handoff in QEMU")
        bundle = workflow.index("- name: Build split Windows Creator bundle")
        self.assertLess(materialize, qemu)
        self.assertLess(qemu, bundle)
        self.assertIn("owner_qemu_offline_boot.py", workflow)
        self.assertIn("ORDAX_OWNER_SOURCE_COMMIT", workflow)


if __name__ == "__main__":
    unittest.main()
