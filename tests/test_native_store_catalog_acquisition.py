from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

import native_store_catalog_acquisition as acquisition


COMMIT = "a" * 40


def artifact(name: str, char: str) -> dict:
    return {"name": name, "sha256": char * 64, "size": 123}


def verified(sequence: int, digest: str) -> dict:
    return {
        "schema": "ordax.verified-app-store-catalog/1",
        "state": "ready",
        "sequence": sequence,
        "catalogSha256": digest,
        "source": {
            "repository": "washingtonmsdj/ordax-apps",
            "commit": COMMIT,
        },
        "trust": {
            "domain": "runtime-components",
            "keyId": "ordax-runtime-components-v1",
        },
        "entries": [{
            "appId": "notes",
            "title": "Notas",
            "version": "0.4.3",
            "releaseMode": "component-slot",
            "sourceCommit": COMMIT,
            "artifacts": {
                "package": artifact("notes.zip", "b"),
                "release": artifact("notes.release.json", "c"),
                "compatibility": artifact("notes.compatibility.json", "d"),
                "componentEnvelope": artifact(
                    "notes.runtime-component-envelope.json",
                    "e",
                ),
            },
        }],
        "reason": None,
        "authority": "none",
    }


class FakeResponse:
    def __init__(self, payload: bytes, url: str, *, status=200, headers=None):
        self._body = BytesIO(payload)
        self._url = url
        self.status = status
        self.headers = headers or {}

    def read(self, size=-1):
        return self._body.read(size)

    def geturl(self):
        return self._url

    def close(self):
        self._body.close()


class FakeOpener:
    def __init__(self, factory):
        self.factory = factory
        self.calls = []

    def open(self, req, timeout):
        self.calls.append((req, timeout))
        return self.factory(req, timeout)


class Result:
    returncode = 0
    stdout = ""
    stderr = ""


class NativeStoreCatalogAcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = self.root / "store"
        self.store.mkdir(mode=0o700)
        self.envelope = self.store / "catalog-envelope.json"
        self.watermark = self.store / "catalog-watermark.json"
        self.helper = self.root / "ordax-runtime-component-channel"
        self.helper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        self.helper.chmod(self.helper.stat().st_mode | stat.S_IXUSR)
        self.trust = self.root / "trust.json"
        self.trust.write_text("{}\n", encoding="utf-8")
        self.origin = "https://store.example.test/catalog/"
        self.url = self.origin + "catalog-envelope.json"

    def tearDown(self):
        self.temp.cleanup()

    def runner_for(self, catalog):
        def runner(argv, **kwargs):
            out = Path(argv[argv.index("--out") + 1])
            out.write_text(
                json.dumps(catalog, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            return Result()
        return runner

    def test_catalog_url_is_fixed_under_configured_https_origin(self):
        self.assertEqual(acquisition.catalog_envelope_url(self.origin), self.url)
        for invalid in [
            "http://store.example.test/",
            "https://user:secret@store.example.test/",
            "https://store.example.test/?token=x",
            "https://store.example.test/#x",
            "https://store.example.test/a/../b/",
        ]:
            with self.subTest(invalid=invalid):
                with self.assertRaises(acquisition.StoreCatalogAcquisitionError):
                    acquisition.catalog_envelope_url(invalid)

    def test_fetch_rejects_redirect_compression_and_oversize_declaration(self):
        cases = [
            (
                FakeOpener(lambda _req, _timeout: FakeResponse(
                    b"{}",
                    "https://other.example.test/catalog-envelope.json",
                    headers={"Content-Length": "2"},
                )),
                "redirect",
            ),
            (
                FakeOpener(lambda req, _timeout: FakeResponse(
                    b"{}",
                    req.full_url,
                    headers={"Content-Length": "2", "Content-Encoding": "gzip"},
                )),
                "encoding",
            ),
            (
                FakeOpener(lambda req, _timeout: FakeResponse(
                    b"{}",
                    req.full_url,
                    headers={"Content-Length": str(acquisition.MAX_ENVELOPE_BYTES + 1)},
                )),
                "outside allowed bounds",
            ),
        ]
        for opener, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(
                    acquisition.StoreCatalogAcquisitionError,
                    message,
                ):
                    acquisition.fetch_store_catalog_envelope(
                        base_origin=self.origin,
                        opener=opener,
                    )

    def test_verified_higher_catalog_replaces_lkg_then_advances_watermark(self):
        self.envelope.write_bytes(b"old-signed-envelope")
        self.watermark.write_text(
            json.dumps({
                "schema": "ordax.store-catalog-watermark/1",
                "sequence": 7,
                "catalogSha256": "7" * 64,
            }, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        remote = b"new-signed-envelope"
        opener = FakeOpener(lambda req, _timeout: FakeResponse(
            remote,
            req.full_url,
            headers={"Content-Length": str(len(remote))},
        ))
        catalog, changed = acquisition.acquire_and_promote_store_catalog(
            base_origin=self.origin,
            helper_path=self.helper,
            trust_path=self.trust,
            envelope_path=self.envelope,
            watermark_path=self.watermark,
            opener=opener,
            runner=self.runner_for(verified(8, "8" * 64)),
        )
        self.assertTrue(changed)
        self.assertEqual(catalog["sequence"], 8)
        self.assertEqual(self.envelope.read_bytes(), remote)
        persisted = json.loads(self.watermark.read_text(encoding="utf-8"))
        self.assertEqual(persisted["sequence"], 8)
        self.assertEqual(persisted["catalogSha256"], "8" * 64)

    def test_replay_or_equivocation_never_clobbers_lkg_envelope(self):
        original = b"known-good-envelope"
        self.envelope.write_bytes(original)
        self.watermark.write_text(
            json.dumps({
                "schema": "ordax.store-catalog-watermark/1",
                "sequence": 9,
                "catalogSha256": "9" * 64,
            }, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        for catalog in [
            verified(8, "8" * 64),
            verified(9, "a" * 64),
        ]:
            opener = FakeOpener(lambda req, _timeout: FakeResponse(
                b"remote-candidate",
                req.full_url,
                headers={"Content-Length": str(len(b"remote-candidate"))},
            ))
            with self.assertRaisesRegex(
                acquisition.StoreCatalogAcquisitionError,
                "verification or promotion failed",
            ):
                acquisition.acquire_and_promote_store_catalog(
                    base_origin=self.origin,
                    helper_path=self.helper,
                    trust_path=self.trust,
                    envelope_path=self.envelope,
                    watermark_path=self.watermark,
                    opener=opener,
                    runner=self.runner_for(catalog),
                )
            self.assertEqual(self.envelope.read_bytes(), original)
            persisted = json.loads(self.watermark.read_text(encoding="utf-8"))
            self.assertEqual(persisted["sequence"], 9)
            self.assertEqual(persisted["catalogSha256"], "9" * 64)

    def test_failed_crypto_verification_never_replaces_lkg(self):
        original = b"known-good-envelope"
        self.envelope.write_bytes(original)
        remote = b"invalid-remote-envelope"
        opener = FakeOpener(lambda req, _timeout: FakeResponse(
            remote,
            req.full_url,
            headers={"Content-Length": str(len(remote))},
        ))

        class Failed:
            returncode = 1
            stdout = ""
            stderr = "bad signature"

        with self.assertRaisesRegex(
            acquisition.StoreCatalogAcquisitionError,
            "verification or promotion failed",
        ):
            acquisition.acquire_and_promote_store_catalog(
                base_origin=self.origin,
                helper_path=self.helper,
                trust_path=self.trust,
                envelope_path=self.envelope,
                watermark_path=self.watermark,
                opener=opener,
                runner=lambda *args, **kwargs: Failed(),
            )
        self.assertEqual(self.envelope.read_bytes(), original)
        self.assertFalse(self.watermark.exists())


if __name__ == "__main__":
    unittest.main()
