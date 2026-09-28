import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "system" / "surface" / "runtime" / "physical_ata_probe.py"
ENTRYPOINT = ROOT / "system" / "surface" / "bin" / "ordax-ata-evidence"

spec = importlib.util.spec_from_file_location("ordax_physical_ata_probe", PROBE)
probe = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(probe)


def write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class PhysicalAtaProbeTests(unittest.TestCase):
    def build_fixture(self, root: Path):
        write(root / "ata_port" / "ata2" / "port_no", "2\n")
        write(root / "ata_port" / "ata2" / "idle_irq", "7\n")
        write(root / "ata_port" / "not-ata" / "port_no", "99\n")

        write(root / "ata_link" / "link2" / "hw_sata_spd_limit", "3.0 Gbps\n")
        write(root / "ata_link" / "link2" / "sata_spd_limit", "1.5 Gbps\n")
        write(root / "ata_link" / "link2" / "sata_spd", "1.5 Gbps\n")

        device = root / "ata_device" / "dev2.0"
        write(device / "class", "ata\n")
        write(device / "xfer_mode", "UDMA/33\n")
        write(device / "dma_mode", "udma2\n")
        write(device / "spdn_cnt", "3\n")
        write(device / "model", "MUST-NOT-LEAK\n")
        write(device / "serial", "SECRET-SERIAL\n")
        write(
            device / "ering",
            "\n".join(f"event-{index}" for index in range(probe.MAX_ERROR_RING_LINES + 5)) + "\n",
        )

    def test_collects_only_bounded_non_identity_ata_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.build_fixture(root)
            result = probe.collect_evidence(root)

        self.assertEqual(result["schema"], probe.SCHEMA)
        self.assertEqual(result["status"], "observed")
        self.assertEqual(result["environmentAttestation"], "unverified")
        self.assertIsNone(result["physicalStorageVerdict"])
        self.assertFalse(result["networkAccess"])
        self.assertFalse(result["stateMutation"])
        self.assertFalse(result["hardwareIdentityIncluded"])

        self.assertEqual(result["ports"], [{"name": "ata2", "portNumber": 2, "idleIrq": 7}])
        self.assertEqual(
            result["links"],
            [{
                "name": "link2",
                "hardwareSpeedLimit": "3.0 Gbps",
                "configuredSpeedLimit": "1.5 Gbps",
                "negotiatedSpeed": "1.5 Gbps",
            }],
        )
        self.assertEqual(result["devices"][0]["name"], "dev2.0")
        self.assertEqual(result["devices"][0]["speedDownCount"], 3)
        self.assertEqual(result["devices"][0]["transferMode"], "UDMA/33")
        self.assertEqual(len(result["devices"][0]["errorRing"]), probe.MAX_ERROR_RING_LINES)
        self.assertEqual(result["devices"][0]["errorRing"][0], "event-5")
        serialized = repr(result)
        self.assertNotIn("MUST-NOT-LEAK", serialized)
        self.assertNotIn("SECRET-SERIAL", serialized)

    def test_missing_ata_classes_are_valid_empty_observation(self):
        with tempfile.TemporaryDirectory() as directory:
            result = probe.collect_evidence(Path(directory))

        self.assertEqual(result["ports"], [])
        self.assertEqual(result["links"], [])
        self.assertEqual(result["devices"], [])
        self.assertEqual(result["truncated"], {"ports": False, "links": False, "devices": False})

    def test_class_enumeration_is_bounded_and_reports_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(probe.MAX_ENTRIES_PER_CLASS + 1):
                write(root / "ata_port" / f"ata{index}" / "port_no", f"{index}\n")
            result = probe.collect_evidence(root)

        self.assertEqual(len(result["ports"]), probe.MAX_ENTRIES_PER_CLASS)
        self.assertTrue(result["truncated"]["ports"])
        self.assertFalse(result["truncated"]["links"])
        self.assertFalse(result["truncated"]["devices"])

    def test_error_ring_is_line_and_character_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            long_line = "x" * (probe.MAX_ERROR_RING_LINE_CHARS + 100)
            write(root / "ata_device" / "dev1.0" / "ering", long_line + "\n")
            result = probe.collect_evidence(root)

        self.assertEqual(len(result["devices"][0]["errorRing"]), 1)
        self.assertEqual(len(result["devices"][0]["errorRing"][0]), probe.MAX_ERROR_RING_LINE_CHARS)

    def test_source_has_no_mutation_network_subprocess_or_identity_reads(self):
        source = PROBE.read_text(encoding="utf-8")
        for forbidden in (
            "import socket",
            "import urllib",
            "import requests",
            "import subprocess",
            "write_text(",
            "write_bytes(",
            ' / "model"',
            ' / "serial"',
            ' / "wwid"',
            ' / "id"',
            ' / "identify"',
        ):
            self.assertNotIn(forbidden, source)
        self.assertIn("json.dump(result, sys.stdout", source)

    def test_stable_entrypoint_uses_active_runtime_without_mount_or_storage_mutation(self):
        entrypoint = ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("ordax-proof-runtime.sh", entrypoint)
        self.assertIn("resolve_ordax_proof_runtime_root", entrypoint)
        self.assertIn("SCRIPT=/srv/ordax-system/surface/runtime/physical_ata_probe.py", entrypoint)
        self.assertIn('[ -d "$RUNTIME_ROOT/sys/class" ]', entrypoint)
        self.assertIn(
            'exec /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$SCRIPT" "$@"',
            entrypoint,
        )
        for forbidden in (
            " mount ",
            " umount ",
            " libata.force",
            " rescan",
            ">/sys",
            "> /sys",
            "tee /sys",
            "dd if=",
            "dd of=",
        ):
            self.assertNotIn(forbidden, entrypoint)


if __name__ == "__main__":
    unittest.main()
