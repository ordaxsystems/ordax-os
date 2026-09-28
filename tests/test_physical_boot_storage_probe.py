import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "system" / "diagnostics" / "physical_boot_storage.py"

spec = importlib.util.spec_from_file_location("ordax_physical_boot_storage_probe", PROBE)
probe = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(probe)


class PhysicalBootStorageProbeTests(unittest.TestCase):
    def write_fixture(self, path: Path):
        path.write_bytes(
            b"6,1,1000000,-;ahci 0000:00:1f.2: controller initialized\n"
            b"6,2,2000000,-;ata2: SATA max UDMA/133\n"
            b"4,3,12000000,-;ata2: link is slow to respond, please be patient\n"
            b"3,4,52000000,-;ata2: COMRESET failed (errno=-16)\n"
            b"6,5,53000000,-;ata2: SATA link down\n"
            b"6,6,54000000,-;unrelated subsystem message\n"
        )

    def test_probe_filters_storage_events_and_measures_ata_gap_without_verdict(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "kmsg.fixture"
            self.write_fixture(path)
            result = probe.run_probe(path, max_records=32)

        self.assertEqual(result["schema"], "ordax.physical-boot-storage-probe/1")
        self.assertEqual(result["status"], "observed")
        self.assertEqual(result["environmentAttestation"], "unverified")
        self.assertIsNone(result["hardwareStorageVerdict"])
        self.assertFalse(result["networkAccess"])
        self.assertFalse(result["stateMutation"])
        self.assertFalse(result["kernelConfigurationMutation"])
        self.assertEqual(result["recordsRead"], 6)
        self.assertEqual(len(result["events"]), 5)
        self.assertNotIn("unrelated subsystem", str(result))

        ports = result["summary"]["ataPorts"]
        self.assertEqual(len(ports), 1)
        self.assertEqual(ports[0]["ataPort"], 2)
        self.assertEqual(ports[0]["eventCount"], 4)
        self.assertEqual(ports[0]["largestConsecutiveGapMilliseconds"], 40000)

    def test_regular_file_input_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "kmsg.fixture"
            path.write_bytes(
                b"".join(
                    f"6,{index},{index * 1000},-;ata1: event {index}\n".encode()
                    for index in range(20)
                )
            )
            result = probe.run_probe(path, max_records=5)

        self.assertEqual(result["recordsRead"], 5)
        self.assertTrue(result["inputTruncated"])
        self.assertEqual(len(result["events"]), 5)

    def test_probe_rejects_invalid_record_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "kmsg.fixture"
            path.write_bytes(b"")
            for invalid in (0, probe.MAX_RECORDS + 1):
                with self.assertRaises(ValueError):
                    probe.run_probe(path, max_records=invalid)

    def test_source_contains_no_storage_or_kernel_mutation_path(self):
        source = PROBE.read_text(encoding="utf-8")
        for forbidden in (
            "libata.force",
            "modprobe",
            "rmmod",
            "sysctl",
            "write_text(",
            "write_bytes(",
            "import socket",
            "import urllib",
            "import requests",
        ):
            self.assertNotIn(forbidden, source)
        self.assertIn("os.O_RDONLY | os.O_NONBLOCK", source)
        self.assertIn("json.dump(result, sys.stdout", source)


if __name__ == "__main__":
    unittest.main()
