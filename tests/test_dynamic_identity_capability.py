from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "tests" / "test_dynamic_identity_capability.mjs"


class DynamicIdentityCapabilityNodeTests(unittest.TestCase):
    def test_node_regression(self):
        subprocess.run(
            ["node", "--test", str(TEST)],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
