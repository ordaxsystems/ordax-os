"""Portable regression tests for independent Owner/Development Creator ZIP verification."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/creator/verify_owner_dev_bundle.py"
COMMIT = "a" * 40
VERSION = json.loads((ROOT / "tools/creator/version.json").read_text(encoding="utf-8"))["version"]
sys.path.insert(0, str(ROOT / "tools/creator"))
from theme_bridge import render_theme, SYMBOL
THEME = render_theme()
SYMBOL_BYTES = SYMBOL.read_bytes()

class DevelopmentCreatorBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "OrdaX-Creator-Owner-Prototype.zip"
        self.metadata = self.root / "creator-owner-update.json"
        self.sums = self.root / "SHA256SUMS.txt"
        self.seed = b"test-development-seed"
        self.provenance = {
            "$schema": "prototype-ordax.creator-owner-physical/1",
            "source_commit": COMMIT,
            "creator_version": VERSION,
            "symbol_sha256": hashlib.sha256(SYMBOL_BYTES).hexdigest(),
            "theme_sha256": hashlib.sha256(THEME).hexdigest(),
            "canonical_public_release": False,
            "ephemeral_prototype_trust": True,
            "private_key_in_package": False,
            "physical_write_authorized_in_binary": True,
            "seed_sha256": hashlib.sha256(self.seed).hexdigest(),
            "seed_size": len(self.seed),
        }
        self.create()

    def create(self):
        with zipfile.ZipFile(self.archive, "w") as z:
            z.writestr("OrdaX-Creator/OrdaX-Creator.exe", b"MZ" + b"gui")
            z.writestr("OrdaX-Creator/ordax-creator-physical-test.exe", b"MZ" + b"writer")
            z.writestr("OrdaX-Creator/ordax-bootstrap-seed.raw", self.seed)
            z.writestr("OrdaX-Creator/provenance.json", json.dumps(self.provenance))
            z.writestr("OrdaX-Creator/ordax-symbol.png", SYMBOL_BYTES)
            z.writestr("OrdaX-Creator/ordax-design-theme.json", THEME)
            z.writestr("OrdaX-Creator/LEIA-ME.txt", "Development Git USB")
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.metadata.write_text(json.dumps({
            "$schema": "prototype-ordax.creator-owner-bundle-update/1",
            "channel": "owner-prototype", "version": VERSION,
            "source_commit": COMMIT, "artifact": self.archive.name,
            "download_url": "https://example.invalid/dev.zip", "sha256": digest,
            "size": self.archive.stat().st_size, "automatic_in_app_update": False,
        }), encoding="utf-8")
        self.sums.write_text(f"{digest}  {self.archive.name}\n", encoding="utf-8")

    def run_check(self):
        return subprocess.run([sys.executable, str(SCRIPT),
            "--archive", str(self.archive), "--metadata", str(self.metadata),
            "--checksums", str(self.sums), "--source-commit", COMMIT],
            capture_output=True, text=True, check=False)

    def test_valid_owner_bundle_passes(self):
        out = self.run_check()
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("OWNER_DEV_BUNDLE_VERIFY=PASS", out.stdout)

    def test_archive_tampering_fails(self):
        with self.archive.open("ab") as file:
            file.write(b"tampered")
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_wrong_source_commit_fails(self):
        d = json.loads(self.metadata.read_text())
        d["source_commit"] = "b" * 40
        self.metadata.write_text(json.dumps(d))
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_version_provenance_drift_fails(self):
        self.provenance["creator_version"] = "999.0.0"
        self.create()
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_version_manifest_drift_fails(self):
        d = json.loads(self.metadata.read_text())
        d["version"] = "owner-" + COMMIT[:12]
        self.metadata.write_text(json.dumps(d))
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_public_release_mislabeling_fails(self):
        self.provenance["canonical_public_release"] = True
        self.create()
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_tampered_theme_fails(self):
        # Tampering must be rejected even when the ZIP metadata has been re-hashed.
        with zipfile.ZipFile(self.archive, "w") as z:
            z.writestr("OrdaX-Creator/OrdaX-Creator.exe", b"MZgui")
            z.writestr("OrdaX-Creator/ordax-creator-physical-test.exe", b"MZwriter")
            z.writestr("OrdaX-Creator/ordax-bootstrap-seed.raw", self.seed)
            z.writestr("OrdaX-Creator/provenance.json", json.dumps(self.provenance))
            z.writestr("OrdaX-Creator/ordax-symbol.png", SYMBOL_BYTES)
            z.writestr("OrdaX-Creator/ordax-design-theme.json", THEME + b" ")
            z.writestr("OrdaX-Creator/LEIA-ME.txt", "Development Git USB")
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        d = json.loads(self.metadata.read_text())
        d["sha256"], d["size"] = digest, self.archive.stat().st_size
        self.metadata.write_text(json.dumps(d))
        self.sums.write_text(f"{digest}  {self.archive.name}\n")
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_missing_member_fails(self):
        with zipfile.ZipFile(self.archive, "w") as z:
            z.writestr("OrdaX-Creator/LEIA-ME.txt", "missing others")
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        d = json.loads(self.metadata.read_text())
        d["sha256"], d["size"] = digest, self.archive.stat().st_size
        self.metadata.write_text(json.dumps(d))
        self.sums.write_text(f"{digest}  {self.archive.name}\n")
        self.assertNotEqual(self.run_check().returncode, 0)

if __name__ == "__main__":
    unittest.main()
