import importlib.util
from pathlib import Path
import tempfile
import unittest

from tests.test_windows_compat_runtime_dependency_closure import (
    MODULE as CLOSURE,
    direct_proof,
    full_build_proof,
    synthetic_elf64,
    write,
    write_apk_database,
)

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_closure_loader_guard.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_closure_loader_guard", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def direct_evidence(full: dict, direct: dict) -> dict:
    core = {
        "runtime_id": direct["runtime_id"],
        "staging_manifest_sha256": direct["staging_manifest_sha256"],
        "first_hit_validation_sha256": "1" * 64,
        "loader_invariance_validation_sha256": "2" * 64,
        "dependency_inventory_sha256": direct["inventory_sha256"],
        "dependency_counts": direct["counts"],
        "first_hit_counts": {"dependencies_checked": 1, "stage_hits": 0, "rootfs_hits": 1},
        "loader_invariance_counts": {
            "staged_elf_files": direct["counts"]["elf_files"],
            "needed_identity_soname_pairs": 1,
            "reachable_candidate_pathnames": 1,
        },
    }
    return {
        "$schema": "prototype-ordax.windows-compat-runtime-dependency-evidence-proof/1",
        "status": "staged-runtime-dependency-evidence-verified-not-runtime-promoted",
        **core,
        "evidence_sha256": MODULE.DIRECT.canonical_sha256(core),
        "gates": {
            "full_build_proof_verified": True,
            "first_pathname_hit_verified": True,
            "staged_needed_by_chain_invariance_verified": True,
            "staged_shortname_reuse_invariance_verified": True,
            "loader_resolution_verified": True,
            "staging_dependency_inventory_complete": True,
            "external_transitive_closure_verified": False,
            "runtime_dependency_inventory_complete": False,
            "runtime_package_content_hashes_pinned": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        },
    }


class RuntimeDependencyClosureGuardTests(unittest.TestCase):
    def test_guard_verifies_every_transitive_first_hit_without_promoting_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64((b"liba.so.1",)))
            write(rootfs / "usr/lib/liba.so.1", synthetic_elf64((b"libb.so.1",)))
            write(rootfs / "usr/lib/libb.so.1", synthetic_elf64())
            write_apk_database(rootfs, [("usr/lib", "liba.so.1"), ("usr/lib", "libb.so.1")])
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            evidence = direct_evidence(full, direct)
            closure = CLOSURE.discover(stage, rootfs, full, direct)
            proof = MODULE.verify(stage, rootfs, full, direct, evidence, closure)
            self.assertEqual(proof["counts"]["edges_checked"], 2)
            self.assertEqual(proof["counts"]["rootfs_hits"], 2)
            self.assertTrue(proof["gates"]["closure_first_pathname_hit_verified"])
            self.assertTrue(proof["gates"]["closure_shortname_reuse_invariance_verified"])
            self.assertFalse(proof["gates"]["dynamic_load_inventory_complete"])
            self.assertFalse(proof["gates"]["runtime_dependency_inventory_complete"])

    def test_non_elf_first_pathname_cannot_be_skipped_by_raw_closure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64((b"libparent.so.1",)))
            write(rootfs / "usr/lib/libparent.so.1", synthetic_elf64((b"libchild.so.1",)))
            write(rootfs / "lib/libchild.so.1", b"not an ELF")
            write(rootfs / "usr/lib/libchild.so.1", synthetic_elf64())
            write_apk_database(
                rootfs,
                [("usr/lib", "libparent.so.1"), ("usr/lib", "libchild.so.1")],
            )
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            evidence = direct_evidence(full, direct)
            closure = CLOSURE.discover(stage, rootfs, full, direct)
            with self.assertRaisesRegex(MODULE.ClosureLoaderGuardError, "non-ELF first pathname"):
                MODULE.verify(stage, rootfs, full, direct, evidence, closure)

    def test_loaded_shortname_target_must_be_globally_invariant(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/a", synthetic_elf64((b"libparent-a.so.1",), rpath=b"/opt/a"))
            write(stage / "usr/bin/b", synthetic_elf64((b"libparent-b.so.1",), rpath=b"/opt/b"))
            write(rootfs / "usr/lib/libparent-a.so.1", synthetic_elf64((b"libshared.so.1",)))
            write(rootfs / "usr/lib/libparent-b.so.1", synthetic_elf64((b"libshared.so.1",)))
            write(rootfs / "opt/a/libshared.so.1", synthetic_elf64())
            write(rootfs / "opt/b/libshared.so.1", synthetic_elf64())
            write_apk_database(
                rootfs,
                [
                    ("usr/lib", "libparent-a.so.1"),
                    ("usr/lib", "libparent-b.so.1"),
                    ("opt/a", "libshared.so.1"),
                    ("opt/b", "libshared.so.1"),
                ],
            )
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            evidence = direct_evidence(full, direct)
            closure = CLOSURE.discover(stage, rootfs, full, direct)
            with self.assertRaisesRegex(MODULE.ClosureLoaderGuardError, "loaded-shortname/context state"):
                MODULE.verify(stage, rootfs, full, direct, evidence, closure)

    def test_wine_bootstrap_shortname_is_preserved_through_raw_and_guarded_closure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(
                stage / "usr/lib/wine/x86_64-unix/avicap32.so",
                synthetic_elf64((b"ntdll.so",)),
            )
            write(
                stage / "usr/lib/wine/x86_64-unix/ntdll.so",
                synthetic_elf64((b"libc.so.6",)),
            )
            write(rootfs / "usr/lib/libc.so.6", synthetic_elf64())
            write_apk_database(rootfs, [("usr/lib", "libc.so.6")])
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            evidence = direct_evidence(full, direct)
            closure = CLOSURE.discover(stage, rootfs, full, direct)
            bootstrap_edges = [
                edge
                for context in closure["contexts"].values()
                for edge in context["edges"]
                if edge["soname"] == "ntdll.so"
            ]
            self.assertTrue(bootstrap_edges)
            self.assertTrue(all(edge["resolution_kind"] == "bootstrap-shortname-reuse" for edge in bootstrap_edges))
            self.assertTrue(all(edge["search_directory"] is None for edge in bootstrap_edges))
            proof = MODULE.verify(stage, rootfs, full, direct, evidence, closure)
            self.assertGreater(proof["counts"]["stage_hits"], 0)
            self.assertTrue(proof["gates"]["closure_shortname_reuse_invariance_verified"])

    def test_bootstrap_shortname_conflicting_reachable_pathname_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(
                stage / "usr/lib/wine/x86_64-unix/avicap32.so",
                synthetic_elf64((b"ntdll.so",)),
            )
            write(
                stage / "usr/lib/wine/x86_64-unix/ntdll.so",
                synthetic_elf64((b"libc.so.6",)),
            )
            write(rootfs / "usr/lib/libc.so.6", synthetic_elf64())
            write(rootfs / "usr/lib/ntdll.so", synthetic_elf64())
            write_apk_database(rootfs, [("usr/lib", "libc.so.6"), ("usr/lib", "ntdll.so")])
            full = full_build_proof(stage)
            direct = direct_proof(stage, rootfs, full)
            evidence = direct_evidence(full, direct)
            closure = CLOSURE.discover(stage, rootfs, full, direct)
            with self.assertRaisesRegex(MODULE.ClosureLoaderGuardError, "bootstrap shortname target conflicts"):
                MODULE.verify(stage, rootfs, full, direct, evidence, closure)


if __name__ == "__main__":
    unittest.main()
