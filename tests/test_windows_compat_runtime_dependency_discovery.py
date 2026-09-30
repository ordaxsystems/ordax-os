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


def synthetic_elf64(
    needed: bytes = b"libexample.so.1",
    machine: int = 62,
    *,
    rpath: bytes | None = None,
    runpath: bytes | None = None,
) -> bytes:
    size = 0x500
    data = bytearray(size)
    data[:4] = b"\x7fELF"
    data[4] = 2
    data[5] = 1
    data[6] = 1
    struct.pack_into("<HHIQQQIHHHHHH", data, 16, 3, machine, 1, 0, 64, 0, 0, 64, 56, 2, 0, 0, 0)
    struct.pack_into("<IIQQQQQQ", data, 64, 1, 5, 0, 0x400000, 0, size, size, 0x1000)

    strings = bytearray(b"\x00")

    def add_string(value: bytes) -> int:
        offset = len(strings)
        strings.extend(value + b"\x00")
        return offset

    needed_offset = add_string(needed)
    rpath_offset = add_string(rpath) if rpath is not None else None
    runpath_offset = add_string(runpath) if runpath is not None else None
    entries = [(MODULE.DT_NEEDED, needed_offset)]
    if rpath_offset is not None:
        entries.append((MODULE.DT_RPATH, rpath_offset))
    if runpath_offset is not None:
        entries.append((MODULE.DT_RUNPATH, runpath_offset))
    entries.extend([
        (MODULE.DT_STRTAB, 0x400300),
        (MODULE.DT_STRSZ, len(strings)),
        (MODULE.DT_NULL, 0),
    ])
    dyn_len = len(entries) * 16
    struct.pack_into("<IIQQQQQQ", data, 120, 2, 6, 0x100, 0x400100, 0, dyn_len, dyn_len, 8)
    for index, (tag, value) in enumerate(entries):
        struct.pack_into("<QQ", data, 0x100 + index * 16, tag, value)
    data[0x300:0x300 + len(strings)] = strings
    return bytes(data)


def synthetic_elf32(needed: bytes = b"libexample.so.1", machine: int = 3) -> bytes:
    size = 0x400
    data = bytearray(size)
    data[:4] = b"\x7fELF"
    data[4] = 1
    data[5] = 1
    data[6] = 1
    struct.pack_into("<HHIIIIIHHHHHH", data, 16, 3, machine, 1, 0, 52, 0, 0, 52, 32, 2, 0, 0, 0)
    struct.pack_into("<IIIIIIII", data, 52, 1, 0, 0x08048000, 0, size, size, 5, 0x1000)
    strings = b"\x00" + needed + b"\x00"
    entries = [
        (MODULE.DT_NEEDED, 1),
        (MODULE.DT_STRTAB, 0x08048300),
        (MODULE.DT_STRSZ, len(strings)),
        (MODULE.DT_NULL, 0),
    ]
    dyn_len = len(entries) * 8
    struct.pack_into("<IIIIIIII", data, 84, 2, 0x100, 0x08048100, 0, dyn_len, dyn_len, 6, 4)
    for index, (tag, value) in enumerate(entries):
        struct.pack_into("<II", data, 0x100 + index * 8, tag, value)
    data[0x300:0x300 + len(strings)] = strings
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
    def test_contract_is_loader_bound_discovery_only(self):
        contract = MODULE.load_contract()
        inspection = contract["inspection"]
        self.assertEqual(contract["status"], "discovery-only-not-promotable")
        self.assertTrue(inspection["stage_manifest_binding_required"])
        self.assertTrue(inspection["elf_identity_match_required"])
        self.assertTrue(inspection["rooted_symlink_resolution_required"])
        self.assertTrue(inspection["elf_loader_search_path_required"])
        self.assertTrue(inspection["musl_system_path_required"])
        self.assertFalse(inspection["ambient_ld_library_path_allowed"])
        self.assertFalse(inspection["host_readelf_allowed"])
        self.assertFalse(inspection["network_allowed"])
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def test_elf_parser_extracts_needed_identity_and_runpath(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sample"
            path.write_bytes(synthetic_elf64(runpath=b"$ORIGIN/../lib"))
            info = MODULE.parse_elf_dynamic(path)
            self.assertEqual(info["dt_needed"], ["libexample.so.1"])
            self.assertEqual(info["class"], 64)
            self.assertEqual(info["machine"], 62)
            self.assertEqual(info["endianness"], "little")
            self.assertEqual(info["runpath"], "$ORIGIN/../lib")
            self.assertIsNone(info["rpath"])

    def test_elf_parser_rejects_path_bearing_needed_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "sample"
            path.write_bytes(synthetic_elf64(b"../libevil.so"))
            with self.assertRaises(MODULE.RuntimeDependencyError):
                MODULE.parse_dt_needed(path)

    def test_runpath_supersedes_rpath_and_expands_origin(self):
        with tempfile.TemporaryDirectory() as temp:
            rootfs = Path(temp)
            consumer = MODULE.parse_elf_dynamic(
                _write(
                    rootfs / "consumer",
                    synthetic_elf64(rpath=b"/wrong", runpath=b"$ORIGIN/../lib:/usr/lib"),
                )
            )
            search = MODULE.loader_search_directories("usr/bin/wine", consumer, rootfs)
            self.assertEqual(search[0], {"directory": "usr/lib", "source": "DT_RUNPATH"})
            self.assertNotIn({"directory": "wrong", "source": "DT_RPATH"}, search)

    def test_unknown_loader_token_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            rootfs = Path(temp)
            consumer = MODULE.parse_elf_dynamic(
                _write(rootfs / "consumer", synthetic_elf64(runpath=b"$LIB/wine"))
            )
            with self.assertRaisesRegex(MODULE.RuntimeDependencyError, "unsupported loader token"):
                MODULE.loader_search_directories("usr/bin/wine", consumer, rootfs)

    def test_musl_path_file_is_authoritative_over_builtin_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            rootfs = Path(temp)
            config = rootfs / "etc/ld-musl-x86_64.path"
            config.parent.mkdir(parents=True)
            config.write_text("/custom/lib:/usr/lib\n", encoding="utf-8")
            consumer = MODULE.parse_elf_dynamic(_write(rootfs / "consumer", synthetic_elf64()))
            search = MODULE.musl_system_search_directories(rootfs, consumer)
            self.assertEqual(
                search,
                [
                    {"directory": "custom/lib", "source": "/etc/ld-musl-x86_64.path"},
                    {"directory": "usr/lib", "source": "/etc/ld-musl-x86_64.path"},
                ],
            )

    def test_loader_does_not_pick_same_soname_from_unsearched_stage_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            consumer_path = _write(stage / "usr/bin/wine", synthetic_elf64(runpath=b"$ORIGIN/../lib"))
            _write(stage / "opt/decoy/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            external = _write(rootfs / "usr/lib/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            self.assertTrue(external.is_file())
            consumer = MODULE.parse_elf_dynamic(consumer_path)
            resolved, search = MODULE.resolve_loader_dependency(
                MODULE.build_soname_index(stage),
                MODULE.build_soname_index(rootfs),
                "libexample.so.1",
                consumer,
                "usr/bin/wine",
                rootfs,
            )
            self.assertEqual(search[0]["directory"], "usr/lib")
            self.assertEqual(resolved["scope"], "rootfs-external")
            self.assertEqual(resolved["path"], "usr/lib/libexample.so.1")

    def test_loader_selects_stage_candidate_at_first_search_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            consumer_path = _write(stage / "usr/bin/wine", synthetic_elf64(runpath=b"$ORIGIN/../wine-libs:/usr/lib"))
            _write(stage / "usr/wine-libs/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            _write(rootfs / "usr/lib/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            consumer = MODULE.parse_elf_dynamic(consumer_path)
            resolved, _ = MODULE.resolve_loader_dependency(
                MODULE.build_soname_index(stage),
                MODULE.build_soname_index(rootfs),
                "libexample.so.1",
                consumer,
                "usr/bin/wine",
                rootfs,
            )
            self.assertEqual(resolved["scope"], "stage-internal")
            self.assertEqual(resolved["search_directory"], "/usr/wine-libs")
            self.assertEqual(resolved["search_source"], "DT_RUNPATH")

    def test_loader_rejects_cross_scope_collision_at_same_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            consumer_path = _write(stage / "usr/bin/wine", synthetic_elf64(runpath=b"/usr/lib"))
            _write(stage / "usr/lib/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            _write(rootfs / "usr/lib/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            consumer = MODULE.parse_elf_dynamic(consumer_path)
            with self.assertRaisesRegex(MODULE.RuntimeDependencyError, "cross-scope loader collision"):
                MODULE.resolve_loader_dependency(
                    MODULE.build_soname_index(stage),
                    MODULE.build_soname_index(rootfs),
                    "libexample.so.1",
                    consumer,
                    "usr/bin/wine",
                    rootfs,
                )

    def test_candidate_directory_is_scoped_by_elf_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            lib64 = _write(root / "usr/lib64/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            lib32 = _write(root / "usr/lib32/libexample.so.1", synthetic_elf32(b"libc.so.6"))
            index = MODULE.build_soname_index(root)
            consumer64 = MODULE.parse_elf_dynamic(lib64)
            consumer32 = MODULE.parse_elf_dynamic(lib32)
            self.assertEqual(
                MODULE.candidates_in_directory(index, "libexample.so.1", consumer64, "usr/lib64", "test")["path"],
                "usr/lib64/libexample.so.1",
            )
            self.assertEqual(
                MODULE.candidates_in_directory(index, "libexample.so.1", consumer32, "usr/lib32", "test")["path"],
                "usr/lib32/libexample.so.1",
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
            "canonical_path": "usr/lib/libexample.so.1",
        }
        owners = {"usr/lib/libexample.so.1": ("example-libs", "1.2.3-r4")}
        self.assertEqual(
            MODULE.require_single_apk_owner(candidate, owners),
            ("example-libs", "1.2.3-r4"),
        )

    def test_stage_binding_recomputes_exact_full_build_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            stage = Path(temp) / "stage"
            payload = stage / "usr/lib/wine/sample.so"
            payload.parent.mkdir(parents=True)
            payload.write_bytes(b"exact-stage-bytes")
            proof = {"staging": stage_metadata(stage)}
            self.assertEqual(MODULE.verify_stage_binding(stage, proof), proof["staging"]["canonical_manifest_sha256"])

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


def _write(path: Path, content: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


if __name__ == "__main__":
    unittest.main()
