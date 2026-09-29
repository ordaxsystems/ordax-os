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

    def test_contract_is_discovery_only_and_non_executable(self):
        self.assertEqual(self.contract["status"], "lock-discovery-required")
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

    def test_discovery_contract_validation_passes_but_no_lock_is_authoritative(self):
        loaded = self.discovery.load_contract()
        self.assertEqual(loaded["runtime_id"], "wine-11.0-wow64-x86_64-v1")
        self.assertFalse(loaded["apk_locks_pinned"])
        self.assertEqual(loaded["build_apk_package_lock"], {})
        self.assertEqual(loaded["runtime_apk_package_lock"], {})


if __name__ == "__main__":
    unittest.main()
