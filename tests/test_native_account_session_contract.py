import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_account_gateway.py"
sys.path.insert(0, str(MODULE.parent))
CONTRACT = ROOT / "docs" / "contracts" / "native-account-session.json"
GUIDE = ROOT / "docs" / "ACCOUNT-SYNC-AND-PLANS.md"

spec = importlib.util.spec_from_file_location("ordax_native_account_session_contract", MODULE)
gateway = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = gateway
spec.loader.exec_module(gateway)


class NativeAccountSessionContractTests(unittest.TestCase):
    def test_registration_policy_cannot_block_native_surface_mount(self):
        source = (ROOT / "system/composition/native/main.mjs").read_text(encoding="utf-8")
        before_mount = source.split("const surface = mountSurface(", 1)[0]
        self.assertNotIn("await identityActions.refresh()", before_mount)
        connectivity = source.split("const resumeAccountConnectivity = async", 1)[1].split("\n  };", 1)[0]
        self.assertIn("await identityActions.refresh()", connectivity)
        self.assertLess(source.index("bootScreen.ready()"), source.index("void resumeAccountConnectivity().catch"))

    def test_contract_requires_memory_only_tokens_on_removable_media(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        invariants = contract["invariants"]
        self.assertEqual(contract["status"], "kernel-memory-hot-restart-without-disk-vault")
        self.assertFalse(invariants["provider_tokens_exposed_to_surface_javascript"])
        self.assertFalse(invariants["provider_tokens_synchronized"])
        self.assertFalse(invariants["access_token_persisted_plaintext"])
        self.assertFalse(invariants["refresh_token_persisted_plaintext"])
        self.assertEqual(invariants["session_survives_native_host_restart"], "when-kernel-user-keyring-available")
        self.assertFalse(invariants["session_survives_device_reboot"])
        self.assertTrue(invariants["legacy_plaintext_session_path_is_purged_on_start"])

    def test_source_has_no_plaintext_cookie_persistence_path(self):
        source = MODULE.read_text(encoding="utf-8")
        self.assertNotIn("_persist_session", source)
        self.assertNotIn("_load_session", source)
        self.assertNotIn("json.dump", source)
        self.assertIn("_purge_legacy_plaintext_session", source)
        self.assertIn("self._cookies: dict[str, str] = {}", source)

    def test_documented_native_session_does_not_claim_plaintext_disk_persistence(self):
        guide = GUIDE.read_text(encoding="utf-8")
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        section = guide.split("## Device-private account session", 1)[1]
        self.assertIn("sole owner of access/refresh cookies **in memory**", section)
        self.assertIn("full notebook reboot clears the kernel session", section)
        self.assertIn("cleanup-only and must never be loaded", section)
        self.assertIn("docs/contracts/native-account-session.json", section)
        self.assertEqual(contract["status"], "kernel-memory-hot-restart-without-disk-vault")
        self.assertNotIn("owns an OrdaX gateway session in private device state (mode `0600`)", section)

    def test_native_usb_gateway_targets_existing_approved_platform_endpoint(self):
        # Native-only client endpoint; this does NOT approve public signup,
        # migrate the provider authority, or change the memory-only session.
        endpoint = (ROOT / "system/services/account/gateway-base-url").read_text(
            encoding="utf-8"
        ).strip()
        self.assertEqual(
            endpoint,
            "https://jhfphsjptrpmtnzkpwud.supabase.co/functions/v1/ordax-account-gateway",
        )
        self.assertEqual(gateway._validated_base_url(endpoint), endpoint)
        self.assertNotIn("eobcxuyvhkvdmkbaihwh", endpoint)

    def test_future_persistence_is_blocked_on_encrypted_vault_gate(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        gate = contract["future_persistent_session_gate"]
        self.assertFalse(gate["enabled"])
        required = set(gate["requires"])
        self.assertIn("encrypted-credential-vault", required)
        self.assertIn("authenticated-encryption", required)
        self.assertIn("physical-removable-media-threat-proof", required)
        self.assertEqual(
            gate["pin_role"],
            "unlock-local-vault-never-cloud-account-password-substitute",
        )


if __name__ == "__main__":
    unittest.main()
