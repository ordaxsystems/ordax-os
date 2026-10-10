"""The original Lovable React bundle is a reviewed optional public-site profile."""
from pathlib import Path
import importlib.util
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/public-site"))
_spec = importlib.util.spec_from_file_location("_ordax_account_public_site", ROOT / "tools/public-site/build.py")
assert _spec is not None and _spec.loader is not None
public_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(public_site)
DIST = ROOT / "sites/account-ui/prebuilt"
EXPECTED_SHA = "a9dc36520f4ab31ed7a46e1fb964c38f213fdaa2"

class ReactAccountBundleTests(unittest.TestCase):
    def test_reviewed_bundle_uses_real_source_assets_and_session_owner(self):
        self.assertTrue((DIST / "index.html").is_file())
        index = (DIST / "index.html").read_text(encoding="utf-8")
        self.assertIn('<div id="root"></div>', index)
        assets = list(DIST.glob("*.js"))
        self.assertEqual(len(assets), 1)
        js = assets[0].read_text(encoding="utf-8")
        self.assertIn("/auth/session", js)
        self.assertIn("/auth/logout", js)
        self.assertIn("prototype-ordax.public-identity-session/1", js)
        self.assertTrue((DIST / ".vite/manifest.json").is_file())
        source = ROOT / "sites/account-ui/lovable-original"
        self.assertTrue((source / "src/assets/ordax-landscape.jpg").is_file())
        self.assertTrue((source / "src/assets/ordax-mark.png").is_file())

    def test_lovable_bundle_stages_inside_single_canonical_public_site(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            manifest = public_site.build_bundle(out, EXPECTED_SHA, account_ui="lovable")
            verified = public_site.verify_bundle(out)
            self.assertTrue(manifest["framework_runtime_dependency"])
            self.assertEqual(manifest["account_ui_source"], "sites/account-ui/lovable-original")
            self.assertEqual(verified["source_commit"], EXPECTED_SHA)
            html = (out / "conta/index.html").read_text(encoding="utf-8")
            self.assertIn('<div id="root"></div>', html)
            self.assertRegex(html, r'/assets/account/index-[A-Za-z0-9_-]+\.js')
            self.assertIn('href="/assets/account/', html)
            self.assertNotIn('src="https://', html)
            copied = sorted((out / "assets/account").glob("*"))
            self.assertGreaterEqual(len(copied), 4)
            self.assertTrue(any(p.suffix == ".css" for p in copied))
            self.assertTrue(any(p.suffix == ".png" for p in copied))
            self.assertTrue(any(p.suffix == ".jpg" for p in copied))

    def test_classic_build_remains_default_for_unmigrated_callers(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "out"
            manifest = public_site.build_bundle(out, EXPECTED_SHA)
            self.assertFalse(manifest["framework_runtime_dependency"])
            self.assertEqual(manifest["account_ui_source"], "sites/public/conta")

if __name__ == "__main__":
    unittest.main()
