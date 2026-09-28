import subprocess
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SurfaceMultiAppProfileTests(unittest.TestCase):
    def test_node_profile_contract(self):
        subprocess.run(
            ["node", "--test", "tests/test_surface_multi_app_profile.mjs"],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
