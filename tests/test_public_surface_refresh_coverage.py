from __future__ import annotations

import fnmatch
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "sites/public/assets/surface-snapshot.json"
WORKFLOW = ROOT / ".github/workflows/public-surface-ssot-refresh.yml"


def watched_source_paths() -> list[str]:
    text = WORKFLOW.read_text(encoding="utf-8")
    # The workflow has a single path-filter block under on.push. Only
    # correctly quoted source globs in that block count as trigger coverage.
    match = re.search(r"(?m)^  push:\n    paths:\n((?:      - '[^']+'\n)+)", text)
    if not match:
        raise AssertionError("Public Surface refresh requires explicit push source path filters")
    return re.findall(r"(?m)^      - '([^']+)'$", match.group(1))


class PublicSurfaceRefreshCoverageTests(unittest.TestCase):
    def test_every_snapshot_source_has_a_refresh_trigger(self):
        snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        sources = [item["path"] for item in snapshot["sources"]]
        self.assertTrue(sources)
        self.assertEqual(len(sources), len(set(sources)))
        watched = watched_source_paths()
        self.assertEqual(len(watched), len(set(watched)))
        uncovered = [
            source for source in sources
            if not any(fnmatch.fnmatchcase(source, glob) for glob in watched)
        ]
        self.assertEqual(uncovered, [], f"Unwatched canonical snapshot sources: {uncovered}")

    def test_generated_output_never_triggers_an_unbounded_refresh_loop(self):
        watched = watched_source_paths()
        generated = (
            "sites/public/assets/surface-snapshot.json",
            "sites/public/assets/surface-snapshot.css",
            "sites/public/assets/playground-fixture.json",
            "sites/public/index.html",
            "sites/public/i18n/catalog.js",
        )
        for target in generated:
            self.assertFalse(
                any(fnmatch.fnmatchcase(target, glob) for glob in watched),
                f"Generated output unexpectedly retriggers its own workflow: {target}",
            )


if __name__ == "__main__":
    unittest.main()
