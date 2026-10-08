import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "tools/local-ai-model-catalog/render.py"
SOURCE = ROOT / "system/services/local-ai/source-lock.json"
GENERATED = ROOT / "system/services/local-ai/model-candidate.generated.mjs"
SPEC = importlib.util.spec_from_file_location("ordax_local_ai_store_projection", GENERATOR)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LocalAiModelCatalogSourceTests(unittest.TestCase):
    def test_generated_model_projection_is_exactly_reproducible(self):
        lock = json.loads(SOURCE.read_text(encoding="utf-8"))
        expected = MODULE.render(lock)
        self.assertEqual(GENERATED.read_text(encoding="utf-8"), expected)
        result = subprocess.run(
            [sys.executable, str(GENERATOR), "--check"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unreviewed_engine_model_or_license_never_produces_model_listing(self):
        original = json.loads(SOURCE.read_text(encoding="utf-8"))
        cases = [
            ("model", "id", "random-unsigned-model"),
            ("model", "license", "Proprietary"),
            ("model", "quantization", "Q8_0"),
            ("engine", "id", "unknown-engine"),
            ("distribution", "signed_release_artifact_required", False),
        ]
        for section, field, value in cases:
            with self.subTest(field=field, value=value):
                lock = json.loads(json.dumps(original))
                lock[section][field] = value
                with self.assertRaises(ValueError):
                    MODULE.render(lock)

    def test_release_preview_is_not_independent_model_update_metadata(self):
        text = GENERATED.read_text(encoding="utf-8")
        self.assertIn('"releaseMode": "signed-system-release"', text)
        self.assertIn('"independentInstallAvailable": false', text)
        self.assertIn('"independentUpdateAvailable": false', text)
        self.assertIn('"benchmarkQualified": false', text)
        self.assertIn('"memoryMinimumBytes": null', text)
        self.assertNotIn('"downloadUrl"', text)
        self.assertNotIn('"activate"', text)


if __name__ == "__main__":
    unittest.main()
