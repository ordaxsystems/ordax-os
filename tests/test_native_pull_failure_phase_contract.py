"""Native Pull error phases must reach existing diagnostic consumers."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
PHASES = (
    "remote-discovery-dns", "remote-discovery-tls",
    "remote-discovery-timeout", "remote-discovery-connectivity",
    "remote-discovery-auth",
)


class NativePullFailurePhases(unittest.TestCase):
    def test_producer_and_consumers_agree(self):
        source = (ROOT / "bootstrap/dev-base/ordax-pull").read_text(encoding="utf-8")
        for phase in PHASES:
            self.assertIn("printf '%s' " + phase, source)
        for path, variable in (
            ("bootstrap/dev-base/ordax-diagnose", "pull_phase"),
            ("system/supervisor", "checkout_pull_phase"),
        ):
            content = (ROOT / path).read_text(encoding="utf-8")
            prefix = 'case "$' + variable + '" in'
            self.assertIn(prefix, content)
            pattern = content.split(prefix, 1)[1].strip().split(')', 1)[0].strip()
            allowed = set(pattern.split('|'))
            for phase in PHASES:
                with self.subTest(path=path, phase=phase):
                    self.assertIn(phase, allowed)
            self.assertNotIn("remote-discovery-garbage", allowed)

    def test_consumer_patterns_are_exact_bounded_tokens(self):
        for path, variable in (
            ("bootstrap/dev-base/ordax-diagnose", "pull_phase"),
            ("system/supervisor", "checkout_pull_phase"),
        ):
            content = (ROOT / path).read_text(encoding="utf-8")
            pattern = content.split('case "$' + variable + '" in', 1)[1].strip().split(')', 1)[0].strip()
            accepted = set(pattern.split('|'))
            self.assertIn("remote-discovery", accepted)
            self.assertNotIn("remote-discovery-garbage", accepted)
            self.assertNotIn("*", accepted)
            self.assertNotIn("?", accepted)
            self.assertTrue(all(re.fullmatch(r"[a-z0-9-]+", item) for item in accepted))


if __name__ == "__main__":
    unittest.main()
