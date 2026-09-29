import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_computed_loader_target_classifier.py"
SPEC = importlib.util.spec_from_file_location("runtime_computed_loader_target_classifier", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"


class RuntimeComputedLoaderTargetTests(unittest.TestCase):
    def fixture(self):
        contract = MODULE.load_contract()
        callsites = []
        line = 10
        for rule in contract["rules"]:
            for _ in range(rule["expected_callsites"]):
                callsites.append(
                    {
                        "path": rule["path"],
                        "line": line,
                        "column": 5,
                        "api": "dlopen",
                        "target_argument_index": 0,
                        "target": {
                            "kind": "dynamic-expression",
                            "expression": rule["expression"],
                        },
                    }
                )
                line += 1
        counts = {
            "c_archive_members_scanned": 4276,
            "c_source_bytes": 190498971,
            "direct_loader_calls": len(callsites),
            "static_string_targets": 0,
            "configured_soname_symbol_targets": 0,
            "dynamic_expression_targets": len(callsites),
            "null_targets": 0,
            "calls_by_api": {"dlmopen": 0, "dlopen": len(callsites)},
            "configured_soname_symbols": {},
        }
        core = {
            "runtime_id": RUNTIME,
            "source_archive_sha256": "a" * 64,
            "source_proof_sha256": "b" * 64,
            "c_archive_manifest_sha256": "c" * 64,
            "counts": counts,
            "callsites": callsites,
        }
        return {
            "$schema": "prototype-ordax.windows-compat-runtime-dynamic-load-source-proof/1",
            "status": "direct-host-loader-source-sites-discovered-not-runtime-complete",
            **core,
            "inventory_sha256": MODULE.canonical_sha256(core),
            "gates": {
                "source_lock_verified": True,
                "source_proof_verified": True,
                "c_archive_manifest_bound": True,
                "direct_host_loader_calls_inventoried": True,
                "configured_soname_symbols_classified": True,
                "configured_soname_values_resolved": False,
                "wrapper_call_graph_complete": False,
                "generated_source_inventory_complete": False,
                "dynamic_load_inventory_complete": False,
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

    def rehash(self, proof):
        proof["inventory_sha256"] = MODULE.canonical_sha256(MODULE.dynamic_source_core(proof))

    def test_classifies_all_reviewed_runtime_computed_targets(self):
        result = MODULE.classify(self.fixture())
        self.assertEqual(result["counts"]["runtime_computed_callsites"], 10)
        self.assertEqual(result["counts"]["classification_rules"], 10)
        self.assertEqual(
            result["counts"]["categories"],
            {
                "caller-provided-library": 1,
                "environment-override-or-configured-fallback": 1,
                "ntdll-bootstrap-path": 5,
                "ntdll-internal-module-path": 2,
                "plugin-module-path": 1,
            },
        )
        self.assertTrue(result["gates"]["all_runtime_computed_targets_classified"])
        self.assertTrue(result["gates"]["all_classification_rules_observed"])
        self.assertFalse(result["gates"]["runtime_computed_target_resolution_complete"])
        self.assertFalse(result["gates"]["dynamic_load_inventory_complete"])
        self.assertFalse(result["gates"]["execution_authorized"])

    def test_ntdll_so_name_control_source_models_all_internal_callers(self):
        contract = MODULE.load_contract()
        rule = next(item for item in contract["rules"] if item["id"] == "ntdll-so-name")
        self.assertEqual(rule["control_source"], "ntdll-internal-dlopen-dll-callers")

    def test_rejects_unknown_runtime_expression_even_with_valid_digest(self):
        proof = self.fixture()
        proof["callsites"][0]["target"]["expression"] = "unknown_runtime_value"
        self.rehash(proof)
        with self.assertRaisesRegex(MODULE.ComputedTargetClassificationError, "unclassified runtime-computed target"):
            MODULE.classify(proof)

    def test_rejects_missing_reviewed_rule_observation(self):
        proof = self.fixture()
        proof["callsites"].pop()
        proof["counts"]["direct_loader_calls"] -= 1
        proof["counts"]["dynamic_expression_targets"] -= 1
        proof["counts"]["calls_by_api"]["dlopen"] -= 1
        self.rehash(proof)
        with self.assertRaisesRegex(MODULE.ComputedTargetClassificationError, "rule cardinality drifted"):
            MODULE.classify(proof)

    def test_rejects_runtime_computed_dlmopen_until_modeled(self):
        proof = self.fixture()
        proof["callsites"][0]["api"] = "dlmopen"
        proof["counts"]["calls_by_api"] = {"dlmopen": 1, "dlopen": 9}
        self.rehash(proof)
        with self.assertRaisesRegex(MODULE.ComputedTargetClassificationError, "unmodeled runtime-computed loader API"):
            MODULE.classify(proof)

    def test_rejects_stale_dynamic_source_digest(self):
        proof = self.fixture()
        proof["callsites"][0]["line"] += 1
        with self.assertRaisesRegex(MODULE.ComputedTargetClassificationError, "digest does not verify"):
            MODULE.classify(proof)

    def test_rejects_dynamic_source_scope_overclaim_outside_digest(self):
        proof = self.fixture()
        proof["gates"]["dynamic_load_inventory_complete"] = True
        with self.assertRaisesRegex(MODULE.ComputedTargetClassificationError, "forbidden boundary"):
            MODULE.classify(proof)


if __name__ == "__main__":
    unittest.main()
