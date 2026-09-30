import copy
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

from tests.test_windows_compat_runtime_first_hit_proof import preload_source_proof

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_closure_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_closure_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)
DIRECT = MODULE.DIRECT


def synthetic_elf64(
    needed: tuple[bytes, ...] = (),
    *,
    rpath: bytes | None = None,
    runpath: bytes | None = None,
    machine: int = 62,
) -> bytes:
    size = 0x700
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

    entries: list[tuple[int, int]] = []
    for item in needed:
        entries.append((DIRECT.DT_NEEDED, add_string(item)))
    if rpath is not None:
        entries.append((DIRECT.DT_RPATH, add_string(rpath)))
    if runpath is not None:
        entries.append((DIRECT.DT_RUNPATH, add_string(runpath)))
    entries.extend([
        (DIRECT.DT_STRTAB, 0x400500),
        (DIRECT.DT_STRSZ, len(strings)),
        (DIRECT.DT_NULL, 0),
    ])
    dyn_len = len(entries) * 16
    struct.pack_into("<IIQQQQQQ", data, 120, 2, 6, 0x100, 0x400100, 0, dyn_len, dyn_len, 8)
    for index, (tag, value) in enumerate(entries):
        struct.pack_into("<QQ", data, 0x100 + index * 16, tag, value)
    data[0x500:0x500 + len(strings)] = strings
    return bytes(data)


def write(path: Path, payload: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return path


def write_apk_database(rootfs: Path, files: list[tuple[str, str]], package: str = "runtime-libs") -> None:
    grouped: dict[str, list[str]] = {}
    for directory, name in files:
        grouped.setdefault(directory, []).append(name)
    lines = [f"P:{package}", "V:1.0-r0"]
    for directory, names in grouped.items():
        lines.append(f"F:{directory}")
        lines.extend(f"R:{name}" for name in names)
    database = rootfs / "lib/apk/db/installed"
    database.parent.mkdir(parents=True, exist_ok=True)
    database.write_text("\n".join(lines) + "\n\n", encoding="utf-8")


def stage_metadata(stage: Path) -> dict:
    manifest, total = DIRECT.FULL_BUILD.staging_manifest(stage)
    return {
        "entry_count": len(manifest),
        "regular_file_count": sum(1 for item in manifest.values() if item.get("type") == "file"),
        "symlink_count": sum(1 for item in manifest.values() if item.get("type") == "symlink"),
        "total_regular_bytes": total,
        "canonical_manifest_sha256": DIRECT.FULL_BUILD.canonical_manifest_sha256(manifest),
    }


def full_build_proof(stage: Path) -> dict:
    return {
        "$schema": "prototype-ordax.windows-compat-full-build-proof/2",
        "runtime_id": "wine-11.0-wow64-x86_64-candidate",
        "staging": stage_metadata(stage),
        "gates": {
            "full_build_proof_passed": True,
            "staged_install_completed": True,
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        },
    }


def direct_proof(stage: Path, rootfs: Path, full: dict) -> dict:
    return DIRECT.discover(stage, rootfs, full, preload_source_proof())


class RuntimeDependencyClosureTests(unittest.TestCase):
    def test_contract_keeps_dt_needed_closure_separate_from_runtime_complete(self):
        contract = MODULE.load_contract()
        self.assertEqual(contract["status"], "transitive-dt-needed-discovery-only-not-promotable")
        self.assertEqual(contract["traversal"]["loader"], "musl-needed-by-chain")
        self.assertTrue(contract["traversal"]["inherit_needed_by_dynamic_paths"])
        self.assertFalse(contract["traversal"]["ambient_ld_library_path_allowed"])
        self.assertFalse(contract["classification"]["runtime_dependency_inventory_complete_after_this_gate"])
        self.assertEqual(contract["classification"]["dynamic_dlopen_inventory"], "out-of-scope-for-this-gate")
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def test_transitive_child_resolves_through_ancestor_rpath_needed_by_chain(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(
                stage / "usr/bin/wine",
                synthetic_elf64((b"libparent.so.1",), rpath=b"/opt/app/lib"),
            )
            write(rootfs / "usr/lib/libparent.so.1", synthetic_elf64((b"libchild.so.1",)))
            write(rootfs / "opt/app/lib/libchild.so.1", synthetic_elf64())
            write_apk_database(
                rootfs,
                [
                    ("usr/lib", "libparent.so.1"),
                    ("opt/app/lib", "libchild.so.1"),
                ],
            )
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            proof = MODULE.discover(stage, rootfs, full, direct)

            parent_contexts = [
                item for item in proof["contexts"].values()
                if item["consumer"] == "rootfs-external:usr/lib/libparent.so.1"
            ]
            self.assertEqual(len(parent_contexts), 1)
            child_edges = [edge for edge in parent_contexts[0]["edges"] if edge["soname"] == "libchild.so.1"]
            self.assertEqual(len(child_edges), 1)
            child = child_edges[0]
            self.assertEqual(child["canonical_path"], "opt/app/lib/libchild.so.1")
            self.assertEqual(child["search_source"], "DT_RPATH@/usr/bin/wine")
            self.assertEqual(child["needed_by_depth"], 1)
            self.assertTrue(proof["gates"]["transitive_dt_needed_closure_complete"])
            self.assertFalse(proof["gates"]["dynamic_load_inventory_complete"])
            self.assertFalse(proof["gates"]["runtime_dependency_inventory_complete"])

    def test_cycle_is_recorded_and_does_not_recurse_forever(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64((b"liba.so.1",)))
            write(rootfs / "usr/lib/liba.so.1", synthetic_elf64((b"libb.so.1",)))
            write(rootfs / "usr/lib/libb.so.1", synthetic_elf64((b"liba.so.1",)))
            write_apk_database(
                rootfs,
                [("usr/lib", "liba.so.1"), ("usr/lib", "libb.so.1")],
            )
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            proof = MODULE.discover(stage, rootfs, full, direct)
            self.assertGreaterEqual(proof["counts"]["cycle_edges"], 1)
            self.assertLess(proof["counts"]["context_states"], 10)
            self.assertTrue(
                any(
                    edge["cycle"]
                    for context in proof["contexts"].values()
                    for edge in context["edges"]
                )
            )

    def test_validly_rehashed_direct_proof_semantic_drift_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64((b"liba.so.1",)))
            write(rootfs / "usr/lib/liba.so.1", synthetic_elf64())
            write_apk_database(rootfs, [("usr/lib", "liba.so.1")])
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            tampered = copy.deepcopy(direct)
            tampered["elf_files"]["usr/bin/wine"]["resolutions"][0]["path"] = "usr/lib/not-liba.so.1"
            tampered["inventory_sha256"] = DIRECT.canonical_sha256(MODULE.direct_inventory_core(tampered))
            with self.assertRaisesRegex(MODULE.RuntimeDependencyClosureError, "disagrees on path"):
                MODULE.discover(stage, rootfs, full, tampered)

    def test_direct_inventory_digest_tampering_is_rejected_before_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64((b"liba.so.1",)))
            write(rootfs / "usr/lib/liba.so.1", synthetic_elf64())
            write_apk_database(rootfs, [("usr/lib", "liba.so.1")])
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            direct["inventory_sha256"] = "0" * 64
            with self.assertRaisesRegex(MODULE.RuntimeDependencyClosureError, "digest does not verify"):
                MODULE.discover(stage, rootfs, full, direct)

    def test_unresolved_transitive_dependency_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64((b"libparent.so.1",)))
            write(rootfs / "usr/lib/libparent.so.1", synthetic_elf64((b"libmissing.so.1",)))
            write_apk_database(rootfs, [("usr/lib", "libparent.so.1")])
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            with self.assertRaisesRegex(MODULE.RuntimeDependencyClosureError, "unresolved transitive ELF dependencies"):
                MODULE.discover(stage, rootfs, full, direct)

    def test_cross_scope_collision_in_transitive_edge_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64((b"libparent.so.1",), rpath=b"/opt/app/lib"))
            write(rootfs / "usr/lib/libparent.so.1", synthetic_elf64((b"libchild.so.1",)))
            write(stage / "opt/app/lib/libchild.so.1", synthetic_elf64())
            write(rootfs / "opt/app/lib/libchild.so.1", synthetic_elf64())
            write_apk_database(
                rootfs,
                [("usr/lib", "libparent.so.1"), ("opt/app/lib", "libchild.so.1")],
            )
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            with self.assertRaisesRegex(MODULE.RuntimeDependencyClosureError, "cross-scope loader collision"):
                MODULE.discover(stage, rootfs, full, direct)


if __name__ == "__main__":
    unittest.main()
