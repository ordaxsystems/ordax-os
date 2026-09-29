import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "bootstrap/windows-compat-runtime/source.json"
DISCOVERY = ROOT / "bootstrap/windows-compat-runtime/discover_lock.py"
STABLE = ROOT / "bootstrap/stable-base/source.json"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class WindowsCompatRuntimeSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(SOURCE.read_text(encoding="utf-8"))
        cls.stable = json.loads(STABLE.read_text(encoding="utf-8"))
        cls.discovery = load_module("ordax_windows_compat_discovery_test", DISCOVERY)

    def test_contract_is_build_locked_but_still_non_executable(self):
        self.assertEqual(
            self.contract["status"],
            "candidate-build-locked-not-executable",
        )
        self.assertEqual(self.contract["product_scope"], "owner-development-only")
        self.assertFalse(self.contract["public_availability"])
        self.assertFalse(self.contract["stable_mvp_enabled"])
        self.assertFalse(self.contract["execution_adapter_connected"])
        self.assertFalse(self.contract["installation_adapter_connected"])
        self.assertFalse(self.contract["boot_critical"])
        self.assertFalse(self.contract["artifact"]["physical_artifact_authorized"])
        self.assertFalse(self.contract["artifact"]["release_manifest_connected"])
        self.assertFalse(self.contract["artifact"]["component_slot_connected"])

    def test_wine_source_is_exact_and_wow64_is_explicit(self):
        engine = self.contract["engine"]
        self.assertEqual(engine["id"], "wine")
        self.assertEqual(engine["version"], "11.0")
        self.assertEqual(engine["release_channel"], "stable")
        self.assertEqual(
            engine["source_sha256"],
            "c07a6857933c1fc60dff5448d79f39c92481c1e9db5aa628db9d0358446e0701",
        )
        self.assertEqual(engine["source_size_bytes"], 33172240)
        self.assertEqual(engine["windows_architectures"], ["x86", "x86_64"])
        self.assertEqual(engine["wow64_mode"], "new")
        self.assertIn("--enable-archs=i386,x86_64", engine["configure_args"])

    def test_high_risk_integrations_are_denied_until_ordax_grants_exist(self):
        security = self.contract["security"]
        self.assertFalse(security["raw_usb_passthrough_allowed"])
        self.assertFalse(security["packet_capture_allowed"])
        self.assertFalse(security["camera_passthrough_allowed"])
        self.assertFalse(security["scanner_passthrough_allowed"])
        self.assertFalse(security["printing_passthrough_allowed"])
        self.assertEqual(security["host_filesystem_authority"], "none")
        self.assertTrue(security["profile_storage_required"])
        self.assertTrue(security["sandbox_required"])
        configure = set(self.contract["engine"]["configure_args"])
        for flag in (
            "--without-usb",
            "--without-pcap",
            "--without-gphoto",
            "--without-sane",
            "--without-cups",
            "--without-v4l2",
        ):
            self.assertIn(flag, configure)

    def test_runtime_reuses_canonical_alpine_identity(self):
        alpine = self.contract["alpine"]
        canonical = self.stable["alpine"]
        for field in ("version", "branch", "arch", "archive_sha256"):
            self.assertEqual(alpine[field], canonical[field])
        self.assertEqual(alpine["identity_owner"], "bootstrap/stable-base/source.json")

    def test_reviewed_package_locks_are_complete_and_exactly_counted(self):
        self.assertTrue(self.contract["apk_locks_pinned"])
        build_lock = self.contract["build_apk_package_lock"]
        runtime_lock = self.contract["runtime_apk_package_lock"]
        self.assertEqual(self.contract["build_apk_package_lock_count"], len(build_lock))
        self.assertEqual(self.contract["runtime_apk_package_lock_count"], len(runtime_lock))
        self.assertEqual(len(build_lock), 239)
        self.assertEqual(len(runtime_lock), 97)
        self.assertTrue(set(self.contract["build_packages"]).issubset(build_lock))
        self.assertTrue(set(self.contract["runtime_packages"]).issubset(runtime_lock))
        self.assertEqual(build_lock["mingw-w64-gcc"], "14.2.0-r1")
        self.assertEqual(build_lock["i686-mingw-w64-gcc"], "14.2.0-r1")
        self.assertEqual(runtime_lock["musl"], "1.2.5-r12")
        self.assertNotIn("wine", build_lock)
        self.assertNotIn("wine", runtime_lock)

    def test_discovery_evidence_is_bound_to_reviewed_source_and_locks(self):
        evidence = self.contract["lock_discovery_evidence"]
        self.assertEqual(
            evidence["wine_source_sha256"],
            self.contract["engine"]["source_sha256"],
        )
        self.assertEqual(
            evidence["alpine_archive_sha256"],
            self.contract["alpine"]["archive_sha256"],
        )
        self.assertEqual(
            evidence["build_apk_package_lock_count"],
            self.contract["build_apk_package_lock_count"],
        )
        self.assertEqual(
            evidence["runtime_apk_package_lock_count"],
            self.contract["runtime_apk_package_lock_count"],
        )
        self.assertRegex(evidence["source_commit"], r"^[0-9a-f]{40}$")
        self.assertRegex(evidence["artifact_digest"], r"^sha256:[0-9a-f]{64}$")

    def test_revalidation_contract_accepts_only_pinned_non_executable_state(self):
        loaded = self.discovery.load_contract()
        self.assertEqual(loaded["runtime_id"], "wine-11.0-wow64-x86_64-v1")
        self.assertTrue(loaded["apk_locks_pinned"])
        self.assertEqual(len(loaded["build_apk_package_lock"]), 239)
        self.assertEqual(len(loaded["runtime_apk_package_lock"]), 97)
        self.assertFalse(loaded["execution_adapter_connected"])
        self.assertFalse(loaded["installation_adapter_connected"])


if __name__ == "__main__":
    unittest.main()
