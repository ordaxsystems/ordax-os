import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "dynamic-identity-capability.json"


class DynamicIdentityCapabilityContractTests(unittest.TestCase):
    def test_contract_rejects_boot_time_identity_authority_and_fallbacks(self):
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(value["$schema"], "prototype-ordax.dynamic-identity-capability/1")
        self.assertEqual(value["owner"], "identity-session-port")
        self.assertFalse(value["availability"]["boot_time_snapshot_is_authority"])
        self.assertFalse(value["availability"]["network_event_is_authority"])
        self.assertEqual(
            value["availability"]["capabilities_when_available"],
            ["account.identity", "sync.safe-state"],
        )
        self.assertEqual(value["composition"]["native"], "live-port")
        self.assertEqual(value["composition"]["web"], "live-port")
        self.assertFalse(value["composition"]["credential_adapter_grants_identity"])
        self.assertFalse(value["security"]["fake_provider_allowed"])
        self.assertFalse(value["security"]["provider_fallback_allowed"])
        self.assertFalse(value["security"]["polling_required"])
        self.assertFalse(value["security"]["sync_without_identity_allowed"])


if __name__ == "__main__":
    unittest.main()
