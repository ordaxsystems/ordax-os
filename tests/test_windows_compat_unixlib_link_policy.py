import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / "bootstrap/windows-compat-runtime/unixlib_link_policy.py"

spec = importlib.util.spec_from_file_location("ordax_windows_compat_unixlib_link_policy", POLICY_PATH)
policy = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(policy)


class WindowsCompatibilityUnixlibLinkPolicyTests(unittest.TestCase):
    def test_contract_is_fail_closed_and_not_promotable(self):
        contract = policy.load_contract()
        self.assertEqual(contract["source_authority"]["configure_assignment_count"], 1)
        self.assertEqual(contract["source_authority"]["configure_ac_assignment_count"], 1)
        self.assertEqual(contract["policy"]["runpath"], "$ORIGIN")
        self.assertEqual(contract["policy"]["preflight_target"], "dlls/winevulkan/winevulkan.so")
        self.assertEqual(contract["policy"]["staged_target"], "usr/lib/wine/x86_64-unix/winevulkan.so")
        self.assertTrue(contract["policy"]["dt_rpath_forbidden"])
        self.assertFalse(contract["policy"]["ambient_ld_library_path_allowed"])
        self.assertFalse(contract["policy"]["global_wine_library_path_allowed"])
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def test_source_policy_replaces_exactly_one_generated_configure_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            configure = source / "configure"
            configure_ac = source / "configure.ac"
            configure.write_text(
                "before\n" + policy.CONFIGURE_ASSIGNMENT + "\nafter\n",
                encoding="utf-8",
            )
            configure_ac.write_text("before\n" + policy.CONFIGURE_AC_ASSIGNMENT + "\nafter\n", encoding="utf-8")
            evidence = policy.apply_source_policy(source)
            patched = configure.read_text(encoding="utf-8")
            self.assertEqual(evidence["replacement_count"], 1)
            self.assertEqual(patched.count(policy.PATCHED_CONFIGURE_ASSIGNMENT), 1)
            self.assertNotIn(policy.CONFIGURE_ASSIGNMENT, patched)
            self.assertEqual(len(evidence["configure_original_sha256"]), 64)
            self.assertEqual(len(evidence["configure_patched_sha256"]), 64)
            self.assertNotEqual(evidence["configure_original_sha256"], evidence["configure_patched_sha256"])

    def test_source_policy_rejects_configure_anchor_count_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            (source / "configure").write_text(
                policy.CONFIGURE_ASSIGNMENT + "\n" + policy.CONFIGURE_ASSIGNMENT + "\n",
                encoding="utf-8",
            )
            (source / "configure.ac").write_text(policy.CONFIGURE_AC_ASSIGNMENT + "\n", encoding="utf-8")
            with self.assertRaisesRegex(policy.UnixlibLinkPolicyError, "anchor count drifted"):
                policy.apply_source_policy(source)

    def test_source_policy_rejects_missing_configure_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            (source / "configure").write_text("no unixldflags assignment\n", encoding="utf-8")
            (source / "configure.ac").write_text(policy.CONFIGURE_AC_ASSIGNMENT + "\n", encoding="utf-8")
            with self.assertRaisesRegex(policy.UnixlibLinkPolicyError, "anchor count drifted"):
                policy.apply_source_policy(source)

    def test_source_policy_rejects_configure_ac_authority_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            (source / "configure").write_text(
                policy.CONFIGURE_ASSIGNMENT + "\n",
                encoding="utf-8",
            )
            (source / "configure.ac").write_text("AC_SUBST(UNIXLDFLAGS,[drift])\n", encoding="utf-8")
            with self.assertRaisesRegex(policy.UnixlibLinkPolicyError, "configure.ac.*count drifted"):
                policy.apply_source_policy(source)

    def test_generated_makefile_requires_only_origin_runpath(self):
        with tempfile.TemporaryDirectory() as tmp:
            makefile = Path(tmp) / "Makefile"
            makefile.write_text(
                "UNIXLDFLAGS = -shared -Wl,-Bsymbolic -Wl,-soname,$(UNIXLIB) "
                + policy.GENERATED_RUNPATH_TOKEN
                + " -Wl,-z,defs\n",
                encoding="utf-8",
            )
            evidence = policy.verify_generated_makefile(makefile)
            self.assertEqual(evidence["runpath_token"], policy.GENERATED_RUNPATH_TOKEN)
            self.assertIn("$ORIGIN", evidence["unixldflags"])

    def test_generated_makefile_rejects_global_or_extra_rpath(self):
        with tempfile.TemporaryDirectory() as tmp:
            makefile = Path(tmp) / "Makefile"
            makefile.write_text(
                "UNIXLDFLAGS = -shared " + policy.GENERATED_RUNPATH_TOKEN + " -Wl,-rpath,/usr/lib/wine/x86_64-unix\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(policy.UnixlibLinkPolicyError, "unexpected rpath"):
                policy.verify_generated_makefile(makefile)

    def test_generated_makefile_rejects_ld_library_path_inside_unixldflags(self):
        with tempfile.TemporaryDirectory() as tmp:
            makefile = Path(tmp) / "Makefile"
            makefile.write_text(
                "UNIXLDFLAGS = -shared " + policy.GENERATED_RUNPATH_TOKEN + " LD_LIBRARY_PATH=/tmp/fake\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(policy.UnixlibLinkPolicyError, "LD_LIBRARY_PATH"):
                policy.verify_generated_makefile(makefile)

    def test_generated_makefile_allows_unrelated_upstream_ld_library_path_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            makefile = Path(tmp) / "Makefile"
            makefile.write_text(
                "UNIXLDFLAGS = -shared " + policy.GENERATED_RUNPATH_TOKEN + "\n"
                "TEST_ENV = LD_LIBRARY_PATH=/upstream/test-only\n",
                encoding="utf-8",
            )
            evidence = policy.verify_generated_makefile(makefile)
            self.assertEqual(evidence["runpath_token"], policy.GENERATED_RUNPATH_TOKEN)

    def test_preflight_rejects_non_elf(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "winevulkan.so"
            path.write_bytes(b"not-elf")
            with self.assertRaisesRegex(policy.UnixlibLinkPolicyError, "not ELF"):
                policy.verify_preflight_elf(path)

    def test_staged_rejects_non_elf_independently(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "winevulkan.so"
            path.write_bytes(b"not-elf")
            with self.assertRaisesRegex(policy.UnixlibLinkPolicyError, "not ELF"):
                policy.verify_staged_elf(path)

    def test_final_evidence_binds_preflight_and_staged_bytes_without_claiming_runtime_readiness(self):
        source = {
            "configure_original_sha256": "1" * 64,
            "configure_patched_sha256": "2" * 64,
            "configure_ac_sha256": "3" * 64,
            "configure_assignment_sha256": "4" * 64,
            "patched_assignment_sha256": "5" * 64,
            "replacement_count": 1,
        }
        generated = {
            "makefile_sha256": "6" * 64,
            "unixldflags": policy.GENERATED_RUNPATH_TOKEN,
            "runpath_token": policy.GENERATED_RUNPATH_TOKEN,
        }
        preflight = {
            "target": "dlls/winevulkan/winevulkan.so",
            "size": 1,
            "sha256": "7" * 64,
            "elf": {"class": 64, "machine": 62, "endianness": "little"},
            "dt_needed": ["win32u.so"],
            "dt_rpath": None,
            "dt_runpath": "$ORIGIN",
        }
        staged = {
            "target": "usr/lib/wine/x86_64-unix/winevulkan.so",
            "size": 2,
            "sha256": "8" * 64,
            "elf": {"class": 64, "machine": 62, "endianness": "little"},
            "dt_needed": ["win32u.so"],
            "dt_rpath": None,
            "dt_runpath": "$ORIGIN",
        }
        proof = policy.finalize_evidence(source, generated, preflight, staged)
        self.assertEqual(len(proof["evidence_sha256"]), 64)
        self.assertEqual(proof["preflight"]["sha256"], "7" * 64)
        self.assertEqual(proof["staged"]["sha256"], "8" * 64)
        self.assertTrue(proof["gates"]["dt_runpath_origin_verified"])
        self.assertTrue(proof["gates"]["staged_elf_verified"])
        changed = dict(staged)
        changed["sha256"] = "9" * 64
        changed_proof = policy.finalize_evidence(source, generated, preflight, changed)
        self.assertNotEqual(proof["evidence_sha256"], changed_proof["evidence_sha256"])
        for gate in (
            "runtime_dependency_inventory_complete",
            "runtime_package_content_hashes_pinned",
            "binary_artifact_pinned",
            "activation_authorized",
            "execution_authorized",
            "wine_executed",
            "windows_payload_executed",
        ):
            self.assertFalse(proof["gates"][gate], gate)


if __name__ == "__main__":
    unittest.main()
