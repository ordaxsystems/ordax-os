"""SSOT: six pre-cutover app source graphs may depend only on their own code
and OS public contracts. No other app's source or privileged OS services may
be pulled across the future runtime-component package boundary.
"""
from pathlib import Path
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "system" / "apps"
CONTRACTS = ROOT / "system" / "contracts"
CANDIDATES = ("files", "projects", "internet", "assistant", "activity", "network")
STATIC_IMPORT = re.compile(
    r"\b(?:from\s*|import\s*\(\s*|import\s+)(['\"])(\.\.?/[^'\"]+)\1"
)


class PortableSourceBoundaryTests(unittest.TestCase):
    def test_all_six_app_source_graphs_restrict_static_imports(self):
        policy = json.loads(
            (ROOT / "docs/contracts/runtime-component-package.json").read_text(encoding="utf-8")
        )
        external_owners = policy["canonical_package_source_repository_by_component"]
        for app_id in CANDIDATES:
            owner = APP_ROOT / app_id
            external = external_owners.get(app_id)
            if external is not None:
                self.assertEqual(
                    external, "ordaxsystems/ordax-apps",
                    f"{app_id}: unrecognized source repository in canonical package policy",
                )
                self.assertFalse(
                    owner.exists(),
                    f"{app_id}: OS bundled source must be removed once external source is canonical",
                )
                continue
            self.assertTrue(
                owner.is_dir(),
                f"{app_id}: source disappeared without an external SSOT owner cutover",
            )
            files = sorted(owner.rglob("*.mjs"))
            self.assertTrue(files, f"Missing executable source for {app_id}")
            for source in files:
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


if __name__ == "__main__":
    unittest.main()
