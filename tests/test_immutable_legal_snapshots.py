"""Immutable accepted legal pages have exact-byte review digests independent of UI."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "public-site" / "build.py"
sys.path.insert(0, str(SOURCE.parent))
spec = importlib.util.spec_from_file_location("ordax_public_site_legal_snapshot_build", SOURCE)
builder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(builder)


class ImmutableLegalSnapshotTests(unittest.TestCase):
    def fixture(self, root):
        site = root / "public"
        privacy = site / "legal/2026.10.12/privacidade/index.html"
        terms = site / "legal/2026.10.12/termos/index.html"
        for doc, title in ((privacy, "privacy"), (terms, "terms")):
            doc.parent.mkdir(parents=True, exist_ok=True)
            doc.write_bytes(("<html><head><title>" + title + "</title></head><body>Reviewed copy</body></html>\n").encode())
        ledger = {
            "$schema": "prototype-ordax.public-legal-snapshots/1",
            "status": "approved-versioned-snapshots",
            "snapshots": [
                {
                    "kind": kind, "version": "2026.10.12",
                    "size": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
                for kind, path in (("privacy", privacy), ("terms", terms))
            ],
        }
        ledger_path = root / "ledger.json"
        ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
        return site, privacy, terms, ledger, ledger_path

    def test_empty_unapproved_ledger_allows_current_source_but_no_new_snapshots(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            site = base / "public"
            site.mkdir()
            ledger = base / "ledger.json"
            ledger.write_text(json.dumps({
                "$schema": "prototype-ordax.public-legal-snapshots/1",
                "status": "no-approved-snapshots", "snapshots": [],
            }), encoding="utf-8")
            builder.validate_immutable_legal_snapshots(site, ledger)

    def test_exact_reviewed_snapshot_bytes_accepted_and_mutation_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, privacy, terms, ledger, ledger_path = self.fixture(root)
            builder.validate_immutable_legal_snapshots(site, ledger_path)
            privacy.write_bytes(privacy.read_bytes() + b"<!-- dynamic theme -->")
            with self.assertRaisesRegex(builder.LegalSnapshotError, "bytes differ from reviewed digest"):
                builder.validate_immutable_legal_snapshots(site, ledger_path)

    def test_unreviewed_extra_page_and_missing_document_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, privacy, terms, ledger, ledger_path = self.fixture(root)
            extra = site / "legal/2026.10.13/privacidade/index.html"
            extra.parent.mkdir(parents=True)
            extra.write_text("unreviewed", encoding="utf-8")
            with self.assertRaisesRegex(builder.LegalSnapshotError, "unreviewed"):
                builder.validate_immutable_legal_snapshots(site, ledger_path)
            extra.unlink()
            terms.unlink()
            with self.assertRaisesRegex(builder.LegalSnapshotError, "missing or linked"):
                builder.validate_immutable_legal_snapshots(site, ledger_path)

    def test_digest_and_ledger_state_cannot_be_invented(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, privacy, terms, ledger, ledger_path = self.fixture(root)
            ledger["snapshots"][0]["sha256"] = "0" * 64
            ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
            with self.assertRaisesRegex(builder.LegalSnapshotError, "bytes differ from reviewed digest"):
                builder.validate_immutable_legal_snapshots(site, ledger_path)
            ledger["snapshots"][0]["sha256"] = hashlib.sha256(privacy.read_bytes()).hexdigest()
            ledger["status"] = "no-approved-snapshots"
            ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
            with self.assertRaisesRegex(builder.LegalSnapshotError, "status mismatch"):
                builder.validate_immutable_legal_snapshots(site, ledger_path)

    def test_public_builder_never_rewrites_legal_snapshot_bytes(self):
        source = SOURCE.read_text(encoding="utf-8")
        start = source.index('for page in stage.rglob("*.html"):')
        end = source.index("markup = render_public_html", start)
        self.assertIn('if relative[0] == "legal":', source[start:end])
        self.assertIn("continue", source[start:end])
        self.assertIn("validate_immutable_legal_snapshots(root)", source)


if __name__ == "__main__":
    unittest.main()
