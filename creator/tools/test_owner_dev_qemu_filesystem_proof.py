"""Unit tests for the file-only Owner DEV QEMU filesystem proof."""
import hashlib
import gzip
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "ordax_owner_dev_qemu_test", HERE / "owner_dev_qemu_filesystem_proof.py",
)
PROOF = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROOF)
SHA = "a" * 40


class OwnerDevQemuFilesystemProofTests(unittest.TestCase):
    def test_initramfs_deterministic_and_complete(self):
        busybox = b"\x7fELF" + b"\x00" * 64
        init = PROOF.guest_script(SHA, False)
        first = PROOF.ramdisk(busybox, init)
        self.assertEqual(first, PROOF.ramdisk(busybox, init))
        data = gzip.decompress(first)
        self.assertTrue(data.startswith(b"070701"))
        self.assertIn(b"bin/busybox\x00", data)
        self.assertIn(b"init\x00", data)
        self.assertIn(f"ORDAX_STAGE_OK_{SHA}".encode(), data)
        self.assertIn(b"TRAILER!!!\x00", data)

    def test_guest_scripts_are_commit_bound_and_do_not_select_physical_media(self):
        stage = PROOF.guest_script(SHA, False)
        verify = PROOF.guest_script(SHA, True)
        self.assertIn("/dev/vda", stage)
        self.assertIn("/dev/vdb", stage)
        self.assertIn("mke2fs -F", stage)
        self.assertIn("mount -t ext4 -o ro /dev/vda", verify)
        self.assertNotIn("mke2fs", verify)
        for script in (stage, verify):
            self.assertNotIn("PhysicalDrive", script)
            self.assertNotIn("ORDAX-DATA", script)
            self.assertIn(SHA, script)
        for commit in ("", "A" * 40, SHA + ";exit", "../tmp"):
            with self.assertRaises(PROOF.ProofError):
                PROOF.guest_script(commit, False)

    def test_copy_verifies_size_and_hash_against_canonical_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.bin"
            payload = b"binary\x00\npayload"
            source.write_bytes(payload)
            expected = {"size": len(payload),
                        "sha256": hashlib.sha256(payload).hexdigest()}
            PROOF.copy_verified(source, root / "ok.bin", expected)
            self.assertEqual((root / "ok.bin").read_bytes(), payload)
            changed = dict(expected, sha256="0" * 64)
            with self.assertRaisesRegex(PROOF.ProofError, "changed"):
                PROOF.copy_verified(source, root / "bad.bin", changed)

    def test_qemu_input_check_refuses_non_regular_file_without_launch(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            exe = root / "qemu.exe"
            kernel = root / "vmlinuz"
            initrd = root / "probe.cpio.gz"
            scratch = root / "scratch.raw"
            for item in (exe, kernel, initrd):
                item.write_bytes(b"test")
            with mock.patch.object(PROOF.subprocess, "run") as run:
                with self.assertRaisesRegex(PROOF.ProofError, "regular"):
                    PROOF.boot(exe, kernel, initrd, scratch)
                run.assert_not_called()

    def test_unbound_or_linked_source_is_rejected_before_qemu(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(PROOF.ProofError, "exact-commit"):
                PROOF.prove(root / "not-a-commit", root / "qemu.exe")
            with self.assertRaises(PROOF.ProofError):
                PROOF.ramdisk(b"not-elf", PROOF.guest_script(SHA, False))


if __name__ == "__main__":
    unittest.main()
