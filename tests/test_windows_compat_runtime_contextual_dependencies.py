import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

from tests.test_windows_compat_runtime_dependency_discovery import synthetic_elf32, synthetic_elf64

ROOT = Path(__file__).resolve().parents[1]
FIRST_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_contextual_first_hit_guard.py"
DEPENDENCY_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_contextual_probe.py"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


FIRST = load_module("runtime_dependency_contextual_first_hit_guard", FIRST_PATH)
DEPENDENCY = load_module("runtime_dependency_contextual_probe", DEPENDENCY_PATH)


def leaf_elf64(machine=62):
    data = bytearray(64)
    data[:4] = b"\x7fELF"
    data[4] = 2
    data[5] = 1
    data[6] = 1
    struct.pack_into("<H", data, 18, machine)
    struct.pack_into("<Q", data, 32, 64)
    struct.pack_into("<H", data, 54, 56)
    struct.pack_into("<H", data, 56, 0)
    return bytes(data)


def write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def stage_metadata(stage: Path):
    manifest, total = FIRST.PROBE.FULL_BUILD.staging_manifest(stage)
    return {
        "entry_count": len(manifest),
        "regular_file_count": sum(1 for item in manifest.values() if item.get("type") == "file"),
        "symlink_count": sum(1 for item in manifest.values() if item.get("type") == "symlink"),
        "total_regular_bytes": total,
        "canonical_manifest_sha256": FIRST.PROBE.FULL_BUILD.canonical_manifest_sha256(manifest),
    }


def full_proof(stage: Path):
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
            "windows_payload_executed": False,
            "wine_executed": False,
        },
    }


def invariant_record(soname, consumers, scope, canonical, candidate_paths, directories, *, bootstrap=False):
    return {
        "soname": soname,
        "elf": {"class": 64, "machine": 62, "endianness": "little"},
        "consumers": sorted(consumers),
        "directories_considered": directories,
        "bootstrap_preloaded": bootstrap,
        "target": {
            "scope": scope,
            "canonical_path": canonical,
            "candidate_paths": sorted(candidate_paths),
        },
    }


def invariance_proof(full, records, staged_elf_files):
    core = {
        "runtime_id": full["runtime_id"],
        "staging_manifest_sha256": full["staging"]["canonical_manifest_sha256"],
        "needed_targets": records,
    }
    return {
        "$schema": "prototype-ordax.windows-compat-runtime-loader-invariance-proof/1",
        **core,
        "validation_sha256": FIRST.PROBE.canonical_sha256(core),
        "counts": {
            "staged_elf_files": staged_elf_files,
            "needed_identity_soname_pairs": len(records),
            "reachable_candidate_pathnames": sum(len(item["target"]["candidate_paths"]) for item in records.values()),
            "bootstrap_shortname_pairs": sum(1 for item in records.values() if item.get("bootstrap_preloaded")),
        },
        "gates": {
            "full_build_proof_verified": True,
            "staging_manifest_verified": True,
            "staged_needed_by_chain_invariance_verified": True,
            "staged_shortname_reuse_invariance_verified": True,
            "external_transitive_closure_verified": False,
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        },
    }


class ContextualRuntimeDependencyTests(unittest.TestCase):
    def test_contract_requires_loader_invariance_for_contextual_authority(self):
        contract = FIRST.load_contract()
        self.assertTrue(contract["inspection"]["contextual_first_hit_requires_loader_invariance"])
        self.assertTrue(contract["inspection"]["contextual_dependency_inventory_requires_loader_invariance"])
        self.assertFalse(contract["inspection"]["unresolved_dependency_allowed"])

    def make_context_case(self, root: Path):
        stage = root / "stage"
        rootfs = root / "rootfs"
        rootfs.mkdir(parents=True)
        child = "usr/lib/wine/x86_64-unix/child.so"
        target = "usr/lib/wine/x86_64-unix/target.so"
        write(stage / child, synthetic_elf64(b"target.so"))
        write(stage / target, leaf_elf64())
        full = full_proof(stage)
        key = "ELF64:machine=62:little:target.so"
        records = {
            key: invariant_record(
                "target.so",
                [child],
                "stage-internal",
                target,
                [target],
                [{"directory": "/usr/lib/wine/x86_64-unix", "sources": ["DT_RPATH:/usr/bin/wine"]}],
            )
        }
        return stage, rootfs, full, invariance_proof(full, records, 2)

    def test_local_miss_resolves_only_through_bound_needed_by_invariance(self):
        with tempfile.TemporaryDirectory() as temp:
            stage, rootfs, full, invariance = self.make_context_case(Path(temp))
            result = FIRST.verify(stage, rootfs, full, invariance)
            self.assertEqual(result["counts"]["dependencies_checked"], 1)
            self.assertEqual(result["counts"]["needed_by_context_hits"], 1)
            self.assertEqual(result["counts"]["stage_hits"], 1)
            self.assertEqual(result["loader_invariance_validation_sha256"], invariance["validation_sha256"])
            self.assertTrue(result["gates"]["needed_by_context_first_hit_verified"])

    def test_non_elf_contextual_pathname_cannot_be_skipped_for_later_invariant_target(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage, rootfs, full, invariance = self.make_context_case(root)
            write(stage / "bad/target.so", b"not-elf\n")
            # Rebind full proof after intentionally adding the bad staged pathname.
            full = full_proof(stage)
            record = invariance["needed_targets"]["ELF64:machine=62:little:target.so"]
            record["directories_considered"].insert(0, {"directory": "/bad", "sources": ["DT_RPATH:/ancestor"]})
            core = {
                "runtime_id": full["runtime_id"],
                "staging_manifest_sha256": full["staging"]["canonical_manifest_sha256"],
                "needed_targets": invariance["needed_targets"],
            }
            invariance["runtime_id"] = full["runtime_id"]
            invariance["staging_manifest_sha256"] = full["staging"]["canonical_manifest_sha256"]
            invariance["validation_sha256"] = FIRST.PROBE.canonical_sha256(core)
            with self.assertRaisesRegex(FIRST.ContextualFirstHitError, "non-ELF contextual pathname"):
                FIRST.verify(stage, rootfs, full, invariance)

    def test_wrong_arch_local_first_hit_still_blocks_context_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            rootfs.mkdir(parents=True)
            child = "usr/lib/wine/x86_64-unix/child.so"
            target = "usr/lib/wine/x86_64-unix/target.so"
            write(stage / child, synthetic_elf64(b"target.so", runpath=b"/bad"))
            write(stage / target, leaf_elf64())
            write(rootfs / "bad/target.so", synthetic_elf32(b"libc.so.6"))
            full = full_proof(stage)
            key = "ELF64:machine=62:little:target.so"
            records = {
                key: invariant_record(
                    "target.so", [child], "stage-internal", target, [target],
                    [{"directory": "/usr/lib/wine/x86_64-unix", "sources": ["DT_RPATH:/ancestor"]}],
                )
            }
            invariance = invariance_proof(full, records, 2)
            with self.assertRaisesRegex(FIRST.FIRST.FirstHitGuardError, "incompatible ELF identity"):
                FIRST.verify(stage, rootfs, full, invariance)

    def test_stale_loader_invariance_digest_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            stage, rootfs, full, invariance = self.make_context_case(Path(temp))
            invariance["needed_targets"]["ELF64:machine=62:little:target.so"]["target"]["canonical_path"] = "tampered/target.so"
            with self.assertRaisesRegex(FIRST.ContextualFirstHitError, "digest does not bind"):
                FIRST.verify(stage, rootfs, full, invariance)

    def test_contextual_inventory_binds_local_and_needed_by_edges_to_same_invariance_proof(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            child = "usr/lib/wine/x86_64-unix/child.so"
            target = "usr/lib/wine/x86_64-unix/target.so"
            tool = "usr/bin/tool"
            write(stage / child, synthetic_elf64(b"target.so"))
            write(stage / target, leaf_elf64())
            write(stage / tool, synthetic_elf64(b"libext.so.1", runpath=b"/usr/lib"))
            write(rootfs / "usr/lib/libext.so.1", leaf_elf64())
            db = rootfs / "lib/apk/db/installed"
            db.parent.mkdir(parents=True)
            db.write_text("P:ext-libs\nV:1.0-r0\nF:usr/lib\nR:libext.so.1\n\n", encoding="utf-8")
            full = full_proof(stage)
            records = {
                "ELF64:machine=62:little:target.so": invariant_record(
                    "target.so", [child], "stage-internal", target, [target],
                    [{"directory": "/usr/lib/wine/x86_64-unix", "sources": ["DT_RPATH:/ancestor"]}],
                ),
                "ELF64:machine=62:little:libext.so.1": invariant_record(
                    "libext.so.1", [tool], "rootfs-external", "usr/lib/libext.so.1", ["usr/lib/libext.so.1"],
                    [{"directory": "/usr/lib", "sources": ["DT_RUNPATH:usr/bin/tool", "musl-built-in-fallback"]}],
                ),
            }
            invariance = invariance_proof(full, records, 3)
            result = DEPENDENCY.discover(stage, rootfs, full, invariance)
            self.assertEqual(result["loader_invariance_validation_sha256"], invariance["validation_sha256"])
            self.assertEqual(result["counts"]["needed_by_context_edges"], 1)
            self.assertEqual(result["counts"]["local_loader_edges"], 1)
            self.assertIn("ext-libs", result["external_packages"])
            child_resolution = result["elf_files"][child]["resolutions"][0]
            self.assertEqual(child_resolution["resolution_kind"], "loader-invariant-needed-by-context")
            self.assertIsNone(child_resolution["search_directory"])
            self.assertTrue(result["gates"]["needed_by_context_resolution_verified"])


if __name__ == "__main__":
    unittest.main()
