import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_computed_loader_source_authority_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_computed_loader_source_authority_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class RuntimeComputedSourceAuthorityTests(unittest.TestCase):
    def rule(self):
        return {
            "id": "fixture-rule",
            "path": "fixture.c",
            "expression": "name",
            "control_source": "fixture-source",
            "source_semantics": "caller-input-controls-name",
            "required_code_fragments": [
                "const char *name = args;",
                "dlopen( name, RTLD_NOW )",
            ],
        }

    def classification(self):
        return {
            "path": "fixture.c",
            "line": 5,
            "column": 10,
            "api": "dlopen",
            "expression": "name",
            "rule_id": "fixture-rule",
            "category": "fixture",
            "control_source": "fixture-source",
        }

    def source(self):
        return """
        static void load(void *args)
        {
            const char *name = args;
            void *handle = dlopen( name, RTLD_NOW );
            (void)handle;
        }
        """

    def test_contract_keeps_all_runtime_resolution_boundaries_open(self):
        contract = MODULE.load_contract()
        self.assertEqual(len(contract["rules"]), 10)
        self.assertEqual(len({rule["id"] for rule in contract["rules"]}), 10)
        self.assertTrue(contract["verification"]["comments_must_not_satisfy_semantic_anchors"])
        self.assertTrue(contract["verification"]["each_rule_must_reobserve_exact_direct_dlopen"])
        self.assertFalse(contract["verification"]["runtime_value_resolution_complete"])
        self.assertTrue(all(value is False for value in contract["open_boundaries"].values()))
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def test_ntdll_so_name_authority_models_internal_callers_not_one_producer(self):
        contract = MODULE.load_contract()
        rule = next(item for item in contract["rules"] if item["id"] == "ntdll-so-name")
        self.assertEqual(rule["control_source"], "ntdll-internal-dlopen-dll-callers")
        fragments = set(rule["required_code_fragments"])
        self.assertIn("status = dlopen_dll( unix_name, nt_name, params->module, &info, FALSE );", fragments)
        self.assertIn("status = dlopen_dll( name, attr->ObjectName, module, &info, prefer_native );", fragments)
        self.assertIn("status = dlopen_dll( name, nt_name, module, &pe_info, FALSE );", fragments)

    def test_valid_source_reobserves_call_and_semantic_anchors(self):
        result = MODULE.verify_rule_source(self.rule(), self.classification(), self.source())
        self.assertTrue(result["direct_dlopen_reobserved"])
        self.assertEqual(result["control_source"], "fixture-source")
        self.assertEqual(len(result["semantic_fragments"]), 2)
        self.assertTrue(all(item["match_count"] == 1 for item in result["semantic_fragments"]))

    def test_comment_only_anchor_cannot_satisfy_source_authority(self):
        source = """
        static void load(void *args)
        {
            /* const char *name = args; */
            void *handle = dlopen( name, RTLD_NOW );
            (void)handle;
        }
        """
        with self.assertRaisesRegex(MODULE.ComputedSourceAuthorityError, "semantic fragment cardinality drifted"):
            MODULE.verify_rule_source(self.rule(), self.classification(), source)

    def test_duplicate_matching_dlopen_fails_closed(self):
        source = self.source().replace(
            "void *handle = dlopen( name, RTLD_NOW );",
            "void *handle = dlopen( name, RTLD_NOW );\nvoid *other = dlopen( name, RTLD_NOW );",
        )
        with self.assertRaisesRegex(MODULE.ComputedSourceAuthorityError, "exactly one classified direct dlopen"):
            MODULE.verify_rule_source(self.rule(), self.classification(), source)

    def test_classification_control_source_drift_fails_closed(self):
        classification = self.classification()
        classification["control_source"] = "wrong-source"
        with self.assertRaisesRegex(MODULE.ComputedSourceAuthorityError, "control_source drifted"):
            MODULE.verify_rule_source(self.rule(), classification, self.source())

    def test_source_semantic_fragment_cardinality_is_exact(self):
        source = self.source().replace(
            "const char *name = args;",
            "const char *name = args;\nconst char *name_copy = args; /* distinct, should not match */",
        )
        result = MODULE.verify_rule_source(self.rule(), self.classification(), source)
        self.assertEqual(result["semantic_fragments"][0]["match_count"], 1)


if __name__ == "__main__":
    unittest.main()
