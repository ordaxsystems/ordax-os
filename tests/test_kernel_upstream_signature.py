"""Real local OpenPGP verification tests; no network or trusted host keyring."""

from __future__ import annotations

import hashlib
import io
import json
import lzma
from pathlib import Path
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "bootstrap/kernel/verify_upstream_signature.py"
VERSION = "6.6.158"
PREFIX = "https://cdn.kernel.org/pub/linux/kernel/v6.x/"


def command(argv: list[str], **kwargs):
    return subprocess.run(argv, capture_output=True, check=True, **kwargs)


class KernelUpstreamSignatureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "local-signing-home"
        self.home.mkdir(mode=0o700)
        command([
            "gpg", "--homedir", str(self.home), "--batch",
            "--pinentry-mode", "loopback", "--passphrase", "",
            "--quick-generate-key", "OrdaX test-only signer <test@example.invalid>",
            "ed25519", "sign", "0",
        ])
        result = command([
            "gpg", "--homedir", str(self.home),
            "--batch", "--with-colons", "--fingerprint", "--list-keys",
        ], text=True)
        self.fingerprint = next(
            line.split(":")[9]
            for line in result.stdout.splitlines() if line.startswith("fpr:")
        )
        self.key = self.root / "trusted.asc"
        self.key.write_bytes(command([
            "gpg", "--homedir", str(self.home), "--batch",
            "--armor", "--export", self.fingerprint,
        ]).stdout)

        buffer = io.BytesIO()
        with tarfile.open(mode="w", fileobj=buffer) as handle:
            payload = b"kernel-test-source"
            member = tarfile.TarInfo(f"linux-{VERSION}/README")
            member.size = len(payload)
            handle.addfile(member, io.BytesIO(payload))
        self.uncompressed = self.root / "unsigned.tar"
        self.uncompressed.write_bytes(buffer.getvalue())
        self.archive = self.root / f"linux-{VERSION}.tar.xz"
        self.archive.write_bytes(lzma.compress(buffer.getvalue()))
        self.signature = self.root / f"linux-{VERSION}.tar.sign"
        command([
            "gpg", "--homedir", str(self.home), "--batch",
            "--pinentry-mode", "loopback", "--passphrase", "",
            "--output", str(self.signature), "--detach-sign",
            str(self.uncompressed),
        ])
        self.contract = self.root / "kernel-source.json"
        self.source = {
            "$schema": "prototype-ordax.kernel-source/1",
            "version": VERSION,
            "archive_url": PREFIX + f"linux-{VERSION}.tar.xz",
            "signature_url": PREFIX + f"linux-{VERSION}.tar.sign",
            "archive_sha256": hashlib.sha256(self.archive.read_bytes()).hexdigest(),
            "upstream_signature": {
                "algorithm": "openpgp-detached-tar",
                "trusted_primary_fingerprint": self.fingerprint,
                "trusted_public_key_url": "https://kernel.googlesource.com/pub/scm/docs/kernel/pgpkeys/+/9518bddaef900dd832e3e16be1d88923c620b749/keys/38DBBDC86092693E.asc?format=TEXT",
            },
        }
        self.write_contract()
        self.receipt = self.root / "receipt.json"

    def write_contract(self):
        self.contract.write_text(json.dumps(self.source), encoding="utf-8")

    def verify(self):
        return subprocess.run(
            [
                sys.executable, str(VERIFIER), "--source-contract", str(self.contract),
                "--archive", str(self.archive), "--signature", str(self.signature),
                "--public-key", str(self.key), "--out", str(self.receipt),
            ],
            capture_output=True, text=True, check=False,
        )

    def test_valid_detached_signature_produces_audit_receipt(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = json.loads(self.receipt.read_text(encoding="utf-8"))
        self.assertEqual(receipt["status"], "verified")
        self.assertEqual(receipt["trusted_primary_fingerprint"], self.fingerprint)
        self.assertEqual(receipt["kernel_version"], VERSION)
        self.assertEqual(receipt["detached_signature_target"], "uncompressed-tar-stream")
        self.assertFalse(receipt["physical_write_authorized"])

    def test_changed_compressed_archive_fails_digest(self):
        self.archive.write_bytes(self.archive.read_bytes() + b"tampered")
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SHA-256 mismatch", result.stderr)
        self.assertFalse(self.receipt.exists())

    def test_changed_tar_with_matching_archive_pin_fails_openpgp(self):
        self.archive.write_bytes(lzma.compress(b"not the authenticated tar"))
        self.source["archive_sha256"] = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.write_contract()
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("OpenPGP signature is invalid", result.stderr)
        self.assertFalse(self.receipt.exists())

    def test_different_trusted_identity_is_rejected(self):
        self.source["upstream_signature"]["trusted_primary_fingerprint"] = "A" * 40
        self.write_contract()
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not the pinned signer identity", result.stderr)
        self.assertFalse(self.receipt.exists())

    def test_unsigned_source_policy_is_rejected(self):
        self.source.pop("upstream_signature")
        self.write_contract()
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing mandatory OpenPGP", result.stderr)
        self.assertFalse(self.receipt.exists())

    def test_signature_url_must_match_version(self):
        self.source["signature_url"] = PREFIX + "linux-6.6.52.tar.sign"
        self.write_contract()
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("signature URL differs", result.stderr)
        self.assertFalse(self.receipt.exists())


if __name__ == "__main__":
    unittest.main()
