"""Same-commit OrdaX visual exports; no historical GitHub release resolver."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "site/scripts"))
import canonical_artifacts as artifacts
import build

class CanonicalArtifactsTests(unittest.TestCase):
    def current_sha(self):
        return subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                                       text=True).strip()

    def test_brand_verified_from_same_commit_os_and_sha256_inventory(self):
        with tempfile.TemporaryDirectory(prefix="site-brand-test-") as tmp:
            directory = Path(tmp) / "brand"
            sha = self.current_sha()
            receipt = artifacts.brand(directory, sha)
            raw = (directory / "manifest.json").read_bytes()
            manifest = json.loads(raw)
            self.assertEqual(receipt["manifest_sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(manifest["source_repository"], "ordaxsystems/ordax-os")
            self.assertEqual(manifest["source_commit"], sha)
            self.assertTrue(all(r["repository"] == "ordaxsystems/ordax-os"
                                and r["commit"] == sha for r in manifest["sources"]))
            stage = Path(tmp) / "site"
            build.stage_brand(stage, directory, receipt["manifest_sha256"], sha)
            self.assertTrue((stage / "assets/ordax-design-tokens.css").is_file())
            with self.assertRaisesRegex(build.SiteError, "brand asset SHA-256 mismatch"):
                (directory / "assets/ordax-symbol.png").write_bytes(b"corrupt")
                build.stage_brand(Path(tmp) / "bad", directory,
                                  receipt["manifest_sha256"], sha)

    def test_no_historical_sources_or_release_resolvers(self):
        for path in ("site/scripts/brand_release.py", "site/scripts/surface_release.py"):
            self.assertFalse((ROOT / path).exists())
        policy = json.loads((ROOT / "site/contracts/dev-artifact-lock.json").read_text())
        self.assertEqual(policy["source_repository"], "ordaxsystems/ordax-os")
        self.assertEqual(policy["source_ref"], "same-commit")
        self.assertEqual(set(policy["artifacts"]), {"brand", "surface_preview"})
        self.assertNotIn("release_tag", json.dumps(policy))
        for module in ("site/scripts/build.py", "site/scripts/canonical_artifacts.py",
                       "site/scripts/canonical-preview.mjs"):
            contents = (ROOT / module).read_text(encoding="utf-8")
            self.assertNotIn("ordaxsystems/ordax-surface", contents)

    def test_fails_closed_before_export_on_wrong_git_sha(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(Exception, "source"):
                artifacts.brand(Path(tmp) / "brand", "0" * 40)
            self.assertFalse((Path(tmp) / "brand").exists())

if __name__ == "__main__":
    unittest.main()
