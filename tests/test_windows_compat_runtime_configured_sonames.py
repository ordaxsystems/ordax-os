import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dynamic_load_configure_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_dynamic_load_configure_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"


class ConfiguredSonameResolutionTests(unittest.TestCase):
    def dynamic_source(self, symbols=None):
        symbols = symbols or {"SONAME_LIBFOO": 2, "SONAME_LIBBAR": 1}
        callsites = []
        line = 10
        for symbol, count in sorted(symbols.items()):
            for _ in range(count):
                callsites.append(
                    {
                        "path": "dlls/example.c",
                        "line": line,
                        "column": 5,
                        "api": "dlopen",
                        "target_argument_index": 0,
                        "target": {
                            "kind": "configured-soname-symbol",
                            "expression": symbol,
                            "symbol": symbol,
                        },
                    }
                )
                line += 1
        counts = {
            "c_archive_members_scanned": 1,
            "c_source_bytes": 100,
            "direct_loader_calls": sum(symbols.values()),
            "static_string_targets": 0,
            "configured_soname_symbol_targets": sum(symbols.values()),
            "dynamic_expression_targets": 0,
            "null_targets": 0,
            "calls_by_api": {"dlmopen": 0, "dlopen": sum(symbols.values())},
            "configured_soname_symbols": dict(sorted(symbols.items())),
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

    def configure_proof(self, packages=None):
        packages = packages or {"libfoo": "1-r0"}
        return {
            "$schema": "prototype-ordax.windows-compat-configure-proof/1",
            "runtime_id": RUNTIME,
            "wine_version": "11.0",
            "configure_proof_passed": True,
            "package_versions_pinned": False,
            "full_build_proof_passed": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "resolved_installed_packages": dict(sorted(packages.items())),
        }

    def write_elf64(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        data = bytearray(64)
        data[:4] = b"\x7fELF"
        data[4] = 2
        data[5] = 1
        data[6] = 1
        struct.pack_into("<H", data, 18, 62)
        struct.pack_into("<Q", data, 32, 64)
        struct.pack_into("<H", data, 54, 56)
        struct.pack_into("<H", data, 56, 0)
        path.write_bytes(data)

    def make_rootfs(self, root: Path, include_foo=True):
        database = root / "lib/apk/db/installed"
        database.parent.mkdir(parents=True, exist_ok=True)
        records = ["P:libfoo", "V:1-r0"]
        if include_foo:
            self.write_elf64(root / "usr/lib/libfoo.so.1")
            records.extend(["F:usr/lib", "R:libfoo.so.1"])
        database.write_text("\n".join(records) + "\n\n", encoding="utf-8")

    def test_resolves_defined_symbol_and_records_disabled_symbol(self):
        with tempfile.TemporaryDirectory() as tmp:
            rootfs = Path(tmp) / "rootfs"
            self.make_rootfs(rootfs)
            config_h = Path(tmp) / "config.h"
            config_h.write_text(
                '#define SONAME_LIBFOO "libfoo.so.1"\n'
                '/* #undef SONAME_LIBBAR */\n',
                encoding="utf-8",
            )
            result = MODULE.resolve(
                self.dynamic_source(), self.configure_proof(), config_h, rootfs
            )
            foo = result["symbols"]["SONAME_LIBFOO"]
            bar = result["symbols"]["SONAME_LIBBAR"]
            self.assertEqual(foo["state"], "defined")
            self.assertEqual(foo["soname"], "libfoo.so.1")
            self.assertEqual(foo["path"], "usr/lib/libfoo.so.1")
            self.assertEqual(foo["package"], "libfoo")
            self.assertEqual(foo["version"], "1-r0")
            self.assertEqual(bar["state"], "disabled-by-configure")
            self.assertEqual(result["counts"]["defined_symbols"], 1)
            self.assertEqual(result["counts"]["disabled_symbols"], 1)
            self.assertEqual(result["counts"]["defined_callsites"], 2)
            self.assertEqual(result["counts"]["disabled_callsites"], 1)
            self.assertTrue(result["gates"]["configured_soname_values_resolved"])
            self.assertTrue(result["gates"]["configured_soname_rootfs_resolution_verified"])
            self.assertFalse(result["gates"]["runtime_computed_target_resolution_complete"])
            self.assertFalse(result["gates"]["dynamic_load_inventory_complete"])
            self.assertFalse(result["gates"]["execution_authorized"])

    def test_rejects_requested_symbol_missing_from_config_h(self):
        with tempfile.TemporaryDirectory() as tmp:
            rootfs = Path(tmp) / "rootfs"
            self.make_rootfs(rootfs)
            config_h = Path(tmp) / "config.h"
            config_h.write_text('#define SONAME_LIBFOO "libfoo.so.1"\n', encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ConfiguredSonameError, "missing from config.h"):
                MODULE.resolve(self.dynamic_source(), self.configure_proof(), config_h, rootfs)

    def test_rejects_defined_soname_without_rootfs_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            rootfs = Path(tmp) / "rootfs"
            self.make_rootfs(rootfs, include_foo=False)
            config_h = Path(tmp) / "config.h"
            config_h.write_text(
                '#define SONAME_LIBFOO "libfoo.so.1"\n'
                '/* #undef SONAME_LIBBAR */\n',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(MODULE.ConfiguredSonameError, "no rootfs pathname"):
                MODULE.resolve(self.dynamic_source(), self.configure_proof(), config_h, rootfs)

    def test_rejects_dynamic_source_tampering_with_stale_digest(self):
        proof = self.dynamic_source()
        proof["callsites"][0]["target"]["symbol"] = "SONAME_TAMPERED"
        with self.assertRaisesRegex(MODULE.ConfiguredSonameError, "digest does not verify"):
            MODULE.validate_dynamic_source_proof(proof, MODULE.load_contract())

    def test_rejects_rootfs_package_graph_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            rootfs = Path(tmp) / "rootfs"
            self.make_rootfs(rootfs)
            config_h = Path(tmp) / "config.h"
            config_h.write_text(
                '#define SONAME_LIBFOO "libfoo.so.1"\n'
                '/* #undef SONAME_LIBBAR */\n',
                encoding="utf-8",
            )
            configure = self.configure_proof({"libfoo": "2-r0"})
            with self.assertRaisesRegex(MODULE.ConfiguredSonameError, "package graph"):
                MODULE.resolve(self.dynamic_source(), configure, config_h, rootfs)

    def test_rejects_unsafe_configured_soname(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_h = Path(tmp) / "config.h"
            config_h.write_text(
                '#define SONAME_LIBFOO "../libfoo.so.1"\n'
                '/* #undef SONAME_LIBBAR */\n',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(MODULE.ConfiguredSonameError, "unsafe configured SONAME"):
                MODULE.parse_config_h(config_h, {"SONAME_LIBFOO": 1, "SONAME_LIBBAR": 1})


if __name__ == "__main__":
    unittest.main()
