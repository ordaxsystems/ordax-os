from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SystemMcpOwnershipTests(unittest.TestCase):
    def test_apps_use_shared_os_capability_contract_not_studio_authority(self):
        ownership = json.loads(
            (ROOT / "docs/contracts/repository-ownership.json").read_text(encoding="utf-8")
        )
        repos = ownership["repositories"]
        self.assertIn("native-capability-preflight", repos["platform"]["owns"])
        self.assertIn("mcp-system-authority", repos["apps"]["must_not_own"])
        self.assertIn("product-mcp", repos["control_plane"]["owns"])
        for key in (
            "mcp_is_system_wide_capability_not_an_app",
            "native_os_permissions_owned_by_platform_not_studio",
            "apps_consume_capability_ports_without_grant_minting",
            "remote_mcp_grants_remain_control_plane_owned",
            "windows_studio_is_owner_ui_not_authority",
        ):
            self.assertIs(ownership["invariants"].get(key), True, key)

        shared = (ROOT / "system/services/device-agent/action-preflight.mjs").read_text(
            encoding="utf-8"
        )
        studio = (ROOT / "system/services/device-agent/studio-action-authorizer.mjs").read_text(
            encoding="utf-8"
        )
        self.assertIn("createDeviceActionPreflight", shared)
        self.assertIn("createDeviceActionPreflight(options)", studio)
        self.assertIn('dispatchAuthority: "none"', shared)
        self.assertNotIn("function validateDeviceCapabilityGrant", studio)
        self.assertNotIn("execute()", studio)


if __name__ == "__main__":
    unittest.main()
