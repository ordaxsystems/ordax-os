import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_generated_source_trigger_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_generated_source_trigger_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class GeneratedSourceTriggerTests(unittest.TestCase):
    def contract(self):
        return MODULE.load_contract()

    def synthetic_inventory(self, makefile=None, idl=None, include_idl=True):
        makefile = makefile or """SOURCES = interface.idl parser.y scanner.l protocol.xml normal.c
EXTRA_OBJS = generated.o
"""
        idl = idl or """/* comment */
#pragma makedep client server ident proxy
interface IFoo {}
"""
        contents = {
            "Makefile.in": makefile.encode(),
            "parser.y": b"%%\n",
            "scanner.l": b"%%\n",
            "protocol.xml": b"<protocol name='x'/>\n",
        }
        members = {
            "Makefile.in": {"is_file": True, "size": len(contents["Makefile.in"])},
            "parser.y": {"is_file": True, "size": len(contents["parser.y"])},
            "scanner.l": {"is_file": True, "size": len(contents["scanner.l"])},
            "protocol.xml": {"is_file": True, "size": len(contents["protocol.xml"])},
            "normal.c": {"is_file": True, "size": 1},
        }
        if include_idl:
            contents["interface.idl"] = idl.encode()
            members["interface.idl"] = {"is_file": True, "size": len(contents["interface.idl"])}
        return MODULE.inventory_triggers(members, contents, self.contract())

    def test_contract_keeps_exact_output_and_promotion_boundaries_closed(self):
        contract = self.contract()
        self.assertFalse(contract["trigger_semantics"]["architecture_output_fanout_verified"])
        self.assertTrue(contract["trigger_semantics"]["parentsrc_fallback_required"])
        self.assertTrue(all(value is False for value in contract["open_boundaries"].values()))
        self.assertTrue(all(value is False for value in contract["promotion"].values()))
        self.assertEqual(len(contract["trigger_semantics"]["producer_ids"]), 9)

    def test_recursive_known_make_expansion_is_supported(self):
        variables = MODULE.parse_make_variables("BASE = a.idl b.y\nMORE = $(BASE) c.l\nSOURCES = $(MORE) d.xml\n")
        self.assertEqual(MODULE.split_make_tokens(MODULE.expand_make_value("SOURCES", variables), "SOURCES"), ["a.idl", "b.y", "c.l", "d.xml"])

    def test_unresolved_make_expansion_fails_closed(self):
        variables = MODULE.parse_make_variables("SOURCES = $(MISSING) foo.c\n")
        with self.assertRaisesRegex(MODULE.GeneratedSourceTriggerError, "unresolved Makefile variable"):
            MODULE.expand_make_value("SOURCES", variables)

    def test_commented_widl_pragma_does_not_create_trigger(self):
        flags = MODULE.widl_pragmas("/* #pragma makedep client */\n// #pragma makedep server\n#pragma makedep proxy\n")
        self.assertEqual(flags, {"proxy"})

    def test_all_nine_logical_trigger_classes_can_be_inventoried(self):
        records, counts = self.synthetic_inventory()
        self.assertEqual(counts["trigger_records"], 9)
        self.assertEqual(counts["trigger_source_members"], 4)
        self.assertEqual(counts["source_tokens_inspected"], 5)
        self.assertEqual(set(counts["by_producer"]), set(self.contract()["trigger_semantics"]["producer_ids"]))
        self.assertTrue(all(value == 1 for value in counts["by_producer"].values()))
        self.assertEqual(len(records), 9)

    def test_parentsrc_fallback_matches_wine_source_lookup(self):
        makefile = """PARENTSRC = ../shared
SOURCES = interface.idl
"""
        idl = b"#pragma makedep client\n"
        contents = {
            "dlls/versioned/Makefile.in": makefile.encode(),
            "dlls/shared/interface.idl": idl,
        }
        members = {
            "dlls/versioned/Makefile.in": {"is_file": True, "size": len(contents["dlls/versioned/Makefile.in"])},
            "dlls/shared/interface.idl": {"is_file": True, "size": len(idl)},
        }
        records, counts = MODULE.inventory_triggers(members, contents, self.contract())
        self.assertEqual(counts["trigger_records"], 1)
        self.assertEqual(records[0]["source"], "dlls/shared/interface.idl")
        self.assertEqual(records[0]["source_resolution"], "parentsrc")
        self.assertEqual(records[0]["logical_output"], "dlls/versioned/interface_c.c")

    def test_parentsrc_cannot_escape_archive_root(self):
        variables = MODULE.parse_make_variables("PARENTSRC = ../../../outside\n")
        members = {}
        with self.assertRaisesRegex(MODULE.GeneratedSourceTriggerError, "escapes archive root"):
            MODULE.resolve_trigger_source("dlls/versioned/Makefile.in", "interface.idl", variables, members)

    def test_missing_trigger_source_fails_closed(self):
        with self.assertRaisesRegex(MODULE.GeneratedSourceTriggerError, "IDL trigger source"):
            self.synthetic_inventory(include_idl=False)

    def test_duplicate_trigger_record_fails_closed(self):
        makefile = """SOURCES = parser.y parser.y
"""
        contents = {"Makefile.in": makefile.encode(), "parser.y": b"%%\n"}
        members = {
            "Makefile.in": {"is_file": True, "size": len(contents["Makefile.in"])},
            "parser.y": {"is_file": True, "size": len(contents["parser.y"])},
        }
        with self.assertRaisesRegex(MODULE.GeneratedSourceTriggerError, "duplicate generated source trigger"):
            MODULE.inventory_triggers(members, contents, self.contract())

    def test_producer_gate_overclaim_is_rejected_even_with_valid_digest(self):
        producer_contract = MODULE.PRODUCER.load_contract()
        rules = [{**rule, "match_offset": index} for index, rule in enumerate(producer_contract["producer_rules"])]
        core = {
            "runtime_id": self.contract()["runtime_id"],
            "source_archive_sha256": self.contract()["input"]["source_archive_sha256"],
            "makedep_path": "tools/makedep.c",
            "makedep_sha256": "a" * 64,
            "producer_rules": sorted(rules, key=lambda item: item["id"]),
        }
        gates = {
            "source_archive_verified": True,
            "makedep_source_bound": True,
            "generated_c_producer_classes_classified": True,
            "all_producer_rules_observed": True,
            "generated_source_instances_inventoried": False,
            "generated_source_outputs_scanned": False,
            "generated_source_inventory_complete": False,
            "wrapper_call_graph_complete": False,
            "dynamic_load_inventory_complete": False,
            "runtime_dependency_inventory_complete": False,
            "runtime_package_content_hashes_pinned": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        }
        proof = {"$schema": self.contract()["input"]["producer_proof_schema"], **core, "evidence_sha256": MODULE.canonical_sha256(core), "counts": {"producer_rules": 9}, "gates": gates}
        source = {"runtime_id": self.contract()["runtime_id"]}
        MODULE.validate_producer_proof(proof, self.contract(), source)
        proof["gates"]["generated_source_instances_inventoried"] = True
        with self.assertRaisesRegex(MODULE.GeneratedSourceTriggerError, "gate set drifted"):
            MODULE.validate_producer_proof(proof, self.contract(), source)

    def test_final_stage_does_not_claim_generated_output_inventory(self):
        self.assertFalse(self.contract()["open_boundaries"]["generated_source_instances_inventoried"])
        self.assertFalse(self.contract()["open_boundaries"]["generated_source_outputs_scanned"])
        self.assertFalse(self.contract()["open_boundaries"]["generated_source_inventory_complete"])


if __name__ == "__main__":
    unittest.main()
