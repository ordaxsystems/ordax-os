import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_evidence_finalize.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_evidence_finalize", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"
STAGE = "a" * 64
PRELOAD = "c" * 64


class RuntimeDependencyEvidenceTests(unittest.TestCase):
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
            "gates": {
                "full_build_proof_passed": True,
                "staged_install_completed": True,
                **forbidden,
            },
        }
        first_counts = {
            "dependencies_checked": 1,
            "stage_hits": 0,
            "rootfs_hits": 1,
            "bootstrap_shortname_hits": 0,
            "dependency_attach_preload_hits": 0,
        }
        first_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "unixlib_preload_source_evidence_sha256": PRELOAD,
            "counts": first_counts,
        }
        first = {
            "$schema": "prototype-ordax.windows-compat-runtime-first-hit-proof/1",
            **first_core,
            "validation_sha256": MODULE.canonical_sha256(first_core),
            "gates": {
                "source_derived_unixlib_preload_runtime_verified": True,
                "first_pathname_hit_verified": True,
                **forbidden,
            },
        }
        needed_targets = {
            "ELF64:machine=62:little:libexample.so.1": {
                "soname": "libexample.so.1",
                "elf": {"class": 64, "machine": 62, "endianness": "little"},
                "consumers": ["usr/bin/wine"],
                "consumer_resolution_kinds": {"usr/bin/wine": "loader-pathname"},
                "directories_considered": [{"directory": "/usr/lib", "sources": ["musl-fallback"]}],
                "bootstrap_preloaded": False,
                "dependency_attach_preload_observed": False,
                "target": {
                    "scope": "rootfs-external",
                    "canonical_path": "usr/lib/libexample.so.1",
                    "candidate_paths": ["usr/lib/libexample.so.1"],
                },
            }
        }
        invariance_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "unixlib_preload_source_evidence_sha256": PRELOAD,
            "needed_targets": needed_targets,
        }
        invariance = {
            "$schema": "prototype-ordax.windows-compat-runtime-loader-invariance-proof/1",
            **invariance_core,
            "validation_sha256": MODULE.canonical_sha256(invariance_core),
            "counts": {
                "staged_elf_files": 1,
                "needed_identity_soname_pairs": 1,
                "reachable_candidate_pathnames": 1,
                "bootstrap_shortname_pairs": 0,
                "dependency_attach_preload_pairs": 0,
                "dependency_attach_preload_consumers": 0,
            },
            "gates": {
                "source_derived_unixlib_preload_runtime_verified": True,
                "staged_needed_by_chain_invariance_verified": True,
                "staged_shortname_reuse_invariance_verified": True,
                "external_transitive_closure_verified": False,
                **forbidden,
            },
        }
        elf_files = {
            "usr/bin/wine": {
                "elf": {"class": 64, "machine": 62, "endianness": "little"},
                "dt_needed": ["libexample.so.1"],
                "rpath": None,
                "runpath": None,
                "loader_search": [{"directory": "/usr/lib", "source": "musl-fallback"}],
                "resolutions": [{
                    "soname": "libexample.so.1",
                    "scope": "rootfs-external",
                    "path": "usr/lib/libexample.so.1",
                    "canonical_path": "usr/lib/libexample.so.1",
                    "resolution_kind": "loader-pathname",
                    "package": "example-libs",
                    "version": "1.0-r0",
                    "search_directory": "/usr/lib",
                    "search_source": "musl-fallback",
                    "search_position": 0,
                }],
            }
        }
        external_packages = {
            "example-libs": {
                "version": "1.0-r0",
                "files": {"usr/lib/libexample.so.1": "libexample.so.1"},
                "sonames": ["libexample.so.1"],
            }
        }
        dependency_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "elf_files": elf_files,
            "external_packages": external_packages,
        }
        dependency = {
            "$schema": "prototype-ordax.windows-compat-runtime-dependency-proof/1",
            **dependency_core,
            "inventory_sha256": MODULE.canonical_sha256(dependency_core),
            "counts": {"elf_files": 1, "external_packages": 1, "external_sonames": 1},
            "gates": {
                "loader_resolution_verified": True,
                "staging_dependency_inventory_complete": True,
                "runtime_package_content_hashes_pinned": False,
                **forbidden,
            },
        }
        return full, first, invariance, dependency

    def test_finalize_binds_all_loader_evidence_without_promoting_runtime(self):
        full, first, invariance, dependency = self.fixtures()
        result = MODULE.finalize(full, first, invariance, dependency)
        self.assertEqual(result["$schema"], MODULE.PROOF_SCHEMA)
        self.assertEqual(result["runtime_id"], RUNTIME)
        self.assertEqual(result["staging_manifest_sha256"], STAGE)
        self.assertEqual(result["dependency_inventory_sha256"], dependency["inventory_sha256"])
        self.assertTrue(result["gates"]["loader_resolution_verified"])
        self.assertTrue(result["gates"]["staging_dependency_inventory_complete"])
        self.assertFalse(result["gates"]["external_transitive_closure_verified"])
        self.assertFalse(result["gates"]["runtime_dependency_inventory_complete"])

    def test_finalize_rejects_preload_source_evidence_drift(self):
        full, first, invariance, dependency = self.fixtures()
        invariance["unixlib_preload_source_evidence_sha256"] = "d" * 64
        with self.assertRaisesRegex(MODULE.DependencyEvidenceError, "preload source evidence diverged"):
            MODULE.finalize(full, first, invariance, dependency)

    def test_finalize_rejects_preload_edge_bound_to_other_source_evidence(self):
        full, first, invariance, dependency = self.fixtures()
        resolution = dependency["elf_files"]["usr/bin/wine"]["resolutions"][0]
        resolution.update({
            "resolution_kind": "source-proven-dependency-attach-preload",
            "unixlib_preload_source_evidence_sha256": "d" * 64,
            "preload_relation": {"link_name": "example", "consumer_module": "wine", "provider_module": "example"},
        })
        core = {
            "runtime_id": dependency["runtime_id"],
            "staging_manifest_sha256": dependency["staging_manifest_sha256"],
            "elf_files": dependency["elf_files"],
            "external_packages": dependency["external_packages"],
        }
        dependency["inventory_sha256"] = MODULE.canonical_sha256(core)
        with self.assertRaisesRegex(MODULE.DependencyEvidenceError, "preload edge is not bound"):
            MODULE.finalize(full, first, invariance, dependency)

    def test_finalize_rejects_missing_loader_invariance(self):
        full, first, invariance, dependency = self.fixtures()
        invariance["gates"]["staged_needed_by_chain_invariance_verified"] = False
        with self.assertRaisesRegex(MODULE.DependencyEvidenceError, "needed_by chain invariance"):
            MODULE.finalize(full, first, invariance, dependency)

    def test_finalize_rejects_tampered_first_hit_content_with_stale_digest(self):
        full, first, invariance, dependency = self.fixtures()
        first["counts"]["dependencies_checked"] = 2
        first["counts"]["rootfs_hits"] = 2
        with self.assertRaisesRegex(MODULE.DependencyEvidenceError, "first-hit validation digest"):
            MODULE.finalize(full, first, invariance, dependency)

    def test_finalize_rejects_tampered_loader_invariance_with_stale_digest(self):
        full, first, invariance, dependency = self.fixtures()
        target = invariance["needed_targets"]["ELF64:machine=62:little:libexample.so.1"]["target"]
        target["canonical_path"] = "usr/lib/tampered.so.1"
        with self.assertRaisesRegex(MODULE.DependencyEvidenceError, "loader-invariance validation digest"):
            MODULE.finalize(full, first, invariance, dependency)

    def test_finalize_rejects_tampered_dependency_inventory_with_stale_digest(self):
        full, first, invariance, dependency = self.fixtures()
        dependency["elf_files"]["usr/bin/wine"]["dt_needed"].append("libtampered.so.1")
        with self.assertRaisesRegex(MODULE.DependencyEvidenceError, "dependency inventory digest"):
            MODULE.finalize(full, first, invariance, dependency)

    def test_finalize_rejects_dependency_counts_not_derived_from_inventory(self):
        full, first, invariance, dependency = self.fixtures()
        dependency["counts"]["external_sonames"] = 2
        with self.assertRaisesRegex(MODULE.DependencyEvidenceError, "counts do not match canonical content"):
            MODULE.finalize(full, first, invariance, dependency)

    def test_finalize_rejects_loader_pair_count_not_derived_from_targets(self):
        full, first, invariance, dependency = self.fixtures()
        invariance["counts"]["needed_identity_soname_pairs"] = 2
        with self.assertRaisesRegex(MODULE.DependencyEvidenceError, "pair count"):
            MODULE.finalize(full, first, invariance, dependency)


if __name__ == "__main__":
    unittest.main()
