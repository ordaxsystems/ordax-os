from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StudioDeviceActionAuthorizerTest(unittest.TestCase):
    def test_node_studio_device_action_authorizer(self) -> None:
        subprocess.run(
            ["node", "--test", "tests/test_studio_device_action_authorizer.mjs"],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
