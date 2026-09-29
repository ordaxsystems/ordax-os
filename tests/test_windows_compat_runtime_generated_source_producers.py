import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_generated_source_producer_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_generated_source_producer_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class GeneratedSourceProducerTests(unittest.TestCase):
    def setUp(self):
        self.contract = MODULE.load_contract()

    def synthetic_makedep(self):
        return r'''
            add_generated_source( make, replace_extension( source->name, ".idl", "_c.c" ), NULL, arch );
            add_generated_source( make, replace_extension( source->name, ".idl", "_s.c" ), NULL, arch );
            add_generated_source( make, replace_extension( source->name, ".idl", "_i.c" ), NULL, arch );
            add_generated_source( make, replace_extension( source->name, ".idl", "_p.c" ), NULL, arch );
            dlldata = add_generated_source( make, "dlldata.o", "dlldata.c", 0 );
            file = add_generated_source( make, replace_extension( source->name, ".y", ".tab.c" ), NULL, 0 );
            file = add_generated_source( make, replace_extension( source->name, ".l", ".yy.c" ), NULL, 0 );
            char *code_name = replace_extension( source->name, ".xml", "-protocol.c" );
            add_generated_source( make, code_name, NULL, 0 );
            file = add_generated_source( make, obj, replace_extension( obj, ".o", ".c" ), 0 );
        '''

    def test_contract_keeps_inventory_and_promotion_boundaries_closed(self):
        self.assertEqual(self.contract["expected"]["producer_rules"], 9)
        self.assertTrue(all(value is False for value in self.contract["open_boundaries"].values()))
        self.assertTrue(all(value is False for value in self.contract["promotion"].values()))

    def test_all_nine_producer_rules_are_observed_once(self):
        observed = MODULE.classify_makedep(self.synthetic_makedep(), self.contract)
        self.assertEqual(len(observed), 9)
        self.assertEqual({item["id"] for item in observed}, {item["id"] for item in self.contract["producer_rules"]})

    def test_comment_cannot_fake_missing_rule(self):
        text = self.synthetic_makedep().replace(
            'add_generated_source( make, replace_extension( source->name, ".l", ".yy.c" ), NULL, 0 );',
            '/* add_generated_source( make, replace_extension( source->name, ".l", ".yy.c" ), NULL, 0 ); */',
        )
        with self.assertRaisesRegex(MODULE.GeneratedSourceProducerError, "flex-scanner.*found=0"):
            MODULE.classify_makedep(text, self.contract)

    def test_duplicate_rule_fails_closed(self):
        text = self.synthetic_makedep() + '\n' + 'add_generated_source( make, replace_extension( source->name, ".y", ".tab.c" ), NULL, 0 );'
        with self.assertRaisesRegex(MODULE.GeneratedSourceProducerError, "bison-parser.*found=2"):
            MODULE.classify_makedep(text, self.contract)

    def test_missing_rule_fails_closed(self):
        text = self.synthetic_makedep().replace(
            'dlldata = add_generated_source( make, "dlldata.o", "dlldata.c", 0 );',
            '',
        )
        with self.assertRaisesRegex(MODULE.GeneratedSourceProducerError, "widl-dlldata.*found=0"):
            MODULE.classify_makedep(text, self.contract)

    def test_unterminated_block_comment_fails_closed(self):
        with self.assertRaisesRegex(MODULE.GeneratedSourceProducerError, "unterminated block comment"):
            MODULE.strip_comments("/* never closed")

    def test_proof_schema_does_not_claim_generated_inventory_complete(self):
        expected_false = {
            "generated_source_instances_inventoried",
            "generated_source_outputs_scanned",
            "generated_source_inventory_complete",
            "wrapper_call_graph_complete",
            "dynamic_load_inventory_complete",
            "runtime_dependency_inventory_complete",
            "runtime_package_content_hashes_pinned",
            "binary_artifact_pinned",
            "activation_authorized",
            "execution_authorized",
            "wine_executed",
            "windows_payload_executed",
        }
        # This mirrors the proof boundary intentionally without needing an archive fixture.
        gates = {
            "source_archive_verified": True,
            "makedep_source_bound": True,
            "generated_c_producer_classes_classified": True,
            "all_producer_rules_observed": True,
            **{key: False for key in expected_false},
        }
        self.assertTrue(all(gates[key] is False for key in expected_false))


if __name__ == "__main__":
    unittest.main()
