import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def synthetic_elf64(needed: bytes = b"libexample.so.1", machine: int = 62) -> bytes:
    size = 0x240
    data = bytearray(size)
    data[:4] = b"\x7fELF"
    data[4] = 2  # ELF64
    data[5] = 1  # little endian
    data[6] = 1
    struct.pack_into("<HHIQQQIHHHHHH", data, 16, 3, machine, 1, 0, 64, 0, 0, 64, 56, 2, 0, 0, 0)
    # PT_LOAD: maps file offset 0 at vaddr 0x400000.
    struct.pack_into("<IIQQQQQQ", data, 64, 1, 5, 0, 0x400000, 0, size, size, 0x1000)
    # PT_DYNAMIC at file offset 0x100.
    struct.pack_into("<IIQQQQQQ", data, 120, 2, 6, 0x100, 0x400100, 0, 64, 64, 8)
    # DT_NEEDED offset 1, DT_STRTAB at vaddr 0x400200, DT_STRSZ, DT_NULL.
    struct.pack_into("<QQ", data, 0x100, 1, 1)
    struct.pack_into("<QQ", data, 0x110, 5, 0x400200)
    string_table = b"\x00" + needed + b"\x00"
    struct.pack_into("<QQ", data, 0x120, 10, len(string_table))
    struct.pack_into("<QQ", data, 0x130, 0, 0)
    data[0x200:0x200 + len(string_table)] = string_table
    return bytes(data)


def synthetic_elf32(needed: bytes = b"libexample.so.1", machine: int = 3) -> bytes:
    size = 0x220
    data = bytearray(size)
    data[:4] = b"\x7fELF"
    data[4] = 1  # ELF32
    data[5] = 1  # little endian
    data[6] = 1
    struct.pack_into("<HHIIIIIHHHHHH", data, 16, 3, machine, 1, 0, 52, 0, 0, 52, 32, 2, 0, 0, 0)
    # PT_LOAD: maps file offset 0 at vaddr 0x08048000.
    struct.pack_into("<IIIIIIII", data, 52, 1, 0, 0x08048000, 0, size, size, 5, 0x1000)
    # PT_DYNAMIC at file offset 0x100.
    struct.pack_into("<IIIIIIII", data, 84, 2, 0x100, 0x08048100, 0, 32, 32, 6, 4)
    # DT_NEEDED offset 1, DT_STRTAB at vaddr 0x08048200, DT_STRSZ, DT_NULL.
    struct.pack_into("<II", data, 0x100, 1, 1)
    struct.pack_into("<II", data, 0x108, 5, 0x08048200)
    string_table = b"\x00" + needed + b"\x00"
    struct.pack_into("<II", data, 0x110, 10, len(string_table))
    struct.pack_into("<II", data, 0x118, 0, 0)
    data[0x200:0x200 + len(string_table)] = string_table
    return bytes(data)


def stage_metadata(stage: Path) -> dict:
    manifest, total_regular_bytes = MODULE.FULL_BUILD.staging_manifest(stage)
    return {
        "entry_count": len(manifest),
        "regular_file_count": sum(1 for item in manifest.values() if item.get("type") == "file"),
        "symlink_count": sum(1 for item in manifest.values() if item.get("type") == "symlink"),
        "total_regular_bytes": total_regular_bytes,
        "canonical_manifest_sha256": MODULE.FULL_BUILD.canonical_manifest_sha256(manifest),
    }


class RuntimeDependencyDiscoveryTests(unittest.TestCase):
    def test_contract_is_discovery_only(self):
        contract = MODULE.load_contract()
        self.assertEqual(contract["status"], "discovery-only-not-promotable")
        self.assertTrue(contract["inspection"]["stage_manifest_binding_required"])
        self.assertTrue(contract["inspection"]["elf_identity_match_required"])
        self.assertTrue(contract["inspection"]["rooted_symlink_resolution_required"])
        self.assertFalse(contract["inspection"]["host_readelf_allowed"])
        self.assertFalse(contract["inspection"]["network_allowed"])
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def test_elf_parser_extracts_dt_needed_and_identity_without_external_tool(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sample"
            path.write_bytes(synthetic_elf64())
            info = MODULE.parse_elf_dynamic(path)
            self.assertEqual(info["dt_needed"], ["libexample.so.1"])
            self.assertEqual(info["class"], 64)
            self.assertEqual(info["machine"], 62)
            self.assertEqual(info["endianness"], "little")
            self.assertEqual(MODULE.parse_dt_needed(path), ["libexample.so.1"])

    def test_elf_parser_rejects_path_bearing_needed_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sample"
            path.write_bytes(synthetic_elf64(b"../libevil.so"))
            with self.assertRaises(MODULE.RuntimeDependencyError):
                MODULE.parse_dt_needed(path)

    def test_soname_resolution_is_scoped_by_elf_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            lib64 = root / "usr/lib64/libexample.so.1"
            lib32 = root / "usr/lib32/libexample.so.1"
            lib64.parent.mkdir(parents=True)
            lib32.parent.mkdir(parents=True)
            lib64.write_bytes(synthetic_elf64(b"libc.so.6"))
            lib32.write_bytes(synthetic_elf32(b"libc.so.6"))
            index = MODULE.build_soname_index(root)
            consumer64 = MODULE.parse_elf_dynamic(lib64)
            consumer32 = MODULE.parse_elf_dynamic(lib32)
            self.assertEqual(
                MODULE.resolve_candidate(index, "libexample.so.1", consumer64, "test")["path"],
                "usr/lib64/libexample.so.1",
            )
            self.assertEqual(
                MODULE.resolve_candidate(index, "libexample.so.1", consumer32, "test")["path"],
                "usr/lib32/libexample.so.1",
            )

    def test_soname_resolution_collapses_aliases_to_same_rooted_target(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            canonical = root / "lib/libexample.so.1"
            alias = root / "usr/lib/libexample.so.1"
            canonical.parent.mkdir(parents=True)
            alias.parent.mkdir(parents=True)
            canonical.write_bytes(synthetic_elf64(b"libc.so.6"))
            alias.symlink_to("../../lib/libexample.so.1")
            index = MODULE.build_soname_index(root)
            consumer = MODULE.parse_elf_dynamic(canonical)
            resolved = MODULE.resolve_candidate(index, "libexample.so.1", consumer, "test")
            self.assertEqual(resolved["canonical_path"], "lib/libexample.so.1")
            self.assertEqual(
                resolved["candidate_paths"],
                ["lib/libexample.so.1", "usr/lib/libexample.so.1"],
            )

    def test_rooted_symlink_resolution_rejects_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "root"
            outside = Path(temp) / "outside.so"
            alias = root / "usr/lib/libexample.so.1"
            alias.parent.mkdir(parents=True)
            outside.write_bytes(synthetic_elf64(b"libc.so.6"))
            alias.symlink_to("../../../outside.so")
            with self.assertRaisesRegex(MODULE.RuntimeDependencyError, "escapes dependency tree"):
                MODULE.build_soname_index(root)

    def test_apk_database_maps_exact_file_owner_and_version(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            database = root / "lib/apk/db/installed"
            database.parent.mkdir(parents=True)
            database.write_text(
                "P:example-libs\nV:1.2.3-r4\nF:usr/lib\nR:libexample.so.1\n\n",
                encoding="utf-8",
            )
            versions, owners = MODULE.parse_apk_installed(root)
            self.assertEqual(versions["example-libs"], "1.2.3-r4")
            self.assertEqual(owners["usr/lib/libexample.so.1"], ("example-libs", "1.2.3-r4"))

    def test_external_candidate_requires_one_owner_across_alias_and_target(self):
        candidate = {
            "candidate_paths": ["usr/lib/libexample.so.1"],
            "canonical_path": "lib/libexample.so.1.2.3",
        }
        owners = {
            "usr/lib/libexample.so.1": ("example-libs", "1.2.3-r4"),
            "lib/libexample.so.1.2.3": ("example-libs", "1.2.3-r4"),
        }
        self.assertEqual(
            MODULE.require_single_apk_owner(candidate, owners),
            ("example-libs", "1.2.3-r4"),
        )
        owners["lib/libexample.so.1.2.3"] = ("other-libs", "9.9-r1")
        with self.assertRaisesRegex(MODULE.RuntimeDependencyError, "crosses Alpine owners"):
            MODULE.require_single_apk_owner(candidate, owners)

    def test_stage_binding_recomputes_exact_full_build_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            stage = Path(temp) / "stage"
            payload = stage / "usr/lib/wine/sample.so"
            payload.parent.mkdir(parents=True)
            payload.write_bytes(b"exact-stage-bytes")
            proof = {"staging": stage_metadata(stage)}
            self.assertEqual(
                MODULE.verify_stage_binding(stage, proof),
                proof["staging"]["canonical_manifest_sha256"],
            )

    def test_stage_binding_rejects_stage_mutated_after_full_build_proof(self):
        with tempfile.TemporaryDirectory() as temp:
            stage = Path(temp) / "stage"
            payload = stage / "usr/lib/wine/sample.so"
            payload.parent.mkdir(parents=True)
            payload.write_bytes(b"original-stage-bytes")
            proof = {"staging": stage_metadata(stage)}
            payload.write_bytes(b"mutated-after-proof")
            with self.assertRaisesRegex(MODULE.RuntimeDependencyError, "does not match full build proof"):
                MODULE.verify_stage_binding(stage, proof)

    def test_discovery_rejects_unproven_full_build(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            stage.mkdir()
            rootfs.mkdir()
            proof = {
                "$schema": "prototype-ordax.windows-compat-full-build-proof/2",
                "runtime_id": "wine-11.0-wow64-x86_64-candidate",
                "gates": {"full_build_proof_passed": False},
            }
            with self.assertRaises(MODULE.RuntimeDependencyError):
                MODULE.discover(stage, rootfs, proof)


if __name__ == "__main__":
    unittest.main()
