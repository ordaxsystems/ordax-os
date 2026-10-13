"""Creator Native branding is exported from Surface tokens, never reauthored."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/creator"))
from theme_bridge import render_theme, PALETTE, TOKENS, SYMBOL

class CreatorThemeBridgeTests(unittest.TestCase):
    def test_canonical_visual_identity(self):
        theme = json.loads(render_theme())
        self.assertEqual(theme["$schema"], "prototype-ordax.creator-ui-theme/1")
        self.assertEqual(theme["symbol_sha256"], hashlib.sha256(SYMBOL.read_bytes()).hexdigest())
        self.assertEqual(set(theme["colors"]), set(PALETTE))
        self.assertTrue(all(value.startswith("#") and len(value) == 7 for value in theme["colors"].values()))

    def test_check_rejects_visual_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "theme.json"
            script = ROOT / "tools/creator/theme_bridge.py"
            build = subprocess.run([sys.executable, str(script), "--out", str(output)], capture_output=True, text=True)
            self.assertEqual(build.returncode, 0, build.stderr)
            check = subprocess.run([sys.executable, str(script), "--out", str(output), "--check"], capture_output=True)
            self.assertEqual(check.returncode, 0, check.stderr)
            output.write_bytes(output.read_bytes() + b" ")
            check = subprocess.run([sys.executable, str(script), "--out", str(output), "--check"], capture_output=True)
            self.assertNotEqual(check.returncode, 0)

    def test_missing_semantic_token_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            tokens = Path(tmp) / "tokens.css"
            tokens.write_text(TOKENS.read_text().replace("--ordax-warning:", "--replaced-warning:"), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "canonical color"):
                render_theme(tokens_path=tokens)

if __name__ == "__main__":
    unittest.main()
