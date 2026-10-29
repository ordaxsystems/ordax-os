import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "tools" / "creator" / "proof" / "disposable_media.py"
CONTRACT_PATH = ROOT / "docs" / "contracts" / "physical-media.json"

SPEC = importlib.util.spec_from_file_location("ordax_disposable_media", SCRIPT_PATH)
MEDIA = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MEDIA)


class PhysicalMediaContractTests(unittest.TestCase):
    def load_contract(self):
        return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    def stage(self, root: Path) -> tuple[Path, Path, Path]:
        stage = root / "stage"
        esp = stage / "ORDAX-ESP"
        main = stage / "ORDAX"
        esp.mkdir(parents=True)
        main.mkdir()
        return stage, esp, main

    def test_canonical_contract_is_fail_closed_and_valid(self):
        contract = self.load_contract()
        MEDIA.validate_contract(contract)
        self.assertFalse(contract["physical_write_allowed"])
        self.assertEqual(contract["partition_table"], "gpt")
        self.assertEqual(
            [p["name"] for p in contract["partitions"]],
            ["ORDAX-ESP", "ORDAX"],
        )
        self.assertEqual(
            [p["filesystem"] for p in contract["partitions"]],
            ["fat32", "ext4"],
        )

    def test_geometry_is_one_mib_aligned_and_contiguous(self):
        contract = self.load_contract()
        sector = contract["logical_sector_bytes"]
        alignment_sectors = contract["alignment_bytes"] // sector
        esp, main = contract["partitions"]
        self.assertEqual(esp["start_lba"], alignment_sectors)
        self.assertEqual(esp["size_bytes"] % contract["alignment_bytes"], 0)
        self.assertEqual(
            main["start_lba"],
            esp["start_lba"] + esp["size_bytes"] // sector,
        )
        self.assertEqual(main["start_lba"] % alignment_sectors, 0)

    def test_legacy_third_partitions_are_forbidden(self):
        contract = self.load_contract()
        self.assertIn("ORDAX-HOME", contract["forbidden_partitions"])
        self.assertIn("ORDAX-PLATFORM", contract["forbidden_partitions"])

    def test_stage_tree_rejects_extra_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, _, _ = self.stage(root)
            (stage / "EXTRA").mkdir()
            with self.assertRaisesRegex(
                MEDIA.ProofError, "exactly ORDAX-ESP and ORDAX"
            ):
                MEDIA.inspect_stage_tree(stage)

    def test_stage_tree_rejects_symlink_on_esp_even_when_confined(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, esp, _ = self.stage(root)
            target = esp / "BOOTX64.real"
            target.write_bytes(b"boot")
            (esp / "BOOTX64.EFI").symlink_to("BOOTX64.real")
            with self.assertRaisesRegex(MEDIA.ProofError, "ESP may not contain symlink"):
                MEDIA.inspect_stage_tree(stage)

    def test_stage_tree_accepts_confined_ordax_file_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, _, main = self.stage(root)
            binary = main / "bin"
            binary.mkdir()
            (binary / "busybox").write_bytes(b"busybox")
            (binary / "sh").symlink_to("busybox")

            inventory = MEDIA.inspect_stage_tree(stage)
            symlinks = [
                entry for entry in inventory["ORDAX"] if entry["kind"] == "symlink"
            ]
            self.assertEqual(
                symlinks,
                [{"kind": "symlink", "path": "bin/sh", "target": "busybox"}],
            )

    def test_stage_tree_accepts_confined_ordax_directory_symlink_without_walk(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, _, main = self.stage(root)
            (main / "usr/lib").mkdir(parents=True)
            (main / "usr/lib/runtime.so").write_bytes(b"runtime")
            (main / "lib").symlink_to("usr/lib", target_is_directory=True)

            inventory = MEDIA.inspect_stage_tree(stage)
            symlinks = [
                entry for entry in inventory["ORDAX"] if entry["kind"] == "symlink"
            ]
            files = [entry for entry in inventory["ORDAX"] if entry["kind"] == "file"]
            self.assertIn(
                {"kind": "symlink", "path": "lib", "target": "usr/lib"},
                symlinks,
            )
            self.assertEqual(
                [entry["path"] for entry in files].count("usr/lib/runtime.so"), 1
            )

    def test_stage_tree_rejects_ordax_absolute_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, _, main = self.stage(root)
            (main / "bin").mkdir()
            (main / "bin/sh").symlink_to("/etc/passwd")
            with self.assertRaisesRegex(MEDIA.ProofError, "unsafe staged symlink target"):
                MEDIA.inspect_stage_tree(stage)

    def test_stage_tree_rejects_ordax_symlink_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, esp, main = self.stage(root)
            (esp / "outside").write_bytes(b"outside")
            (main / "bin").mkdir()
            (main / "bin/sh").symlink_to("../../ORDAX-ESP/outside")
            with self.assertRaisesRegex(MEDIA.ProofError, "escapes partition root"):
                MEDIA.inspect_stage_tree(stage)

    def test_stage_tree_accepts_confined_runtime_dangling_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, _, main = self.stage(root)
            (main / "etc").mkdir()
            (main / "etc/resolv.conf").symlink_to("../run/resolv.conf")

            inventory = MEDIA.inspect_stage_tree(stage)
            self.assertIn(
                {
                    "kind": "symlink",
                    "path": "etc/resolv.conf",
                    "target": "../run/resolv.conf",
                },
                inventory["ORDAX"],
            )

    def test_stage_tree_rejects_ordax_symlink_cycle(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage, _, main = self.stage(root)
            (main / "a").symlink_to("b")
            (main / "b").symlink_to("a")
            with self.assertRaisesRegex(MEDIA.ProofError, "symlink cycle"):
                MEDIA.inspect_stage_tree(stage)

    def test_sgdisk_info_parser_requires_all_critical_fields(self):
        info = MEDIA.parse_sgdisk_info(
            """Partition GUID code: C12A7328-F81F-11D2-BA4B-00A0C93EC93B (EFI system partition)
First sector: 2048 (at 1024.0 KiB)
Last sector: 526335 (at 257.0 MiB)
Partition name: 'ORDAX-ESP'
"""
        )
        self.assertEqual(info["first_lba"], 2048)
        self.assertEqual(info["sector_count"], 524288)
        self.assertEqual(info["name"], "ORDAX-ESP")
        self.assertEqual(info["type_guid"], MEDIA.ESP_TYPE_GUID)


if __name__ == "__main__":
    unittest.main()
