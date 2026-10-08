#!/usr/bin/env python3
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ApplicationCompatibilityTests(unittest.TestCase):
    def test_node_application_compatibility_contract(self):
        # Profile tests have their own discovery wrapper; never execute them twice.
        subprocess.run(
            ["node", "--test", "tests/test_application_compatibility.mjs"],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
