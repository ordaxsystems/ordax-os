import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROBE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_generated_source_probe.py"
GUARD_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_generated_source_makefile_guard.py"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


PROBE = load_module("runtime_generated_source_probe", PROBE_PATH)
GUARD = load_module("runtime_generated_source_makefile_guard", GUARD_PATH)


class GeneratedSourceInventoryTests(unittest.TestCase):
    def test_contract_keeps_dynamic_runtime_and_promotion_boundaries_closed(self):
        contract = PROBE.load_contract()
        inspection = contract["inspection"]
        self.assertTrue(inspection["all_materialized_build_tree_c_required"])
        self.assertTrue(inspection["makedep_generated_c_semantics_required"])
        self.assertTrue(inspection["every_built_object_c_prerequisite_accounted"])
        self.assertFalse(inspection["unmaterialized_c_prerequisite_for_built_object_allowed"])
        self.assertTrue(all(value is False for value in contract["open_boundaries"].values()))
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def test_function_body_ignores_braces_inside_comments_and_literals(self):
        text = '''
static void sample(void)
{
    const char *value = "}";
    /* } */
    if (1) { value = "{"; }
}
'''
        body = PROBE.function_body(text, "static void sample")
        self.assertIn('value = "}"', body)
        self.assertIn('if (1)', body)

    def test_generated_loader_call_uses_same_source_parser(self):
        calls = PROBE.DYNAMIC.scan_text(
            "build-output/generated.c",
            'void f(void) { dlopen("libgenerated.so", 0); }\n',
            {"dlopen": 0, "dlmopen": 1},
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["target"]["kind"], "static-string")
        self.assertEqual(calls[0]["path"], "build-output/generated.c")

    def test_makefile_graph_accounts_archive_and_materialized_generated_c(self):
        with tempfile.TemporaryDirectory() as temp:
            build = Path(temp)
            (build / "dlls/example").mkdir(parents=True)
            (build / "dlls/example/generated.o").write_bytes(b"o")
            (build / "dlls/example/source.o").write_bytes(b"o")
            makefile = '''
dlls/example/generated.c: dlls/example/input.y
dlls/example/generated.o: dlls/example/generated.c
dlls/example/source.o: ../wine-source/wine-11.0/dlls/example/source.c
dlls/disabled/missing.o: dlls/disabled/missing.c
'''
            result = GUARD.validate_compiled_c_graph(
                makefile,
                build,
                {"dlls/example/source.c": {"size": 1, "sha256": "0" * 64}},
                {"dlls/example/generated.c"},
                "wine-11.0",
            )
            self.assertEqual(result["built_object_rules"], 2)
            self.assertEqual(result["compiled_c_edges"], 2)
            self.assertEqual(result["archive_source_c_edges"], 1)
            self.assertEqual(result["materialized_generated_c_edges"], 1)
            self.assertEqual(result["generated_c_prerequisites"], ["dlls/example/generated.c"])

    def test_missing_generated_c_for_built_object_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            build = Path(temp)
            (build / "dlls/example").mkdir(parents=True)
            (build / "dlls/example/generated.o").write_bytes(b"o")
            makefile = "dlls/example/generated.o: dlls/example/generated.c\n"
            with self.assertRaisesRegex(
                GUARD.GeneratedSourceMakefileGuardError,
                "outside archive/materialized build inventory",
            ):
                GUARD.validate_compiled_c_graph(makefile, build, {}, set(), "wine-11.0")

    def test_missing_generated_c_for_unbuilt_object_does_not_create_false_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            build = Path(temp)
            makefile = '''
dlls/disabled/generated.o: dlls/disabled/generated.c
dlls/live/source.o: ../wine-source/wine-11.0/dlls/live/source.c
'''
            (build / "dlls/live").mkdir(parents=True)
            (build / "dlls/live/source.o").write_bytes(b"o")
            result = GUARD.validate_compiled_c_graph(
                makefile,
                build,
                {"dlls/live/source.c": {"size": 1, "sha256": "0" * 64}},
                set(),
                "wine-11.0",
            )
            self.assertEqual(result["built_object_rules"], 1)
            self.assertEqual(result["archive_source_c_edges"], 1)
            self.assertEqual(result["materialized_generated_c_edges"], 0)

    def test_source_reference_normalization_is_bounded(self):
        self.assertEqual(
            GUARD.normalize_source_reference(
                "../wine-source/wine-11.0/dlls/example/source.c", "wine-11.0"
            ),
            "dlls/example/source.c",
        )
        self.assertIsNone(GUARD.normalize_source_reference("../../escape.c", "wine-11.0"))
        self.assertIsNone(GUARD.normalize_source_reference("/absolute/source.c", "wine-11.0"))

    def test_external_build_c_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            build = root / "build"
            source = root / "source"
            outside = root / "outside.c"
            build.mkdir()
            source.mkdir()
            outside.write_text("int x;\n", encoding="utf-8")
            link = build / "generated.c"
            link.symlink_to(outside)
            with self.assertRaisesRegex(PROBE.GeneratedSourceProofError, "escapes build/source roots"):
                PROBE.resolve_c_symlink(link, build, source)


if __name__ == "__main__":
    unittest.main()
