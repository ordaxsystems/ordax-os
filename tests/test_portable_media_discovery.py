"""Dynamic fixtures for the real portable PID1 volume selector (no media writes)."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PID1 = (ROOT / "bootstrap/initramfs/portable_init.sh").read_text(encoding="utf-8")


def actual_selector() -> str:
    start = "resolve_portable_devices() {\n"
    assert PID1.count(start) == 1
    return start + PID1.split(start, 1)[1].split("\n}\n", 1)[0] + "\n}\n"


class PortableMediaDiscoveryTests(unittest.TestCase):
    def run_selector(self, partitions, *, arriving=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sys_block, dev_root, binary = (root / p for p in ("sys-block", "dev", "bin"))
            sys_block.mkdir()
            dev_root.mkdir()
            binary.mkdir()

            def add_partition(node):
                disk = "nvme0n1" if node.startswith("nvme0n1p") else node[:3]
                part = sys_block / disk / node
                part.mkdir(parents=True, exist_ok=True)
                (part / "partition").write_text("1\n", encoding="ascii")
                (dev_root / node).touch()

            for node in partitions:
                add_partition(node)

            labels = dict(partitions)
            if arriving is not None:
                labels[arriving[0]] = arriving[1]

            stub = ["#!/bin/sh", 'case "${1##*/}" in']
            for node, label in labels.items():
                stub.append(f'  {node}) printf \'%s: LABEL="{label}" TYPE="exfat"\\n\' "$1" ;;')
            stub.append("esac")
            (binary / "blkid").write_text("\n".join(stub) + "\n", encoding="utf-8")
            (binary / "blkid").chmod(0o755)

            if arriving is None:
                wait = "#!/bin/sh\nexit 0\n"
            else:
                node = arriving[0]
                disk = "nvme0n1" if node.startswith("nvme0n1p") else node[:3]
                wait = (
                    "#!/bin/sh\n"
                    f'mkdir -p "{sys_block / disk / node}"\n'
                    f'printf "1\\n" > "{sys_block / disk / node / "partition"}"\n'
                    f': > "{dev_root / node}"\n'
                )
            (binary / "sleep").write_text(wait, encoding="utf-8")
            (binary / "sleep").chmod(0o755)
            shell = (
                "set -eu\n" + actual_selector() +
                f'if resolve_portable_devices "{sys_block}" "{dev_root}"; then\n'
                '  printf "%s\\n%s\\n" "$ESP_DEVICE" "$DATA_DEVICE"\n'
                'else\n  exit "$?"\nfi\n'
            )
            return subprocess.run(
                ["sh", "-c", shell], capture_output=True, text=True, check=False,
                env={**os.environ, "PATH": f"{binary}:{os.environ.get('PATH', '')}"},
            )

    def test_accepts_unique_esp_and_data_from_same_disk(self):
        result = self.run_selector({"sda1": "ORDAX-ESP", "sda3": "ORDAX-DATA"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.endswith("/sda1\n" + result.stdout.splitlines()[1] + "\n"))
        self.assertTrue(result.stdout.splitlines()[1].endswith("/sda3"))

    def test_rejects_two_cloned_usb_media(self):
        result = self.run_selector({
            "sda1": "ORDAX-ESP", "sda2": "ORDAX-DATA",
            "sdb1": "ORDAX-ESP", "sdb2": "ORDAX-DATA",
        })
        self.assertEqual(result.returncode, 2)

    def test_rejects_esp_data_from_different_disks(self):
        result = self.run_selector({"sda1": "ORDAX-ESP", "sdb2": "ORDAX-DATA"})
        self.assertEqual(result.returncode, 2)

    def test_rejects_incomplete_media_after_bounded_retries(self):
        result = self.run_selector({"sda1": "ORDAX-ESP"})
        self.assertEqual(result.returncode, 1)

    def test_accepts_late_data_partition_without_network(self):
        result = self.run_selector(
            {"sda1": "ORDAX-ESP"},
            arriving=("sda2", "ORDAX-DATA"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.splitlines()[1].endswith("/sda2"))

    def test_ignores_other_partitions_but_rejects_duplicate_esp(self):
        result = self.run_selector({
            "sda1": "ORDAX-ESP", "sda2": "ORDAX-DATA",
            "nvme0n1p1": "WINDOWS",
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        duplicate = self.run_selector({
            "sda1": "ORDAX-ESP", "sda2": "ORDAX-DATA",
            "nvme0n1p1": "ORDAX-ESP",
        })
        self.assertEqual(duplicate.returncode, 2)

    def test_contract_and_mount_order(self):
        import json
        contract = json.loads((ROOT / "bootstrap/initramfs/source.json").read_text(encoding="utf-8"))
        discovery = contract["portable_v2_prerequisites"]["partition_discovery"]
        self.assertEqual(discovery["attempts"], 12)
        self.assertTrue(discovery["requires_same_parent_disk"])
        self.assertTrue(discovery["rejects_duplicate_labels"])
        self.assertFalse(discovery["uses_network"])
        self.assertLess(
            PID1.index("resolve_portable_devices /sys/block /dev"),
            PID1.index('mount -t vfat -o ro,nodev,nosuid "$ESP_DEVICE"'),
        )
        self.assertNotIn("findfs LABEL=ORDAX-ESP", PID1)
        self.assertNotIn("findfs LABEL=ORDAX-DATA", PID1)


if __name__ == "__main__":
    unittest.main()
