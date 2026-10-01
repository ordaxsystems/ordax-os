from importlib import util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "system" / "surface" / "runtime" / "physical_kernel_log_probe.py"
ENTRYPOINT = ROOT / "system" / "surface" / "bin" / "ordax-kernel-log-evidence"

spec = util.spec_from_file_location("ordax_physical_kernel_log_probe", PROBE)
probe = util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(probe)


class PhysicalKernelLogProbeTests(unittest.TestCase):
    def test_parser_keeps_only_ata_recovery_events(self):
        event = probe.parse_kmsg_record(b"4,12,123456,-;ata2: hard resetting link\n")
        self.assertEqual(
            event,
            {
                "priority": 4,
                "sequence": 12,
                "timestampUsec": 123456,
                "flags": "-",
                "message": "ata2: hard resetting link",
            },
        )

        identification = probe.parse_kmsg_record(
            b"6,13,123500,-;ata2.00: ATA-8: Example Device Model, S/N: SECRET123\n"
        )
        self.assertIsNone(identification)

        identity_bearing_error = probe.parse_kmsg_record(
            b"3,14,123550,-;ata2.00: failed to IDENTIFY model ExampleDrive serial SECRET123\n"
        )
        self.assertIsNone(identity_bearing_error)

        wwn_bearing_error = probe.parse_kmsg_record(
            b"3,15,123575,-;ata2.00: reset failed WWN 5000c500deadbeef\n"
        )
        self.assertIsNone(wwn_bearing_error)

        unrelated = probe.parse_kmsg_record(
            b"3,16,123600,-;eth0: reset failed while bringing link up\n"
        )
        self.assertIsNone(unrelated)

    def test_parser_accepts_failure_signatures_without_device_identity(self):
        samples = (
            b"3,21,200000,-;ata2.00: failed to IDENTIFY (I/O error, err_mask=0x4)\n",
            b"3,22,210000,-;ata2: COMRESET failed (errno=-16)\n",
            b"4,23,220000,-;ata2: SATA link down (SStatus 0 SControl 300)\n",
            b"3,24,230000,-;ata2.00: exception Emask 0x10 SAct 0x0 SErr 0x4050000 action 0xe frozen\n",
        )
        parsed = [probe.parse_kmsg_record(sample) for sample in samples]
        self.assertTrue(all(item is not None for item in parsed))
        self.assertFalse(any("SECRET" in item["message"] for item in parsed if item))

    def test_collection_is_bounded_and_non_authorizing(self):
        records = [
            f"4,{index},{100000 + index},-;ata2: hard resetting link\n".encode("utf-8")
            for index in range(probe.MAX_OUTPUT_EVENTS + 10)
        ]
        result = probe.collect_records(records)
        self.assertEqual(result["schema"], "ordax.physical-kernel-log-evidence/1")
        self.assertEqual(len(result["events"]), probe.MAX_OUTPUT_EVENTS)
        self.assertTrue(result["scanTruncated"])
        self.assertIsNone(result["physicalStorageVerdict"])
        self.assertFalse(result["networkAccess"])
        self.assertFalse(result["stateMutation"])
        self.assertFalse(result["hardwareIdentityIncluded"])
        self.assertEqual(result["filter"], "ata-error-recovery-only")

    def test_source_reads_dev_kmsg_nonblocking_without_mutation_paths(self):
        source = PROBE.read_text(encoding="utf-8")
        self.assertIn('KMSG_PATH = Path("/dev/kmsg")', source)
        self.assertIn("os.O_RDONLY | os.O_NONBLOCK", source)
        self.assertIn("HARDWARE_IDENTITY", source)
        self.assertNotIn("/proc/kmsg", source)
        for forbidden in (
            "subprocess",
            "socket",
            "os.O_WRONLY",
            "os.O_RDWR",
            "ioctl",
            "system(",
        ):
            self.assertNotIn(forbidden, source)

    def test_physical_entrypoint_is_argument_strict_and_storage_read_only(self):
        source = ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("validate_arguments()", source)
        self.assertIn("-h|--help)", source)
        self.assertIn("unsupported physical entrypoint argument", source)
        self.assertIn('$RUNTIME_ROOT/dev/kmsg', source)
        self.assertIn(
            'exec /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$SCRIPT" "$@"',
            source,
        )
        for forbidden in (
            " mount ",
            " umount ",
            " modprobe ",
            " rmmod ",
            " rescan",
            "libata.force",
            " dd ",
            "> /sys",
            ">/sys",
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
