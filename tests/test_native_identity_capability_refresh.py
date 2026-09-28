from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NativeIdentityCapabilityRefreshTests(unittest.TestCase):
    def test_node_dynamic_identity_capabilities(self):
        subprocess.run(
            ["node", "--test", "tests/test_native_identity_capability_refresh.mjs"],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
