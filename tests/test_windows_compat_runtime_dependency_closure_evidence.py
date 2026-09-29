import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_closure_evidence_finalize.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_closure_evidence_finalize", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"
STAGE = "a" * 64
DIRECT = "b" * 64
ROOT_NODE = "stage-internal:usr/bin/wine"
CHILD_NODE = "rootfs-external:usr/lib/liba.so.1"


class RuntimeDependencyClosureEvidenceTests(unittest.TestCase):
    def fixtures(self):
        direct_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "first_hit_validation_sha256": "1" * 64,
            "loader_invariance_validation_sha256": "2" * 64,
            "dependency_inventory_sha256": DIRECT,
            "dependency_counts": {"elf_files": 2, "external_packages": 1, "external_sonames": 2},
            "first_hit_counts": {"dependencies_checked": 1, "stage_hits": 0, "rootfs_hits": 1},
            "loader_invariance_counts": {
                "staged_elf_files": 2,
                "needed_identity_soname_pairs": 1,
                "reachable_candidate_pathnames": 1,
            },
        }
        direct = {
            "$schema": "prototype-ordax.windows-compat-runtime-dependency-evidence-proof/1",
            **direct_core,
            "evidence_sha256": MODULE.canonical_sha256(direct_core),
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
        root_context_id = MODULE.context_id([ROOT_NODE])
        child_context_id = MODULE.context_id([CHILD_NODE, ROOT_NODE])
        closure_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "direct_inventory_sha256": DIRECT,
            "roots": [ROOT_NODE],
            "nodes": {
                ROOT_NODE: {"scope": "stage-internal"},
                CHILD_NODE: {
                    "scope": "rootfs-external",
                    "package": "runtime-libs",
                    "version": "1-r0",
                },
            },
            "contexts": {
                root_context_id: {
                    "consumer": ROOT_NODE,
                    "chain": [ROOT_NODE],
                    "edges": [
                        {
                            "soname": "liba.so.1",
                            "to": CHILD_NODE,
                            "cycle": False,
                        }
                    ],
                },
                child_context_id: {
                    "consumer": CHILD_NODE,
                    "chain": [CHILD_NODE, ROOT_NODE],
                    "edges": [],
                },
            },
            "external_packages": {
                "runtime-libs": {
                    "version": "1-r0",
                    "files": {"usr/lib/liba.so.1": "usr/lib/liba.so.1"},
                    "sonames": ["liba.so.1"],
                }
            },
        }
        closure = {
            "$schema": "prototype-ordax.windows-compat-runtime-dependency-closure-proof/1",
            **closure_core,
            "closure_sha256": MODULE.canonical_sha256(closure_core),
            "counts": {
                "root_elf_files": 1,
                "nodes": 2,
                "context_states": 2,
                "edges": 1,
                "cycle_edges": 0,
                "external_packages": 1,
                "external_sonames": 1,
            },
            "gates": {
                "full_build_proof_verified": True,
                "direct_dependency_proof_verified": True,
                "direct_loader_resolution_verified": True,
                "transitive_dt_needed_closure_complete": True,
                "dynamic_load_inventory_complete": False,
                "runtime_dependency_inventory_complete": False,
                "runtime_package_content_hashes_pinned": False,
                "binary_artifact_pinned": False,
                "activation_authorized": False,
                "execution_authorized": False,
                "wine_executed": False,
                "windows_payload_executed": False,
            },
        }
        guard_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "direct_inventory_sha256": DIRECT,
            "direct_evidence_sha256": direct["evidence_sha256"],
            "closure_sha256": closure["closure_sha256"],
            "shortname_targets": {
                "ELF64:machine=62:little:liba.so.1": {
                    "scope": "rootfs-external",
                    "canonical_path": "usr/lib/liba.so.1",
                }
            },
            "counts": {
                "contexts_checked": 2,
                "edges_checked": 1,
                "stage_hits": 0,
                "rootfs_hits": 1,
                "identity_soname_pairs": 1,
            },
        }
        guard = {
            "$schema": "prototype-ordax.windows-compat-runtime-closure-loader-guard-proof/1",
            **guard_core,
            "validation_sha256": MODULE.canonical_sha256(guard_core),
            "gates": {
                "direct_authoritative_evidence_verified": True,
                "closure_first_pathname_hit_verified": True,
                "closure_shortname_reuse_invariance_verified": True,
                "closure_origin_alias_context_verified": True,
                "transitive_dt_needed_loader_semantics_verified": True,
                "dynamic_load_inventory_complete": False,
                "runtime_dependency_inventory_complete": False,
                "runtime_package_content_hashes_pinned": False,
                "binary_artifact_pinned": False,
                "activation_authorized": False,
                "execution_authorized": False,
                "wine_executed": False,
                "windows_payload_executed": False,
            },
        }
        return direct, closure, guard

    def test_finalize_binds_guarded_closure_without_claiming_dynamic_inventory(self):
        result = MODULE.finalize(*self.fixtures())
        self.assertTrue(result["gates"]["external_transitive_dt_needed_closure_verified"])
        self.assertTrue(result["gates"]["closure_context_expansion_verified"])
        self.assertTrue(result["gates"]["closure_cycle_markers_verified"])
        self.assertEqual(result["context_expansion_counts"]["reachable_contexts"], 2)
        self.assertFalse(result["gates"]["external_transitive_closure_verified"])
        self.assertFalse(result["gates"]["dynamic_load_inventory_complete"])
        self.assertFalse(result["gates"]["runtime_dependency_inventory_complete"])
        self.assertFalse(result["gates"]["execution_authorized"])

    def test_finalize_rejects_tampered_closure_with_stale_digest(self):
        direct, closure, guard = self.fixtures()
        closure["roots"].append("stage-internal:tampered")
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "raw closure digest"):
            MODULE.finalize(direct, closure, guard)

    def test_finalize_rejects_rehashed_closure_that_omits_descendant_context(self):
        direct, closure, guard = self.fixtures()
        child_id = MODULE.context_id([CHILD_NODE, ROOT_NODE])
        del closure["contexts"][child_id]
        closure["counts"]["context_states"] = 1
        core = MODULE.closure_core(closure)
        closure["closure_sha256"] = MODULE.canonical_sha256(core)
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "omitted descendant context"):
            MODULE.finalize(direct, closure, guard)

    def test_finalize_rejects_rehashed_wrong_cycle_marker(self):
        direct, closure, guard = self.fixtures()
        root_id = MODULE.context_id([ROOT_NODE])
        closure["contexts"][root_id]["edges"][0]["cycle"] = True
        closure["counts"]["cycle_edges"] = 1
        core = MODULE.closure_core(closure)
        closure["closure_sha256"] = MODULE.canonical_sha256(core)
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "cycle marker"):
            MODULE.finalize(direct, closure, guard)

    def test_finalize_rejects_tampered_guard_with_stale_digest(self):
        direct, closure, guard = self.fixtures()
        guard["counts"]["edges_checked"] = 2
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "closure loader guard digest"):
            MODULE.finalize(direct, closure, guard)

    def test_finalize_rejects_dynamic_inventory_overclaim_in_guard_without_digest_change(self):
        direct, closure, guard = self.fixtures()
        guard["gates"]["dynamic_load_inventory_complete"] = True
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "dynamic_load_inventory_complete"):
            MODULE.finalize(direct, closure, guard)

    def test_finalize_rejects_generic_external_closure_overclaim_in_direct_evidence_without_digest_change(self):
        direct, closure, guard = self.fixtures()
        direct["gates"]["external_transitive_closure_verified"] = True
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "external_transitive_closure_verified"):
            MODULE.finalize(direct, closure, guard)

    def test_finalize_rejects_runtime_promotion_in_any_input(self):
        direct, closure, guard = self.fixtures()
        closure["gates"]["runtime_dependency_inventory_complete"] = True
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "forbidden promotion"):
            MODULE.finalize(direct, closure, guard)


if __name__ == "__main__":
    unittest.main()
