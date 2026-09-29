import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_loader_wrapper_discovery_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_loader_wrapper_discovery_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class LoaderWrapperDiscoveryTests(unittest.TestCase):
    def functions(self, sources):
        result = []
        for path, text in sources.items():
            result.extend(MODULE.parse_functions(path, text))
        return result

    def test_maps_direct_loader_call_to_exact_top_level_function(self):
        text = """
static void helper(void)
{
    if (1) { int x = 0; (void)x; }
    dlopen(name, 0);
}
"""
        funcs = MODULE.parse_functions("a.c", text)
        self.assertEqual(len(funcs), 1)
        self.assertEqual(funcs[0]["name"], "helper")
        self.assertTrue(funcs[0]["static"])
        line = next(i for i, value in enumerate(text.splitlines(), 1) if "dlopen" in value)
        column = text.splitlines()[line - 1].index("dlopen") + 1
        dynamic = {
            "callsites": [{
                "path": "a.c", "line": line, "column": column, "api": "dlopen",
                "target": {"kind": "dynamic-expression", "expression": "name"},
            }],
            "counts": {"direct_loader_calls": 1},
        }
        mapped, direct = MODULE.map_direct_calls(dynamic, {"a.c": text}, {"a.c": funcs})
        self.assertEqual(len(mapped), 1)
        self.assertEqual(len(direct), 1)
        self.assertEqual(mapped[0]["function_name"], "helper")

    def test_preprocessor_logical_lines_do_not_define_c_structure(self):
        text = r'''#define CHUNK_BEGIN() \
    do {                 \
        do
#define CHUNK_END         \
        while (0);        \
    } while (0)

static void helper(void)
{
    dlopen(name, 0);
}
'''
        lexical = MODULE.DYNAMIC.lexical_views(text)[1]
        structural = MODULE.structural_code_view(lexical)
        self.assertEqual(len(structural), len(text))
        self.assertNotIn("do {", structural[: structural.index("static void")])
        funcs = MODULE.parse_functions("macro.c", text)
        self.assertEqual([(item["name"], item["static"]) for item in funcs], [("helper", True)])

    def test_conditional_branches_do_not_create_impossible_combined_braces(self):
        text = '''
static void helper(int x
#ifdef FEATURE
    , int y
#endif
    )
{
#ifdef FEATURE
    for (;;) {
#else
    if (x) {
#endif
        consume(x);
    }
    dlopen(name, 0);
}
'''
        funcs = MODULE.parse_functions("conditional.c", text)
        self.assertEqual(len(funcs), 1)
        self.assertEqual(funcs[0]["name"], "helper")
        line = next(i for i, value in enumerate(text.splitlines(), 1) if "dlopen" in value)
        column = text.splitlines()[line - 1].index("dlopen") + 1
        dynamic = {
            "callsites": [{
                "path": "conditional.c", "line": line, "column": column, "api": "dlopen",
                "target": {"kind": "dynamic-expression", "expression": "name"},
            }],
            "counts": {"direct_loader_calls": 1},
        }
        mapped, _ = MODULE.map_direct_calls(dynamic, {"conditional.c": text}, {"conditional.c": funcs})
        self.assertEqual(mapped[0]["function_name"], "helper")

    def test_unmatched_conditional_directive_fails_closed(self):
        with self.assertRaisesRegex(MODULE.LoaderWrapperDiscoveryError, "unmatched preprocessor #endif"):
            MODULE.structural_code_view("#endif\n", "broken.c")
        with self.assertRaisesRegex(MODULE.LoaderWrapperDiscoveryError, "unterminated conditional"):
            MODULE.structural_code_view("#ifdef X\nint x;\n", "broken.c")

    def test_static_callee_is_translation_unit_scoped(self):
        sources = {
            "a.c": "static void load(void) { dlopen(name, 0); }\nvoid local(void) { load(); }\n",
            "b.c": "static void load(void) { other(); }\nvoid foreign(void) { load(); }\n",
        }
        funcs = self.functions(sources)
        direct = next(f for f in funcs if f["path"] == "a.c" and f["name"] == "load")
        wrappers, edges, ambiguous = MODULE.discover_named_graph(
            funcs, {MODULE.function_key(direct): MODULE.function_identity(direct)}
        )
        self.assertEqual(ambiguous, [])
        self.assertEqual({item["name"] for item in wrappers}, {"local"})
        self.assertFalse(any("foreign" in edge["caller_key"] for edge in edges))

    def test_unique_global_callee_can_be_followed_cross_translation_unit(self):
        sources = {
            "a.c": "void load(void) { dlopen(name, 0); }\n",
            "b.c": "static void wrapper(void) { load(); }\n",
        }
        funcs = self.functions(sources)
        direct = next(f for f in funcs if f["path"] == "a.c" and f["name"] == "load")
        wrappers, edges, ambiguous = MODULE.discover_named_graph(
            funcs, {MODULE.function_key(direct): MODULE.function_identity(direct)}
        )
        self.assertEqual(ambiguous, [])
        self.assertEqual([item["name"] for item in wrappers], ["wrapper"])
        self.assertEqual(len(edges), 1)

    def test_ambiguous_global_name_is_recorded_not_guessed(self):
        sources = {
            "a.c": "void load(void) { dlopen(name, 0); }\n",
            "b.c": "void load(void) { other(); }\n",
            "c.c": "void wrapper(void) { load(); }\n",
        }
        funcs = self.functions(sources)
        direct = next(f for f in funcs if f["path"] == "a.c" and f["name"] == "load")
        wrappers, edges, ambiguous = MODULE.discover_named_graph(
            funcs, {MODULE.function_key(direct): MODULE.function_identity(direct)}
        )
        self.assertEqual(wrappers, [])
        self.assertEqual(edges, [])
        self.assertEqual(ambiguous, ["load"])

    def test_named_wrappers_are_followed_to_fixpoint(self):
        sources = {
            "a.c": "static void load(void) { dlopen(name, 0); }\nstatic void w1(void) { load(); }\nstatic void w2(void) { w1(); }\n",
        }
        funcs = self.functions(sources)
        direct = next(f for f in funcs if f["name"] == "load")
        wrappers, edges, ambiguous = MODULE.discover_named_graph(
            funcs, {MODULE.function_key(direct): MODULE.function_identity(direct)}
        )
        self.assertEqual(ambiguous, [])
        self.assertEqual({item["name"] for item in wrappers}, {"w1", "w2"})
        self.assertEqual(len(edges), 2)

    def test_direct_loader_call_outside_function_fails_closed(self):
        text = "void *p = dlopen(name, 0);\n"
        dynamic = {
            "callsites": [{
                "path": "a.c", "line": 1, "column": 11, "api": "dlopen",
                "target": {"kind": "dynamic-expression", "expression": "name"},
            }],
            "counts": {"direct_loader_calls": 1},
        }
        with self.assertRaisesRegex(MODULE.LoaderWrapperDiscoveryError, "exactly one top-level function"):
            MODULE.map_direct_calls(dynamic, {"a.c": text}, {"a.c": MODULE.parse_functions("a.c", text)})

    def test_contract_keeps_unproven_boundaries_closed(self):
        contract = MODULE.load_contract()
        self.assertFalse(contract["discovery"]["function_pointer_aliases_complete"])
        self.assertFalse(contract["discovery"]["macro_expansion_call_graph_complete"])
        self.assertFalse(contract["discovery"]["conditional_preprocessor_call_graph_complete"])
        self.assertFalse(contract["discovery"]["generated_source_inventory_complete"])
        self.assertFalse(contract["discovery"]["wrapper_call_graph_complete"])
        self.assertFalse(contract["discovery"]["dynamic_load_inventory_complete"])
        self.assertTrue(all(value is False for value in contract["promotion"].values()))


if __name__ == "__main__":
    unittest.main()
