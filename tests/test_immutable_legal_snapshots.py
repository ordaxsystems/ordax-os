"""Immutable accepted legal pages have exact-byte review digests independent of UI."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "public-site"))
from legal_snapshots import LegalSnapshotError, validate_immutable_legal_snapshots


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
            validate_immutable_legal_snapshots(site, ledger)

    def test_exact_reviewed_snapshot_bytes_accepted_and_mutation_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, privacy, terms, ledger, ledger_path = self.fixture(root)
            validate_immutable_legal_snapshots(site, ledger_path)
            privacy.write_bytes(privacy.read_bytes() + b"<!-- dynamic theme -->")
            with self.assertRaisesRegex(LegalSnapshotError, "bytes differ from reviewed digest"):
                validate_immutable_legal_snapshots(site, ledger_path)

    def test_unreviewed_extra_page_and_missing_document_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, privacy, terms, ledger, ledger_path = self.fixture(root)
            extra = site / "legal/2026.10.13/privacidade/index.html"
            extra.parent.mkdir(parents=True)
            extra.write_text("unreviewed", encoding="utf-8")
            with self.assertRaisesRegex(LegalSnapshotError, "unreviewed"):
                validate_immutable_legal_snapshots(site, ledger_path)
            extra.unlink()
            terms.unlink()
            with self.assertRaisesRegex(LegalSnapshotError, "missing or linked"):
                validate_immutable_legal_snapshots(site, ledger_path)

    def test_digest_and_ledger_state_cannot_be_invented(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site, privacy, terms, ledger, ledger_path = self.fixture(root)
            ledger["snapshots"][0]["sha256"] = "0" * 64
            ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
            with self.assertRaisesRegex(LegalSnapshotError, "bytes differ from reviewed digest"):
                validate_immutable_legal_snapshots(site, ledger_path)
            ledger["snapshots"][0]["sha256"] = hashlib.sha256(privacy.read_bytes()).hexdigest()
            ledger["status"] = "no-approved-snapshots"
            ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
            with self.assertRaisesRegex(LegalSnapshotError, "status mismatch"):
                validate_immutable_legal_snapshots(site, ledger_path)


if __name__ == "__main__":
    unittest.main()
