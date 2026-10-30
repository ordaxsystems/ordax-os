from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SystemDeviceCapabilityServicesTests(unittest.TestCase):
    def test_node_preflight_and_installed_app_capability_isolation(self) -> None:
        subprocess.run(
            [
                "node", "--test",
                "tests/test_device_action_preflight.mjs",
                "tests/test_installed_app_capability_reader.mjs",
                "tests/test_native_installed_app_capability_context.mjs",
                "tests/test_native_capability_mount_lifecycle.mjs",
            ],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
