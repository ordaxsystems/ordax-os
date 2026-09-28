from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "native-identity-capability-refresh.json"


class NativeIdentityCapabilityContractTests(unittest.TestCase):
    def test_live_identity_session_is_the_only_identity_capability_authority(self):
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(value["$schema"], "prototype-ordax.native-identity-capability-refresh/1")
        self.assertEqual(value["owner"], "identity-session")
        self.assertFalse(value["refresh"]["boot_snapshot_is_authority"])
        self.assertFalse(value["refresh"]["connectivity_event_is_identity_authority"])
        self.assertEqual(
            value["credentials"]["action_availability_authority"],
            "identity-actions snapshot",
        )
        self.assertEqual(
            value["credentials"]["offline_or_unconfigured_provider_behavior"],
            "fail-closed",
        )
        self.assertFalse(value["legacy_static_identity_booleans"])


if __name__ == "__main__":
    unittest.main()
