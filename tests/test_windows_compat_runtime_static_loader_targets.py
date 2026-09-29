import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_static_loader_target_classifier.py"
SPEC = importlib.util.spec_from_file_location("runtime_static_loader_target_classifier", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"


class StaticLoaderTargetTests(unittest.TestCase):
    def fixture(self):
        contract = MODULE.load_contract()
        callsites, line = [], 10
        for rule in contract["rules"]:
            for _ in range(rule["expected_callsites"]):
                callsites.append({
                    "path": rule["path"], "line": line, "column": 5, "api": "dlopen", "target_argument_index": 0,
                    "target": {"kind": "static-string", "expression": rule["expression"], "literal_tokens": [rule["expression"]]},
                })
                line += 1
        counts = {
            "c_archive_members_scanned": 4276, "c_source_bytes": 190498971,
            "direct_loader_calls": len(callsites), "static_string_targets": len(callsites),
            "configured_soname_symbol_targets": 0, "dynamic_expression_targets": 0, "null_targets": 0,
            "calls_by_api": {"dlmopen": 0, "dlopen": len(callsites)}, "configured_soname_symbols": {},
        }
        core = {
            "runtime_id": RUNTIME, "source_archive_sha256": "a"*64, "source_proof_sha256": "b"*64,
            "c_archive_manifest_sha256": "c"*64, "counts": counts, "callsites": callsites,
        }
        return {
            "$schema": "prototype-ordax.windows-compat-runtime-dynamic-load-source-proof/1", **core,
            "inventory_sha256": MODULE.canonical_sha256(core),
            "gates": {
                "source_lock_verified": True, "source_proof_verified": True, "c_archive_manifest_bound": True,
                "direct_host_loader_calls_inventoried": True, "dynamic_load_inventory_complete": False,
                "external_transitive_closure_verified": False, "runtime_dependency_inventory_complete": False,
                "binary_artifact_pinned": False, "activation_authorized": False, "execution_authorized": False,
                "wine_executed": False, "windows_payload_executed": False,
            },
        }

    def rehash(self, proof):
        proof["inventory_sha256"] = MODULE.canonical_sha256(MODULE.dynamic_source_core(proof))

    def test_classifies_all_static_targets_without_claiming_linux_reachability(self):
        result = MODULE.classify(self.fixture())
        self.assertEqual(result["counts"]["static_callsites"], 6)
        self.assertEqual(result["counts"]["classification_rules"], 5)
        self.assertEqual(result["counts"]["host_platforms"], {"android": 5, "macos": 1})
        self.assertEqual(result["counts"]["categories"], {"android-host-library": 4, "macos-framework": 1, "ntdll-bootstrap-path": 1})
        self.assertFalse(result["gates"]["linux_build_reachability_verified"])
        self.assertFalse(result["gates"]["static_target_runtime_resolution_complete"])
        self.assertFalse(result["gates"]["dynamic_load_inventory_complete"])

    def test_rejects_unknown_static_target_even_with_valid_digest(self):
        proof = self.fixture()
        proof["callsites"][0]["target"]["expression"] = '"libunknown.so"'
        self.rehash(proof)
        with self.assertRaisesRegex(MODULE.StaticTargetClassificationError, "unclassified static loader target"):
            MODULE.classify(proof)

    def test_rejects_missing_rule_observation(self):
        proof = self.fixture(); proof["callsites"].pop(); proof["counts"]["direct_loader_calls"] -= 1; proof["counts"]["static_string_targets"] -= 1; proof["counts"]["calls_by_api"]["dlopen"] -= 1; self.rehash(proof)
        with self.assertRaisesRegex(MODULE.StaticTargetClassificationError, "rule cardinality drifted"):
            MODULE.classify(proof)

    def test_rejects_static_dlmopen_until_modeled(self):
        proof = self.fixture(); proof["callsites"][0]["api"] = "dlmopen"; proof["counts"]["calls_by_api"] = {"dlmopen":1,"dlopen":5}; self.rehash(proof)
        with self.assertRaisesRegex(MODULE.StaticTargetClassificationError, "unmodeled static loader API"):
            MODULE.classify(proof)

    def test_rejects_stale_digest(self):
        proof = self.fixture(); proof["callsites"][0]["line"] += 1
        with self.assertRaisesRegex(MODULE.StaticTargetClassificationError, "digest does not verify"):
            MODULE.classify(proof)

    def test_rejects_scope_overclaim_outside_digest(self):
        proof = self.fixture(); proof["gates"]["dynamic_load_inventory_complete"] = True
        with self.assertRaisesRegex(MODULE.StaticTargetClassificationError, "forbidden boundary"):
            MODULE.classify(proof)


if __name__ == "__main__":
    unittest.main()
