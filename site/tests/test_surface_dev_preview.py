"""Developer-only Surface preview contract, with no OS/Surface code imported."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build

SURFACE_SHA = "a" * 40
OS_SHA = "b" * 40


class SurfaceDevPreviewTests(unittest.TestCase):
    def make_package(self, tmp):
        root = Path(tmp) / "producer"
        (root / "assets").mkdir(parents=True)
        sources = [
            {"repository": "ordaxsystems/ordax-surface", "commit": SURFACE_SHA,
             "path": "system/surface/ui/meridian.css", "git_blob": "c" * 40,
             "sha256": "d" * 64},
            {"repository": "ordaxsystems/ordax-os", "commit": OS_SHA,
             "path": "system/services/i18n/surface.mjs", "git_blob": "e" * 40,
             "sha256": "f" * 64},
        ]
        css = b".demo-native { color: #111; background: url(/assets/inter-latin-wght-normal-TEST.woff2); }\n"
        fixture = {
            "$schema": build.PREVIEW_SCHEMA,
            "home": {"rail_apps": ["settings"]},
            "apps": [{"id": "settings", "title": "Ajustes"}],
            "surface": {
                "chrome": '<div class="demo-native-root"></div>',
                "views": {"home": "<p>Inicio</p>",
                          **{f"v{i}": "<p>Example</p>" for i in range(10)}},
                "sources": sources,
                "presentation": "example-only-not-an-authorized-session",
                "cssSha256": hashlib.sha256(css).hexdigest(),
            },
        }
        paths = {
            "assets/surface-snapshot.css": css,
            "assets/playground-fixture.json": (json.dumps(fixture) + "\n").encode(),
            "assets/public-theme-image.jpg": b"\xff\xd8" + b"image-data",
            "assets/inter-latin-wght-normal-TEST.woff2": b"test-inter-font",
        }
        for path, content in paths.items():
            file = root / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content)
        manifest = {
            "$schema": "ordax.meridian-readonly-preview-artifact/2",
            "artifact_class": "ordax-meridian-preview",
            "status": "candidate-not-published",
            "runtime_authority": False,
            "source_repository": "ordaxsystems/ordax-surface",
            "source_commit": SURFACE_SHA,
            "os_host_repository": "ordaxsystems/ordax-os",
            "os_host_commit": OS_SHA,
            "catalog_schema": "ordax.os-public-catalog-projection/1",
            "catalog_sha256": "0" * 64,
            "sources": sources,
            "files": [
                {"path": path, "sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw)}
                for path, raw in sorted(paths.items())
            ],
        }
        data = (json.dumps(manifest) + "\n").encode()
        (root / "manifest.json").write_bytes(data)
        return root, manifest, hashlib.sha256(data).hexdigest()

    def test_stage_exact_dev_presentation_without_source_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory, _, pin = self.make_package(tmp)
            stage = Path(tmp) / "built"
            stage.mkdir()
            font = stage / "assets/fonts/inter-latin-wght-normal.woff2"
            font.parent.mkdir(parents=True)
            font.write_bytes(b"test-inter-font")
            result = build.stage_surface_preview(stage, directory, pin)
            self.assertEqual(result["status"], "candidate-not-published")
            self.assertEqual(result["source_repository"], "ordaxsystems/ordax-surface")
            self.assertEqual(result["file_count"], 4)
            self.assertTrue((stage / "assets/playground-fixture.json").is_file())
            self.assertTrue((stage / "assets/public-theme-image.jpg").is_file())
            self.assertFalse((stage / "assets/inter-latin-wght-normal-TEST.woff2").exists())
            self.assertTrue(result["font_url_rebased"])

    def test_wrong_pin_forged_authority_and_extra_file_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory, manifest, pin = self.make_package(tmp)
            stage = Path(tmp) / "stage"
            stage.mkdir()
            with self.assertRaisesRegex(build.SiteError, "pin mismatch"):
                build.stage_surface_preview(stage, directory, "0" * 64)
            manifest["runtime_authority"] = True
            (directory / "manifest.json").write_text(json.dumps(manifest))
            new_pin = build.digest((directory / "manifest.json").read_bytes())
            with self.assertRaisesRegex(build.SiteError, "authority"):
                build.stage_surface_preview(stage, directory, new_pin)
            manifest["runtime_authority"] = False
            (directory / "manifest.json").write_text(json.dumps(manifest))
            (directory / "assets/extra.mjs").write_text("malicious")
            new_pin = build.digest((directory / "manifest.json").read_bytes())
            with self.assertRaisesRegex(build.SiteError, "unexpected"):
                build.stage_surface_preview(stage, directory, new_pin)

    def test_source_owner_or_fixture_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory, manifest, _ = self.make_package(tmp)
            stage = Path(tmp) / "site"
            stage.mkdir()
            altered = copy.deepcopy(manifest)
            altered["sources"][0]["commit"] = OS_SHA
            (directory / "manifest.json").write_text(json.dumps(altered))
            with self.assertRaisesRegex(build.SiteError, "provenance"):
                build.stage_surface_preview(
                    stage, directory, build.digest((directory / "manifest.json").read_bytes()))
            manifest["files"][0]["sha256"] = "0" * 64
            (directory / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(build.SiteError, "digest mismatch"):
                build.stage_surface_preview(
                    stage, directory, build.digest((directory / "manifest.json").read_bytes()))


if __name__ == "__main__":
    unittest.main()
