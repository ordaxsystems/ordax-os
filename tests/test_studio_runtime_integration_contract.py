from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StudioRuntimeIntegrationContractTest(unittest.TestCase):
    def test_node_studio_runtime_integration_contract(self) -> None:
        subprocess.run(
            [
                "node",
                "--test",
                "tests/test_studio_runtime_integration_contract.mjs",
            ],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
