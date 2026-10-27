"""No new kernel source pin may bypass upstream identity validation."""

from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
KERNEL_OWNER = ROOT / "bootstrap/kernel"
sys.path.insert(0, str(KERNEL_OWNER))
SPEC = importlib.util.spec_from_file_location("ordax_kernel_builder", KERNEL_OWNER / "build.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)

VERSION = "6.6.158"
PREFIX = "https://cdn.kernel.org/pub/linux/kernel/v6.x/"
KEY_URL = (
    "https://kernel.googlesource.com/pub/scm/docs/kernel/pgpkeys/"
    "+/9518bddaef900dd832e3e16be1d88923c620b749/keys/"
    "38DBBDC86092693E.asc?format=TEXT"
)


class KernelAuthenticationGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.contract = Path(self.tmp.name) / "source.json"
        self.source = {
            "$schema": "prototype-ordax.kernel-source/1",
            "version": VERSION,
            "archive_url": PREFIX + f"linux-{VERSION}.tar.xz",
            "signature_url": PREFIX + f"linux-{VERSION}.tar.sign",
            "archive_sha256": "a" * 64,
            "upstream_signature": {
                "algorithm": "openpgp-detached-tar",
                "trusted_primary_fingerprint": "647F28654894E3BD457199BE38DBBDC86092693E",
                "trusted_public_key_url": KEY_URL,
            },
        }
        self.set_contract()

    def set_contract(self):
        self.contract.write_text(json.dumps(self.source), encoding="utf-8")

    def load(self):
        with mock.patch.object(BUILDER, "SOURCE_CONTRACT", self.contract):
            return BUILDER.load_contract()

    def test_new_version_requires_signed_source_policy(self):
        del self.source["upstream_signature"]
        self.set_contract()
        with self.assertRaisesRegex(BUILDER.BuildError, "requires a signed upstream OpenPGP policy"):
            self.load()

    def test_signed_kernel_source_is_accepted_at_preflight(self):
        result = self.load()
        self.assertEqual(result["version"], VERSION)

    def test_key_url_must_pin_immutable_public_key_commit(self):
        self.source["upstream_signature"]["trusted_public_key_url"] = (
            "https://example.invalid/attacker.asc"
        )
        self.set_contract()
        with self.assertRaisesRegex(BUILDER.BuildError, "invalid signed kernel source policy"):
            self.load()

    def test_archive_digest_changing_without_signature_policy_fails(self):
        self.source["version"] = "6.6.52"
        self.source["archive_url"] = PREFIX + "linux-6.6.52.tar.xz"
        self.source["signature_url"] = PREFIX + "linux-6.6.52.tar.sign"
        self.source["archive_sha256"] = "b" * 64
        del self.source["upstream_signature"]
        self.set_contract()
        with self.assertRaisesRegex(BUILDER.BuildError, "requires a signed upstream OpenPGP policy"):
            self.load()

    def test_initramfs_style_absolute_import_outside_kernel_sys_path(self):
        # Regression for PID1 initramfs owner loading bootstrap/kernel/build.py
        # with importlib.util.spec_from_file_location, without adding its parent.
        script = (
            "import importlib.util, pathlib; "
            f"p=pathlib.Path({str(KERNEL_OWNER / 'build.py')!r}); "
            "s=importlib.util.spec_from_file_location('isolated_kernel_builder',p); "
            "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
            "assert callable(m.load_contract)"
        )
        result = subprocess.run(
            [sys.executable, "-I", "-c", script],
            cwd=self.tmp.name,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_existing_exact_legacy_source_remains_supported(self):
        self.source.update(
            {
                "version": BUILDER.LEGACY_UNSIGNED_PIN[0],
                "archive_sha256": BUILDER.LEGACY_UNSIGNED_PIN[1],
                "archive_url": BUILDER.LEGACY_UNSIGNED_PIN[2],
                "signature_url": BUILDER.LEGACY_UNSIGNED_PIN[3],
            }
        )
        del self.source["upstream_signature"]
        self.set_contract()
        self.assertEqual(self.load()["version"], "6.6.52")

    def test_pinned_authentication_input_reuses_cache_without_network(self):
        import io
        import urllib.error
        destination = Path(self.tmp.name) / "kernel.tar.sign"
        with mock.patch.object(BUILDER.urllib.request, "urlopen", return_value=io.BytesIO(b"sig")) as request:
            self.assertEqual(
                BUILDER.download_authentication_input(
                    "https://cdn.kernel.org/test.tar.sign", destination, max_bytes=1024
                ), b"sig"
            )
        request.assert_called_once()
        with mock.patch.object(BUILDER.urllib.request, "urlopen", side_effect=AssertionError("unexpected network")):
            self.assertEqual(
                BUILDER.download_authentication_input(
                    "https://cdn.kernel.org/test.tar.sign", destination, max_bytes=1024
                ), b"sig"
            )
        destination.unlink()
        destination.symlink_to(Path(self.tmp.name) / "external")
        with self.assertRaisesRegex(BUILDER.BuildError, "unsafe"):
            BUILDER.download_authentication_input("https://cdn.kernel.org/test.tar.sign", destination, max_bytes=1024)

    def test_transient_upstream_503_has_bounded_retry_and_no_unverified_fallback(self):
        import io
        import urllib.error
        url = "https://cdn.kernel.org/test.tar.sign"
        destination = Path(self.tmp.name) / "retriable.tar.sign"
        failure = urllib.error.HTTPError(url, 503, "Service Unavailable", {}, None)
        with mock.patch.object(
            BUILDER.urllib.request, "urlopen",
            side_effect=[failure, io.BytesIO(b"gpg-detached-signature")],
        ) as upstream, mock.patch.object(BUILDER.time, "sleep") as pause:
            got = BUILDER.download_authentication_input(url, destination, max_bytes=1024)
        self.assertEqual(got, b"gpg-detached-signature")
        self.assertEqual(upstream.call_count, 2)
        pause.assert_called_once_with(1)
        self.assertEqual(destination.read_bytes(), got)
        self.assertFalse(destination.with_name(destination.name + ".part").exists())

    def test_repeated_upstream_503_fails_closed_without_unsigned_cache(self):
        import urllib.error
        url = "https://cdn.kernel.org/test.tar.sign"
        destination = Path(self.tmp.name) / "no-source.tar.sign"
        failure = urllib.error.HTTPError(url, 503, "Service Unavailable", {}, None)
        with mock.patch.object(BUILDER.urllib.request, "urlopen", side_effect=failure) as upstream, mock.patch.object(
            BUILDER.time, "sleep"
        ) as pause, self.assertRaisesRegex(BUILDER.BuildError, "download failed"):
            BUILDER.download_authentication_input(url, destination, max_bytes=1024)
        self.assertEqual(upstream.call_count, 3)
        self.assertEqual(pause.call_count, 2)
        self.assertFalse(destination.exists())

    def test_authentication_input_does_not_retry_untrusted_404_or_oversize(self):
        import io
        import urllib.error
        url = "https://cdn.kernel.org/test.tar.sign"
        destination = Path(self.tmp.name) / "invalid.tar.sign"
        with mock.patch.object(BUILDER.urllib.request, "urlopen", side_effect=urllib.error.HTTPError(
            url, 404, "Not Found", {}, None
        )) as upstream, mock.patch.object(BUILDER.time, "sleep") as pause, self.assertRaises(BUILDER.BuildError):
            BUILDER.download_authentication_input(url, destination, max_bytes=1024)
        upstream.assert_called_once()
        pause.assert_not_called()
        with mock.patch.object(BUILDER.urllib.request, "urlopen", return_value=io.BytesIO(b"x" * 1025)), self.assertRaisesRegex(
            BUILDER.BuildError, "oversized"
        ):
            BUILDER.download_authentication_input(url, destination, max_bytes=1024)
        self.assertFalse(destination.exists())

    def test_signed_source_accepts_base64_newline_only_after_real_verification(self):
        archive = Path(self.tmp.name) / f"linux-{VERSION}.tar.xz"
        archive.write_bytes(b"fake compressed source")
        receipt = {"status": "verified", "trusted_primary_fingerprint": self.fingerprint_if_present()}
        with (
            mock.patch.object(
                BUILDER, "download_authentication_input",
                side_effect=[b"signature-bytes", b"a2V5\n"],
            ),
            mock.patch.object(BUILDER.UPSTREAM_SIGNATURE, "verify", return_value=receipt) as verify,
            mock.patch.object(BUILDER, "SOURCE_CONTRACT", self.contract),
        ):
            observed = BUILDER.authenticate_upstream_archive(
                self.source, archive, Path(self.tmp.name)
            )
        self.assertEqual(observed, receipt)
        self.assertEqual(
            (Path(self.tmp.name) / "kernel-maintainer-public-key.asc").read_bytes(),
            b"key",
        )
        verify.assert_called_once()

    def fingerprint_if_present(self):
        return self.source["upstream_signature"]["trusted_primary_fingerprint"]

    def test_signed_build_requires_verified_receipt_before_extraction(self):
        archive = Path(self.tmp.name) / f"linux-{VERSION}.tar.xz"
        archive.write_bytes(b"fake compressed source")
        with (
            mock.patch.object(BUILDER, "download_authentication_input", side_effect=[b"sig", b"a2V5"]),
            mock.patch.object(BUILDER.UPSTREAM_SIGNATURE, "verify", side_effect=BUILDER.UPSTREAM_SIGNATURE.VerificationError("bad signature")),
            mock.patch.object(BUILDER, "SOURCE_CONTRACT", self.contract),
        ):
            with self.assertRaisesRegex(BUILDER.BuildError, "OpenPGP authentication failed"):
                BUILDER.authenticate_upstream_archive(self.source, archive, Path(self.tmp.name))


if __name__ == "__main__":
    unittest.main()
