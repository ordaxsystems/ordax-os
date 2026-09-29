import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dynamic_load_source_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_dynamic_load_source_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"
ARCHIVE = "c07a6857933c1fc60dff5448d79f39c92481c1e9db5aa628db9d0358446e0701"


class DynamicLoadSourceProbeTests(unittest.TestCase):
    def source_lock(self):
        return {
            "$schema": "prototype-ordax.windows-compat-runtime-source/1",
            "runtime_id": RUNTIME,
            "upstream": {"archive_sha256": ARCHIVE},
        }

    def full_build(self):
        return {
            "$schema": "prototype-ordax.windows-compat-full-build-proof/2",
            "runtime_id": RUNTIME,
            "gates": {
                "source_lock_verified": True,
                "full_build_proof_passed": True,
                "staged_install_completed": True,
                "runtime_dependency_inventory_complete": False,
                "binary_artifact_pinned": False,
                "activation_authorized": False,
                "execution_authorized": False,
                "wine_executed": False,
                "windows_payload_executed": False,
            },
        }

    def write_source(self, root: Path, content: str, name: str = "loader.c"):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_discovers_direct_calls_without_comment_or_literal_false_positives(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_source(
                root,
                r'''
                /* dlopen("ignored-comment.so", 0); */
                static const char *example = "dlopen(\"ignored-string.so\", 0)";
                void load(const char *name)
                {
                    dlopen("libfoo.so", 1);
                    dlopen("lib" "bar.so", 2);
                    dlopen(name, 3);
                    dlmopen(1, "libbaz.so", 4);
                }
                ''',
            )
            result = MODULE.discover(root, self.source_lock(), self.full_build())
            self.assertEqual(result["counts"]["direct_loader_calls"], 4)
            self.assertEqual(result["counts"]["calls_by_api"], {"dlmopen": 1, "dlopen": 3})
            self.assertEqual(result["counts"]["static_string_targets"], 3)
            self.assertEqual(result["counts"]["dynamic_expression_targets"], 1)
            self.assertEqual(result["counts"]["null_targets"], 0)
            targets = [item["target"]["kind"] for item in result["callsites"]]
            self.assertEqual(targets, ["static-string", "static-string", "dynamic-expression", "static-string"])
            self.assertFalse(result["gates"]["dynamic_load_inventory_complete"])
            self.assertFalse(result["gates"]["external_transitive_closure_verified"])
            self.assertFalse(result["gates"]["execution_authorized"])

    def test_dlmopen_uses_second_argument_as_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_source(root, 'void f(void) { dlmopen(7, target_name(), 0); }\n')
            result = MODULE.discover(root, self.source_lock(), self.full_build())
            call = result["callsites"][0]
            self.assertEqual(call["api"], "dlmopen")
            self.assertEqual(call["target_argument_index"], 1)
            self.assertEqual(call["target"], {"kind": "dynamic-expression", "expression": "target_name()"})

    def test_rejects_relevant_source_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            real = self.write_source(root, 'void f(void) { dlopen("libx.so", 0); }\n', "real.c")
            (root / "alias.c").symlink_to(real.name)
            with self.assertRaisesRegex(MODULE.DynamicLoadDiscoveryError, "symlink"):
                MODULE.discover(root, self.source_lock(), self.full_build())

    def test_rejects_loader_call_missing_modeled_target_argument(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_source(root, "void f(void) { dlmopen(7); }\n")
            with self.assertRaisesRegex(MODULE.DynamicLoadDiscoveryError, "lacks modeled target"):
                MODULE.discover(root, self.source_lock(), self.full_build())

    def test_rejects_full_build_promotion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_source(root, 'void f(void) { dlopen("libx.so", 0); }\n')
            full = self.full_build()
            full["gates"]["execution_authorized"] = True
            with self.assertRaisesRegex(MODULE.DynamicLoadDiscoveryError, "forbidden runtime boundary"):
                MODULE.discover(root, self.source_lock(), full)

    def test_manifest_and_inventory_are_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_source(root, 'void f(void) { dlopen("libx.so", 0); }\n', "b.c")
            self.write_source(root, 'void g(void) { dlopen(name, 0); }\n', "a.c")
            first = MODULE.discover(root, self.source_lock(), self.full_build())
            second = MODULE.discover(root, self.source_lock(), self.full_build())
            self.assertEqual(first["c_source_manifest_sha256"], second["c_source_manifest_sha256"])
            self.assertEqual(first["inventory_sha256"], second["inventory_sha256"])
            self.assertEqual(first["callsites"], second["callsites"])


if __name__ == "__main__":
    unittest.main()
