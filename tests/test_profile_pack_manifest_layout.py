import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "system" / "profile-packs" / "catalog.json"
NATIVE_HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"


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
                f"/system/profile-packs/{entry['slug']}/"
                f"v{entry['version']}/manifest.json"
            )
            self.assertEqual(entry["manifest"], expected)
            path = ROOT / entry["manifest"].lstrip("/")
            self.assertTrue(path.is_file(), path)
            manifest = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["slug"], entry["slug"])
            self.assertEqual(manifest["version"], entry["version"])
            self.assertIn("components", manifest)
            self.assertIsInstance(manifest["components"], list)

    def test_runtime_urls_match_native_release_http_root(self):
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        host = NATIVE_HOST.read_text(encoding="utf-8")
        self.assertIn('parser.add_argument("--directory", default="/srv/ordax-system")', host)
        for entry in catalog["entries"]:
            self.assertTrue(
                entry["manifest"].startswith("/system/profile-packs/"),
                entry["manifest"],
            )
            runtime_path = Path("/srv/ordax-system") / entry["manifest"].lstrip("/")
            source_path = ROOT / entry["manifest"].lstrip("/")
            self.assertEqual(
                runtime_path.relative_to("/srv/ordax-system"),
                source_path.relative_to(ROOT),
            )

    def test_unversioned_manifest_paths_are_not_retained(self):
        self.assertFalse((ROOT / "system/profile-packs/developer/manifest.json").exists())
        self.assertFalse((ROOT / "system/profile-packs/legal-br/manifest.json").exists())
        self.assertFalse((ROOT / "system/profile-packs/pizzaria-br/manifest.json").exists())
        self.assertFalse((ROOT / "system/profile-packs/impressao-3d-br/manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
