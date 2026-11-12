"""Only the OS projects canonical app metadata/shortcuts into the Surface demo."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools/public-catalog/project.py"
spec = importlib.util.spec_from_file_location("ordax_public_catalog_projection", MODULE)
projection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(projection)


class PublicCatalogProjectionTests(unittest.TestCase):
    def test_current_source_projects_canonical_apps_and_navigation(self):
        result = projection.project_public_catalog()
        self.assertEqual(result["$schema"], "ordax.os-public-catalog-projection/1")
        self.assertEqual(result["source_repository"], "ordaxsystems/ordax-os")
        self.assertEqual(result["source"]["apps"], "system/apps/catalog.mjs")
        self.assertEqual(result["source"]["home"], "system/services/surface/shortcut-catalog.mjs")
        ids = [app["id"] for app in result["apps"]]
        self.assertTrue(ids)
        self.assertEqual(len(set(ids)), len(ids))
        self.assertTrue(result["home"]["rail_apps"])
        self.assertTrue(set(result["home"]["rail_apps"]).issubset(ids))
        self.assertEqual(len(set(result["home"]["rail_apps"])), len(result["home"]["rail_apps"]))

    def test_projection_is_deterministic_and_only_writes_new_external_json(self):
        with tempfile.TemporaryDirectory() as temp:
            files = [Path(temp) / "first.json", Path(temp) / "second.json"]
            for target in files:
                with patch("sys.argv", ["project.py", "--output", str(target)]):
                    self.assertEqual(projection.main(), 0)
            self.assertEqual(files[0].read_bytes(), files[1].read_bytes())
            self.assertEqual(json.loads(files[0].read_text())["$schema"],
                             "ordax.os-public-catalog-projection/1")
            with patch("sys.argv", ["project.py", "--output", str(files[0])]):
                with self.assertRaisesRegex(projection.CatalogProjectionError, "new file"):
                    projection.main()

    def test_no_deleted_site_or_visual_generator_is_required(self):
        source = MODULE.read_text(encoding="utf-8")
        self.assertNotIn("sites/public", source)
        self.assertNotIn("system/surface/ui/", source)
        self.assertNotIn("surface_snapshot", source)
        self.assertFalse((ROOT / "sites/public").exists())
        self.assertFalse((ROOT / "tools/public-site/playground_fixture.py").exists())


if __name__ == "__main__":
    unittest.main()
