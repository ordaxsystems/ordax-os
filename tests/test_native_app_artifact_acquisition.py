from __future__ import annotations

import hashlib
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
import unittest

RUNTIME = Path(__file__).resolve().parents[1] / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

import native_app_artifact_acquisition as acquisition


def identity(name: str, payload: bytes) -> dict:
    return {
        "name": name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }


class FakeResponse:
    def __init__(
        self,
        payload: bytes,
        url: str,
        *,
        status: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self._body = BytesIO(payload)
        self._url = url
        self.status = status
        self.headers = headers or {}

    def read(self, size: int = -1):
        return self._body.read(size)

    def geturl(self):
        return self._url

    def close(self):
        self._body.close()


class FakeOpener:
    def __init__(self, factory) -> None:
        self.factory = factory
        self.requests = []

    def open(self, req, timeout):
        self.requests.append((req, timeout))
        return self.factory(req, timeout)


class NativeAppArtifactAcquisitionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.payload = b"verified-app-artifact"
        self.item = identity("notes.zip", self.payload)
        self.origin = "https://store.example.test/artifacts/"
        self.url = (
            f"{self.origin}sha256/{self.item['sha256'][:2]}/{self.item['sha256']}"
        )

    def test_url_is_derived_only_from_configured_origin_and_sha256(self) -> None:
        self.assertEqual(acquisition.artifact_url(self.origin, self.item), self.url)
        self.assertNotIn("notes.zip", self.url)
        self.assertNotIn("version", self.url)
        self.assertNotIn("appId", self.url)

    def test_base_origin_is_https_only_and_authority_free(self) -> None:
        invalid = [
            "http://store.example.test/",
            "https://user:secret@store.example.test/",
            "https://store.example.test/path/?token=secret",
            "https://store.example.test/path/#fragment",
            " https://store.example.test/",
            "https://store.example.test/a/../b/",
        ]
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(acquisition.AppArtifactAcquisitionError):
                    acquisition.normalize_https_base_origin(value)

    def test_https_loader_fetches_exact_content_addressed_blob(self) -> None:
        opener = FakeOpener(
            lambda req, _timeout: FakeResponse(
                self.payload,
                req.full_url,
                headers={
                    "Content-Length": str(len(self.payload)),
                    "Content-Encoding": "identity",
                },
            )
        )
        result = acquisition.load_https_artifact(
            self.item,
            base_origin=self.origin,
            opener=opener,
        )
        self.assertEqual(result, self.payload)
        self.assertEqual(len(opener.requests), 1)
        req, timeout = opener.requests[0]
        self.assertEqual(req.full_url, self.url)
        self.assertEqual(timeout, acquisition.DEFAULT_TIMEOUT_SECONDS)
        self.assertEqual(req.get_header("Accept"), "application/octet-stream")
        self.assertEqual(req.get_header("Accept-encoding"), "identity")

    def test_redirect_or_origin_change_fails_closed(self) -> None:
        redirected = "https://other.example.test/" + self.item["sha256"]
        opener = FakeOpener(
            lambda _req, _timeout: FakeResponse(
                self.payload,
                redirected,
                headers={"Content-Length": str(len(self.payload))},
            )
        )
        with self.assertRaisesRegex(
            acquisition.AppArtifactAcquisitionError,
            "redirect is not allowed",
        ):
            acquisition.load_https_artifact(
                self.item,
                base_origin=self.origin,
                opener=opener,
            )

    def test_wrong_declared_or_actual_size_fails_closed(self) -> None:
        for payload, declared, message in [
            (self.payload, len(self.payload) + 1, "content length mismatch"),
            (self.payload + b"x", len(self.payload), "response size mismatch"),
            (self.payload[:-1], None, "response size mismatch"),
        ]:
            with self.subTest(payload=len(payload), declared=declared):
                headers = {}
                if declared is not None:
                    headers["Content-Length"] = str(declared)
                opener = FakeOpener(
                    lambda req, _timeout, payload=payload, headers=headers: FakeResponse(
                        payload,
                        req.full_url,
                        headers=headers,
                    )
                )
                with self.assertRaisesRegex(
                    acquisition.AppArtifactAcquisitionError,
                    message,
                ):
                    acquisition.load_https_artifact(
                        self.item,
                        base_origin=self.origin,
                        opener=opener,
                    )

    def test_compressed_transport_is_rejected(self) -> None:
        opener = FakeOpener(
            lambda req, _timeout: FakeResponse(
                self.payload,
                req.full_url,
                headers={
                    "Content-Length": str(len(self.payload)),
                    "Content-Encoding": "gzip",
                },
            )
        )
        with self.assertRaisesRegex(
            acquisition.AppArtifactAcquisitionError,
            "content encoding is not allowed",
        ):
            acquisition.load_https_artifact(
                self.item,
                base_origin=self.origin,
                opener=opener,
            )

    def test_plan_acquisition_holds_current_catalog_identity_and_populates_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_root = root / "artifacts"
            watermark = root / "store" / "catalog-watermark.json"
            watermark.parent.mkdir(mode=0o700)
            catalog_sha = "f" * 64
            watermark.write_text(
                json.dumps({
                    "schema": "ordax.store-catalog-watermark/1",
                    "sequence": 9,
                    "catalogSha256": catalog_sha,
                }, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            payloads = {
                "package": b"package",
                "release": b"release",
                "compatibility": b"compatibility",
                "componentEnvelope": b"envelope",
            }
            artifacts = {
                role: identity(
                    "notes.runtime-component-envelope.json"
                    if role == "componentEnvelope"
                    else f"notes.{role}.bin",
                    payload,
                )
                for role, payload in payloads.items()
            }
            by_url = {
                acquisition.artifact_url(self.origin, record): payloads[role]
                for role, record in artifacts.items()
            }
            opener = FakeOpener(
                lambda req, _timeout: FakeResponse(
                    by_url[req.full_url],
                    req.full_url,
                    headers={"Content-Length": str(len(by_url[req.full_url]))},
                )
            )
            plan = {
                "schema": "ordax.app-lifecycle-plan/1",
                "request": {
                    "schema": "ordax.app-lifecycle-request/1",
                    "requestId": "store:install:notes:test",
                    "appId": "notes",
                    "operation": "install",
                    "source": "store",
                    "authority": "none",
                },
                "catalogSequence": 9,
                "catalogSha256": catalog_sha,
                "catalogSourceCommit": "a" * 40,
                "candidate": {
                    "appId": "notes",
                    "version": "0.4.3",
                    "sourceCommit": "a" * 40,
                    "artifacts": artifacts,
                },
                "authority": "none",
            }
            resolved = acquisition.acquire_lifecycle_plan_artifacts(
                plan,
                base_origin=self.origin,
                artifact_root=str(artifact_root),
                watermark_path=str(watermark),
                opener=opener,
            )
            self.assertEqual(set(resolved), set(payloads))
            self.assertEqual(len(opener.requests), 4)
            for role, path in resolved.items():
                self.assertEqual(Path(path).read_bytes(), payloads[role])

            # A second acquisition is offline from the verified content-addressed cache.
            opener2 = FakeOpener(
                lambda _req, _timeout: self.fail("cached artifact must not refetch")
            )
            resolved_again = acquisition.acquire_lifecycle_plan_artifacts(
                plan,
                base_origin=self.origin,
                artifact_root=str(artifact_root),
                watermark_path=str(watermark),
                opener=opener2,
            )
            self.assertEqual(resolved_again, resolved)
            self.assertEqual(opener2.requests, [])

    def test_plan_acquisition_rejects_stale_catalog_before_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            watermark = root / "store" / "catalog-watermark.json"
            watermark.parent.mkdir(mode=0o700)
            watermark.write_text(
                json.dumps({
                    "schema": "ordax.store-catalog-watermark/1",
                    "sequence": 10,
                    "catalogSha256": "e" * 64,
                }, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            plan = {
                "schema": "ordax.app-lifecycle-plan/1",
                "request": {
                    "schema": "ordax.app-lifecycle-request/1",
                    "requestId": "store:install:notes:test",
                    "appId": "notes",
                    "operation": "install",
                    "source": "store",
                    "authority": "none",
                },
                "catalogSequence": 9,
                "catalogSha256": "f" * 64,
                "catalogSourceCommit": "a" * 40,
                "candidate": {
                    "appId": "notes",
                    "version": "0.4.3",
                    "sourceCommit": "a" * 40,
                    "artifacts": {
                        role: identity(
                            "notes.runtime-component-envelope.json"
                            if role == "componentEnvelope"
                            else f"notes.{role}.bin",
                            role.encode("utf-8"),
                        )
                        for role in (
                            "package",
                            "release",
                            "compatibility",
                            "componentEnvelope",
                        )
                    },
                },
                "authority": "none",
            }
            opener = FakeOpener(
                lambda _req, _timeout: self.fail("stale plan must not hit network")
            )
            with self.assertRaisesRegex(
                acquisition.AppArtifactAcquisitionError,
                "does not match current Store catalog watermark",
            ):
                acquisition.acquire_lifecycle_plan_artifacts(
                    plan,
                    base_origin=self.origin,
                    artifact_root=str(root / "artifacts"),
                    watermark_path=str(watermark),
                    opener=opener,
                )
            self.assertEqual(opener.requests, [])


if __name__ == "__main__":
    unittest.main()
