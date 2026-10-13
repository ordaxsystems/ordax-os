"""Regression: Git blob bytes, not Windows CRLF checkout, authorize the public envelope."""

import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools" / "release-operator" / "export_exact_signed_envelope.py"
spec = importlib.util.spec_from_file_location("ordax_exact_signed_envelope", MODULE)
envelope = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(envelope)

FROZEN = "03f88eeaf382a59aaefbcf4943d0639d2730741b"
APPROVED_SHA = "d9ab389cd55c481785491cb1c3881936e47e7347bdc69ccea5c76a7437969a90"


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


class ExactSignedEnvelopeTests(unittest.TestCase):
    def test_approved_canonical_envelope_is_exported_as_original_git_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "release-envelope.json"
            result = envelope.export_envelope(ROOT, FROZEN, APPROVED_SHA, target)
            expected = git(ROOT, "show", "HEAD:docs/evidence/canonical-v4-signed-envelope-" + FROZEN + ".json")
            self.assertEqual(result, APPROVED_SHA)
            self.assertEqual(target.read_bytes(), expected)
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), APPROVED_SHA)
            with self.assertRaisesRegex(envelope.EnvelopeExportError, "absent"):
                envelope.export_envelope(ROOT, FROZEN, APPROVED_SHA, target)

    def test_wrong_hash_fails_closed_before_creating_any_output(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "release-envelope.json"
            with self.assertRaisesRegex(envelope.EnvelopeExportError, "mismatch"):
                envelope.export_envelope(ROOT, FROZEN, "0" * 64, target)
            self.assertFalse(target.exists())

    def test_rejects_invalid_commit_and_absent_envelope(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "release-envelope.json"
            with self.assertRaisesRegex(envelope.EnvelopeExportError, "invalid"):
                envelope.export_envelope(ROOT, "../unsafe", APPROVED_SHA, target)
            with self.assertRaisesRegex(envelope.EnvelopeExportError, "not a regular blob"):
                envelope.export_envelope(ROOT, "f" * 40, APPROVED_SHA, target)
            self.assertFalse(target.exists())

    def test_export_never_roundtrips_through_checkout_text_conversion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            git(root, "init", "-q")
            git(root, "config", "user.name", "OrdaX Test")
            git(root, "config", "user.email", "test@example.invalid")
            git(root, "config", "core.autocrlf", "true")
            git(root, "config", "commit.gpgsign", "false")
            source = "a" * 40
            path = root / "docs" / "evidence" / ("canonical-v4-signed-envelope-" + source + ".json")
            path.parent.mkdir(parents=True)
            original = b'{\n  "source_commit": "' + source.encode() + b'"\n}\n'
            path.write_bytes(original)
            git(root, "add", "--", str(path.relative_to(root)))
            git(root, "commit", "-qm", "Store canonical LF envelope")
            digest = hashlib.sha256(original).hexdigest()

            # A Windows checkout can convert the working copy; the object itself
            # must remain authoritative regardless of the user's core.autocrlf.
            with tempfile.TemporaryDirectory() as output_directory:
                target = Path(output_directory) / "release-envelope.json"
                self.assertEqual(envelope.export_envelope(root, source, digest, target), digest)
                self.assertEqual(target.read_bytes(), original)
                self.assertNotIn(b"\r\n", target.read_bytes())


if __name__ == "__main__":
    unittest.main()
