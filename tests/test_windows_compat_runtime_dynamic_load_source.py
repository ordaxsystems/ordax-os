import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dynamic_load_source_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_dynamic_load_source_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"
ARCHIVE_SHA = "c07a6857933c1fc60dff5448d79f39c92481c1e9db5aa628db9d0358446e0701"


class DynamicLoadSourceProbeTests(unittest.TestCase):
    def source_lock(self):
        return {
            "$schema": "prototype-ordax.windows-compat-runtime-source/1",
            "runtime_id": RUNTIME,
            "upstream": {
                "archive_name": "wine-11.0.tar.xz",
                "archive_size_bytes": 33172240,
                "archive_sha256": ARCHIVE_SHA,
                "archive_root": "wine-11.0",
                "version_file_expected": "Wine version 11.0",
            },
        }

    def source_proof(self):
        return {
            "$schema": "prototype-ordax.windows-compat-source-proof/1",
            "runtime_id": RUNTIME,
            "engine": "wine",
            "version": "11.0",
            "archive_name": "wine-11.0.tar.xz",
            "archive_size_bytes": 33172240,
            "archive_sha256": ARCHIVE_SHA,
            "archive_member_count": 5000,
            "version_file_value": "Wine version 11.0",
            "build_performed": False,
            "activation_authorized": False,
            "execution_authorized": False,
        }

    def test_scan_text_ignores_comments_and_classifies_target_sources(self):
        text = r'''
        /* dlopen("ignored-comment.so", 0); */
        static const char *example = "dlopen(\"ignored-string.so\", 0)";
        void load(const char *name)
        {
            dlopen("libfoo.so", 1);
            dlopen("lib" "bar.so", 2);
            dlopen(SONAME_LIBFOO, 3);
            dlopen(name, 4);
            dlmopen(1, "libbaz.so", 5);
        }
        '''
        result = MODULE.scan_text("dlls/example.c", text, {"dlopen": 0, "dlmopen": 1})
        self.assertEqual(len(result), 5)
        self.assertEqual(
            [item["target"]["kind"] for item in result],
            [
                "static-string",
                "static-string",
                "configured-soname-symbol",
                "dynamic-expression",
                "static-string",
            ],
        )
        self.assertEqual(result[2]["target"]["symbol"], "SONAME_LIBFOO")

    def test_dlmopen_uses_second_argument_as_target(self):
        result = MODULE.scan_text(
            "dlls/example.c",
            "void f(void) { dlmopen(7, target_name(), 0); }\n",
            {"dlopen": 0, "dlmopen": 1},
        )
        self.assertEqual(
            result[0]["target"],
            {"kind": "dynamic-expression", "expression": "target_name()"},
        )
        self.assertEqual(result[0]["target_argument_index"], 1)

    def test_configured_soname_classifier_is_strict(self):
        self.assertEqual(
            MODULE.classify_target("SONAME_LIBGNUTLS"),
            {
                "kind": "configured-soname-symbol",
                "expression": "SONAME_LIBGNUTLS",
                "symbol": "SONAME_LIBGNUTLS",
            },
        )
        self.assertEqual(MODULE.classify_target("SONAME_LIBGNUTLS + 1")["kind"], "dynamic-expression")
        self.assertEqual(MODULE.classify_target("soname_libgnutls")["kind"], "dynamic-expression")

    def test_rejects_direct_loader_call_missing_target_argument(self):
        with self.assertRaisesRegex(MODULE.DynamicLoadDiscoveryError, "lacks modeled target"):
            MODULE.scan_text(
                "dlls/example.c",
                "void f(void) { dlmopen(7); }\n",
                {"dlopen": 0, "dlmopen": 1},
            )

    def test_source_proof_cannot_claim_build_or_execution(self):
        contract = MODULE.load_contract()
        proof = self.source_proof()
        proof["execution_authorized"] = True
        with self.assertRaisesRegex(MODULE.DynamicLoadDiscoveryError, "forbidden boundary"):
            MODULE.validate_source_proof(proof, self.source_lock(), contract)

    def make_archive(self, path: Path, members: dict[str, bytes], symlink: str | None = None):
        with tarfile.open(path, "w:xz") as tar:
            for name, data in members.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            if symlink:
                info = tarfile.TarInfo(symlink)
                info.type = tarfile.SYMTYPE
                info.linkname = "loader.c"
                tar.addfile(info)

    def contract_for_archive(self, archive: Path):
        contract = json.loads(json.dumps(MODULE.load_contract()))
        contract["input"]["source_archive_sha256"] = MODULE.sha256_file(archive)
        return contract

    def test_archive_member_manifest_and_inventory_are_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "wine.tar.xz"
            self.make_archive(
                archive,
                {
                    "wine-11.0/dlls/c.c": b"void h(void) { dlopen(SONAME_LIBX, 0); }\n",
                    "wine-11.0/dlls/b.c": b'void f(void) { dlopen("libx.so", 0); }\n',
                    "wine-11.0/dlls/a.c": b"void g(void) { dlopen(name, 0); }\n",
                    "wine-11.0/README": b"ignored\n",
                },
            )
            contract = self.contract_for_archive(archive)
            entries1, sources1, bytes1 = MODULE.read_relevant_members(archive, contract)
            entries2, sources2, bytes2 = MODULE.read_relevant_members(archive, contract)
            self.assertEqual(entries1, entries2)
            self.assertEqual(sources1, sources2)
            self.assertEqual(bytes1, bytes2)
            result1 = MODULE.build_inventory(
                "1" * 64,
                contract["input"]["source_archive_sha256"],
                entries1,
                sources1,
                bytes1,
                contract["inspection"]["direct_host_loader_apis"],
                RUNTIME,
            )
            result2 = MODULE.build_inventory(
                "1" * 64,
                contract["input"]["source_archive_sha256"],
                entries2,
                sources2,
                bytes2,
                contract["inspection"]["direct_host_loader_apis"],
                RUNTIME,
            )
            self.assertEqual(result1["inventory_sha256"], result2["inventory_sha256"])
            counts = result1["counts"]
            self.assertEqual(counts["direct_loader_calls"], 3)
            self.assertEqual(counts["static_string_targets"], 1)
            self.assertEqual(counts["configured_soname_symbol_targets"], 1)
            self.assertEqual(counts["dynamic_expression_targets"], 1)
            self.assertEqual(counts["configured_soname_symbols"], {"SONAME_LIBX": 1})
            self.assertTrue(result1["gates"]["configured_soname_symbols_classified"])
            self.assertFalse(result1["gates"]["configured_soname_values_resolved"])
            self.assertFalse(result1["gates"]["wrapper_call_graph_complete"])
            self.assertFalse(result1["gates"]["dynamic_load_inventory_complete"])
            self.assertFalse(result1["gates"]["external_transitive_closure_verified"])
            self.assertFalse(result1["gates"]["execution_authorized"])

    def test_rejects_relevant_source_link_in_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "wine.tar.xz"
            self.make_archive(
                archive,
                {"wine-11.0/loader.c": b'void f(void) { dlopen("libx.so", 0); }\n'},
                symlink="wine-11.0/alias.c",
            )
            contract = self.contract_for_archive(archive)
            with self.assertRaisesRegex(MODULE.DynamicLoadDiscoveryError, "source link"):
                MODULE.read_relevant_members(archive, contract)


if __name__ == "__main__":
    unittest.main()
