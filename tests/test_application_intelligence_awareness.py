#!/usr/bin/env python3
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ApplicationIntelligenceAwarenessTests(unittest.TestCase):
    def test_node_application_intelligence_awareness_contract(self):
        subprocess.run(
            ["node", "--test", "tests/test_application_intelligence_awareness.mjs"],
            cwd=ROOT,
            check=True,
        )


if __name__ == "__main__":
    unittest.main()
