"""Fail-closed regressions for disposable real-ext4-backed QCOW2 proof."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "ordax_cow_test", HERE / "owner_dev_qemu_partition_snapshot.py",
)
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)
SHA = "a" * 40
NONCE = "0" * 16
VOL = "\\\\.\\D:"


class SnapshotExt4Tests(unittest.TestCase):
    def test_guest_staging_materializes_only_snapshot_not_real_usb(self):
        stage = APP.guest_script(SHA, NONCE, "stage")
        readback = APP.guest_script(SHA, NONCE, "readback")
        physical = APP.guest_script(SHA, NONCE, "physical")
        self.assertIn("mount -t ext4 /dev/vda /mnt", stage)
        self.assertIn("tar -xpf /dev/vdb", stage)
        self.assertIn(f"/mnt/versions/{SHA}/.ordax-base/source-commit", stage)
        self.assertIn("mount -t ext4 -o ro,noload", readback)
        self.assertIn("test ! -e", physical)
        self.assertNotIn("tar -x", readback + physical)
        self.assertNotIn("echo " + NONCE + " >", readback + physical)
        for script in (stage, readback, physical):
            self.assertNotIn("PhysicalDrive", script)
            self.assertNotIn("\\\\.\\", script)

    def test_physical_probe_errors_are_converted_to_snapshot_owner_error(self):
        class ProbeFailure(RuntimeError):
            pass

        physical = mock.Mock()
        physical.ReadonlyProbeError = ProbeFailure
        physical.probe.side_effect = ProbeFailure("guest stalled")
        phases = []
        with mock.patch.object(APP, "_load", return_value=physical):
            with self.assertRaisesRegex(APP.SnapshotProofError, "guest stalled"):
                APP.prove(Path("base"), Path("qemu"), Path("qemu-img"),
                          disk_number=1, serial="6699E36B",
                          requested_commit=SHA, progress=phases.append)
        self.assertEqual(phases, ["readonly-physical-preflight"])

    def test_qemu_timeout_preserves_bounded_guest_diagnostic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("qemu.exe", "kernel", "initrd.gz", "disk.qcow2"):
                (root / name).write_bytes(b"fixture")
            timeout = __import__("subprocess").TimeoutExpired(
                "qemu", 180, output=b"QEMU_DRIVER_REPORT: stalled physical read")
            with mock.patch.object(APP.subprocess, "run", side_effect=timeout):
                with self.assertRaisesRegex(APP.SnapshotProofError,
                                            "QEMU_DRIVER_REPORT"):
                    APP.run_vm(root / "qemu.exe", root / "kernel",
                               root / "initrd.gz", root / "disk.qcow2",
                               "qcow2", "expected")

    def test_invalid_source_nonce_and_phase_rejected(self):
        for value in ("", "../", SHA + "extra", "A" * 40):
            with self.assertRaises(APP.SnapshotProofError):
                APP.guest_script(value, NONCE, "stage")
        for value in ("", "A" * 16, "bad nonce", "0" * 17):
            with self.assertRaises(APP.SnapshotProofError):
                APP.guest_script(SHA, value, "stage")
        with self.assertRaisesRegex(APP.SnapshotProofError, "unsupported"):
            APP.guest_script(SHA, NONCE, "wipe")

    def test_raw_physical_volume_cannot_be_qemu_write_target(self):
        with mock.patch.object(APP.subprocess, "run") as launch:
            with self.assertRaisesRegex(APP.SnapshotProofError, "cannot be a guest write"):
                APP.run_vm(Path("qemu"), Path("kernel"), Path("ramdisk"),
                           VOL, "raw", "done", ro=False)
            with self.assertRaisesRegex(APP.SnapshotProofError, "cannot be a guest write"):
                APP.run_vm(Path("qemu"), Path("kernel"), Path("ramdisk"),
                           Path("disk.raw"), "raw", "done", ro=True)
            with self.assertRaisesRegex(APP.SnapshotProofError, "unsupported"):
                APP.run_vm(Path("qemu"), Path("kernel"), Path("ramdisk"),
                           VOL, "vmdk", "done", ro=True)
            launch.assert_not_called()

    def test_sample_reads_raw_volume_only_for_read(self):
        sample = b"\x01" * (8 * APP.MIB)
        with mock.patch("builtins.open", return_value=io.BytesIO(sample)) as handle:
            digest = APP.sample_read_only(VOL)
        self.assertEqual(digest, hashlib.sha256(sample).hexdigest())
        self.assertEqual(handle.call_args.args, (VOL, "rb"))
        with self.assertRaises(APP.SnapshotProofError):
            APP.sample_read_only(r"\\.\PhysicalDrive1")

    def test_overlay_metadata_requires_exact_raw_usb_backing(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            exe = base / "qemu-img.exe"
            exe.write_bytes(b"test")
            overlay = base / "overlay.qcow2"
            ok = {
                "format": "qcow2", "backing-filename-format": "raw",
                "backing-filename": VOL, "virtual-size": 8053063680,
            }

            def called(args, **kwargs):
                if "create" in args:
                    return mock.Mock(returncode=0, stdout=b"", stderr=b"")
                return mock.Mock(returncode=0, stdout=json.dumps(ok).encode(),
                                 stderr=b"")

            with mock.patch.object(APP.subprocess, "run", side_effect=called) as run:
                APP.create_overlay(exe, VOL, overlay)
            first = run.call_args_list[0].args[0]
            self.assertIn("-F", first)
            self.assertIn("raw", first)
            self.assertEqual(first[first.index("-b") + 1], VOL)
            ok["backing-filename"] = r"\\.\PhysicalDrive0"
            with mock.patch.object(APP.subprocess, "run", side_effect=called):
                with self.assertRaisesRegex(APP.SnapshotProofError, "provenance"):
                    APP.create_overlay(exe, VOL, overlay)


if __name__ == "__main__":
    unittest.main()
