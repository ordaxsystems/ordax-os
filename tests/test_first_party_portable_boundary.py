"""SSOT: six pre-cutover app source graphs may depend only on their own code
and OS public contracts. No other app's source or privileged OS services may
be pulled across the future runtime-component package boundary.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "system" / "apps"
CONTRACTS = ROOT / "system" / "contracts"
CANDIDATES = ("files", "projects", "internet", "assistant", "activity", "network")
STATIC_IMPORT = re.compile(
    r"\b(?:from\s*|import\s*\(\s*)(['\"])(\.\.?/[^'\"]+)\1"
)


class PortableSourceBoundaryTests(unittest.TestCase):
    def test_all_six_app_source_graphs_restrict_static_imports(self):
        count = 0
        for app_id in CANDIDATES:
            owner = APP_ROOT / app_id
            self.assertTrue(owner.is_dir(), f"Unexpected cutover: {app_id} source missing without owner update")
            files = sorted(owner.rglob("*.mjs"))
            self.assertTrue(files, f"Missing executable source for {app_id}")
            for source in files:
                count += 1
                contents = source.read_text(encoding="utf-8")
                for match in STATIC_IMPORT.finditer(contents):
                    imported = (source.parent / match.group(2)).resolve()
                    self.assertTrue(
                        imported.is_relative_to(owner.resolve())
                        or imported.is_relative_to(CONTRACTS.resolve()),
                        f"{app_id}: non-portable import {source.relative_to(ROOT)} -> {match.group(2)}",
                    )
                self.assertNotIn("node:child_process", contents)
                self.assertNotIn("node:fs", contents)
        self.assertGreaterEqual(count, 6)


if __name__ == "__main__":
    unittest.main()
