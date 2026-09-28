import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "system" / "profile-packs" / "catalog.json"


class ProfilePackManifestLayoutTests(unittest.TestCase):
    def test_catalog_points_only_to_versioned_authoritative_manifests(self):
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        self.assertEqual(catalog["$schema"], "ordax.profile-pack-bundled-catalog/1")
        seen = set()
        for entry in catalog["entries"]:
            identity = (entry["slug"], entry["version"])
            self.assertNotIn(identity, seen)
            seen.add(identity)
            expected = (
                f"/profile-packs/{entry['slug']}/"
                f"v{entry['version']}/manifest.json"
            )
            self.assertEqual(entry["manifest"], expected)
            path = ROOT / "system" / entry["manifest"].lstrip("/")
            self.assertTrue(path.is_file(), path)
            manifest = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["slug"], entry["slug"])
            self.assertEqual(manifest["version"], entry["version"])

    def test_unversioned_manifest_paths_are_not_retained(self):
        self.assertFalse((ROOT / "system/profile-packs/developer/manifest.json").exists())
        self.assertFalse((ROOT / "system/profile-packs/legal-br/manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
