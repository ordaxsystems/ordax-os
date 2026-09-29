import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_contextual_evidence_finalize.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_contextual_evidence_finalize", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"
STAGE = "a" * 64


class ContextualDependencyEvidenceTests(unittest.TestCase):
    def fixtures(self):
        forbidden = {
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        }
        full = {
            "$schema": "prototype-ordax.windows-compat-full-build-proof/2",
            "runtime_id": RUNTIME,
            "staging": {"canonical_manifest_sha256": STAGE},
            "gates": {"full_build_proof_passed": True, "staged_install_completed": True, **forbidden},
        }
        needed_targets = {
            "ELF64:machine=62:little:libexample.so.1": {
                "soname": "libexample.so.1",
                "elf": {"class": 64, "machine": 62, "endianness": "little"},
                "consumers": ["usr/lib/wine/consumer.so"],
                "directories_considered": [{"directory": "/usr/lib", "sources": ["musl-built-in-fallback"]}],
                "bootstrap_preloaded": False,
                "target": {
                    "scope": "rootfs-external",
                    "canonical_path": "usr/lib/libexample.so.1",
                    "candidate_paths": ["usr/lib/libexample.so.1"],
                },
            }
        }
        invariance_core = {"runtime_id": RUNTIME, "staging_manifest_sha256": STAGE, "needed_targets": needed_targets}
        invariance = {
            "$schema": "prototype-ordax.windows-compat-runtime-loader-invariance-proof/1",
            **invariance_core,
            "validation_sha256": MODULE.canonical_sha256(invariance_core),
            "counts": {
                "staged_elf_files": 1,
                "needed_identity_soname_pairs": 1,
                "reachable_candidate_pathnames": 1,
                "bootstrap_shortname_pairs": 0,
            },
            "gates": {
                "full_build_proof_verified": True,
                "staging_manifest_verified": True,
                "staged_needed_by_chain_invariance_verified": True,
                "staged_shortname_reuse_invariance_verified": True,
                "external_transitive_closure_verified": False,
                **forbidden,
            },
        }
        first_counts = {
            "dependencies_checked": 1,
            "stage_hits": 0,
            "rootfs_hits": 1,
            "bootstrap_shortname_hits": 0,
            "local_first_pathname_hits": 0,
            "needed_by_context_hits": 1,
            "invariant_pairs_reopened": 1,
            "contextual_pathnames_reopened": 1,
        }
        first_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "loader_invariance_validation_sha256": invariance["validation_sha256"],
            "counts": first_counts,
        }
        first = {
            "$schema": "prototype-ordax.windows-compat-runtime-contextual-first-hit-proof/1",
            **first_core,
            "validation_sha256": MODULE.canonical_sha256(first_core),
            "gates": {
                "full_build_proof_verified": True,
                "staging_manifest_verified": True,
                "loader_invariance_proof_verified": True,
                "first_pathname_hit_verified": True,
                "needed_by_context_first_hit_verified": True,
                **forbidden,
            },
        }
        elf_files = {
            "usr/lib/wine/consumer.so": {
                "elf": {"class": 64, "machine": 62, "endianness": "little"},
                "rpath": None,
                "runpath": None,
                "local_loader_search": [],
                "dt_needed": ["libexample.so.1"],
                "resolutions": [{
                    "soname": "libexample.so.1",
                    "scope": "rootfs-external",
                    "path": "usr/lib/libexample.so.1",
                    "candidate_paths": ["usr/lib/libexample.so.1"],
                    "canonical_path": "usr/lib/libexample.so.1",
                    "resolution_kind": "loader-invariant-needed-by-context",
                    "search_directory": None,
                    "search_source": "musl-needed-by-loader-invariance",
                    "search_position": None,
                    "loader_invariance_pair": "ELF64:machine=62:little:libexample.so.1",
                    "directories_considered": needed_targets["ELF64:machine=62:little:libexample.so.1"]["directories_considered"],
                    "package": "example-libs",
                    "version": "1.0-r0",
                }],
            }
        }
        packages = {"example-libs": {"version": "1.0-r0", "files": {"usr/lib/libexample.so.1": "libexample.so.1"}, "sonames": ["libexample.so.1"]}}
        dependency_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "loader_invariance_validation_sha256": invariance["validation_sha256"],
            "elf_files": elf_files,
            "external_packages": packages,
        }
        dependency = {
            "$schema": "prototype-ordax.windows-compat-runtime-contextual-dependency-proof/1",
            **dependency_core,
            "inventory_sha256": MODULE.canonical_sha256(dependency_core),
            "counts": {
                "elf_files": 1,
                "external_packages": 1,
                "external_sonames": 1,
                "local_loader_edges": 0,
                "bootstrap_shortname_edges": 0,
                "needed_by_context_edges": 1,
            },
            "gates": {
                "full_build_proof_verified": True,
                "loader_invariance_proof_verified": True,
                "loader_resolution_verified": True,
                "needed_by_context_resolution_verified": True,
                "staging_dependency_inventory_complete": True,
                "runtime_package_content_hashes_pinned": False,
                **forbidden,
            },
        }
        return full, first, invariance, dependency

    def test_finalize_binds_contextual_first_hit_and_inventory_to_same_invariance(self):
        full, first, invariance, dependency = self.fixtures()
        result = MODULE.finalize(full, first, invariance, dependency)
        self.assertEqual(result["loader_invariance_validation_sha256"], invariance["validation_sha256"])
        self.assertEqual(result["contextual_first_hit_validation_sha256"], first["validation_sha256"])
        self.assertEqual(result["dependency_inventory_sha256"], dependency["inventory_sha256"])
        self.assertTrue(result["gates"]["needed_by_context_first_hit_verified"])
        self.assertTrue(result["gates"]["needed_by_context_resolution_verified"])
        self.assertFalse(result["gates"]["runtime_dependency_inventory_complete"])

    def test_finalize_rejects_first_hit_bound_to_different_invariance(self):
        full, first, invariance, dependency = self.fixtures()
        first["loader_invariance_validation_sha256"] = "b" * 64
        with self.assertRaisesRegex(MODULE.ContextualDependencyEvidenceError, "not bound to loader invariance"):
            MODULE.finalize(full, first, invariance, dependency)

    def test_finalize_rejects_dependency_bound_to_different_invariance(self):
        full, first, invariance, dependency = self.fixtures()
        dependency["loader_invariance_validation_sha256"] = "b" * 64
        with self.assertRaisesRegex(MODULE.ContextualDependencyEvidenceError, "not bound to loader invariance"):
            MODULE.finalize(full, first, invariance, dependency)

    def test_finalize_rejects_tampered_contextual_inventory_with_stale_digest(self):
        full, first, invariance, dependency = self.fixtures()
        dependency["elf_files"]["usr/lib/wine/consumer.so"]["dt_needed"].append("tampered.so")
        with self.assertRaisesRegex(MODULE.ContextualDependencyEvidenceError, "canonical digest mismatch"):
            MODULE.finalize(full, first, invariance, dependency)


if __name__ == "__main__":
    unittest.main()
