"""Offline regression tests for Site-bundle-pinned anonymous staging preflight."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build import SCHEMA as SITE_BUNDLE_SCHEMA
from staging_preflight import (
    StagingPreflightError,
    evaluate_gateway_contracts,
    validate_staging_origin,
    _fetch_asset_digest,
    _manifest_files,
    _public_file_url,
)

SITE_COMMIT = "1" * 40
CONFIG = {
    "$schema": "prototype-ordax.public-site-runtime/1",
    "downloads": {"catalog_url": "/releases/catalog.json"},
    "product": {"web": {"enabled": False}},
    "legal": {"account_activation_ready": False, "auth_only_source_enabled": True},
}
SESSION = {
    "$schema": "prototype-ordax.public-identity-session/1",
    "provider": "supabase", "authenticated": False, "status": "anonymous",
}
CATALOG = {
    "$schema": "prototype-ordax.public-release-catalog/1",
    "status": "empty", "releases": [],
}
ASSETS = {
    "index.html": b"<!doctype html><title>OrdaX</title>",
    "assets/site.js": b"console.log('public shell')",
    "login/index.html": b"<!doctype html><title>Login</title>",
}


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def make_fetch(overrides=None):
    """Build a pinned Site fixture from the chosen served config/catalog."""
    responses = {
        "/config/public-site.json": (200, CONFIG),
        "/auth/session": (200, SESSION),
        "/releases/catalog.json": (200, CATALOG),
    }
    responses.update(overrides or {})
    inventory = []
    for path in ("config/public-site.json", "releases/catalog.json"):
        item = responses["/" + path][1]
        inventory.append({"path": path, "sha256": digest(item), "size": len(encoded(item))})
    for name, content in ASSETS.items():
        inventory.append({
            "path": name,
            "sha256": hashlib.sha256(content).hexdigest(),
            "size": len(content),
        })
    manifest = {
        "$schema": SITE_BUNDLE_SCHEMA,
        "source_commit": SITE_COMMIT,
        "artifact_class": "public-site",
        "catalog_status": "empty",
        "publications_sha256": None,
        "files": inventory,
    }
    responses["/public-site-manifest.json"] = (200, manifest)
    expected_manifest_sha256 = digest(manifest)
    observed = []

    def fetch(path, maximum):
        observed.append((path, maximum))
        status, payload = responses[path]
        return status, copy.deepcopy(payload), digest(payload), len(encoded(payload))

    def fetch_asset(name, size):
        observed.append(("asset:" + name, size))
        content = ASSETS[name]
        return hashlib.sha256(content).hexdigest(), len(content)

    fetch.asset = fetch_asset
    return fetch, observed, expected_manifest_sha256


def prove(fetch, trusted_manifest_sha256, *, asset=None):
    return evaluate_gateway_contracts(
        fetch, asset or getattr(fetch, "asset", lambda *_: (_ for _ in ()).throw(AssertionError("early-failure-required"))),
        expected_site_commit=SITE_COMMIT,
        expected_manifest_sha256=trusted_manifest_sha256,
    )


class StagingPreflightTests(unittest.TestCase):
    def test_only_explicit_staging_https_is_allowed(self):
        for candidate in (
            "http://staging.example.org", "https://ordax.com.br",
            "https://www.ordax.com.br", "https://localhost",
            "https://127.0.0.1", "https://[::1]",
            "https://example.org", "https://staging.example.org/other",
            "https://staging.example.org?token=abc",
            "https://user:password@staging.example.org",
            "https://staging.example.org:8080",
            "https://staging.example.org:invalid",
        ):
            with self.subTest(candidate=candidate), self.assertRaises(StagingPreflightError):
                validate_staging_origin(candidate)
        self.assertEqual(validate_staging_origin("https://staging.example.org/"),
                         "https://staging.example.org")
        self.assertEqual(validate_staging_origin("https://ordax-site-test.vercel.app"),
                         "https://ordax-site-test.vercel.app")

    def test_valid_anonymous_staging_only_passes_pinned_bundle_and_contracts(self):
        fetch, calls, pin = make_fetch()
        result = prove(fetch, pin)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["candidate_source_commit"], SITE_COMMIT)
        self.assertEqual(result["identity_mode"], "auth-only")
        self.assertEqual(result["catalog_status"], "empty")
        self.assertEqual(result["authenticated_e2e"], "NOT_TESTED")
        self.assertEqual(result["publisher_attestation"], "NOT_TESTED")
        self.assertFalse(result["production_approval"])
        self.assertEqual([path for path, _ in calls], [
            "/public-site-manifest.json",
            "asset:assets/site.js", "asset:index.html", "asset:login/index.html",
            "/config/public-site.json", "/auth/session", "/releases/catalog.json"
        ])

    def test_static_scope_checks_complete_bundle_without_identity_backend(self):
        unavailable = {
            "$schema": "prototype-ordax.public-site-proxy-error/1",
            "error": "account-gateway-unconfigured",
        }
        fetch, calls, pin = make_fetch({"/auth/session": (503, unavailable)})
        result = evaluate_gateway_contracts(
            fetch, fetch.asset, expected_site_commit=SITE_COMMIT,
            expected_manifest_sha256=pin, scope="static",
        )
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["scope"], "static-bundle-integrity-only")
        self.assertEqual(result["identity_mode"], "NOT_TESTED")
        self.assertEqual(result["verified_bundle_files"], 5)
        self.assertEqual(result["catalog_status"], "empty")
        self.assertEqual(result["authenticated_e2e"], "NOT_TESTED")
        self.assertEqual(result["publisher_attestation"], "NOT_TESTED")
        self.assertFalse(result["production_approval"])
        self.assertEqual([path for path, _ in calls], [
            "/public-site-manifest.json",
            "asset:assets/site.js", "asset:index.html", "asset:login/index.html",
            "/config/public-site.json", "/releases/catalog.json",
        ])
        # The original anonymous gate must NOT be weakened by static PASS.
        with self.assertRaisesRegex(StagingPreflightError, "active-account-session-unavailable"):
            prove(fetch, pin)

    def test_static_scope_still_rejects_manifest_assets_and_catalog(self):
        fetch, _, pin = make_fetch()
        with self.assertRaisesRegex(StagingPreflightError, "staging-preflight-scope-invalid"):
            evaluate_gateway_contracts(
                fetch, fetch.asset, expected_site_commit=SITE_COMMIT,
                expected_manifest_sha256=pin, scope="production",
            )
        with self.assertRaisesRegex(StagingPreflightError, "site-bundle-manifest-digest-mismatch"):
            evaluate_gateway_contracts(
                fetch, fetch.asset, expected_site_commit=SITE_COMMIT,
                expected_manifest_sha256="0" * 64, scope="static",
            )

        def altered_script(name, size):
            digest_value, actual_size = fetch.asset(name, size)
            return (("f" * 64) if name == "assets/site.js" else digest_value), actual_size

        with self.assertRaisesRegex(StagingPreflightError, "site-bundle-file-mismatch:assets/site.js"):
            evaluate_gateway_contracts(
                fetch, altered_script, expected_site_commit=SITE_COMMIT,
                expected_manifest_sha256=pin, scope="static",
            )

        invalid_catalog = {**CATALOG, "status": "ready", "releases": []}
        fetch_bad, _, bad_pin = make_fetch({
            "/releases/catalog.json": (200, invalid_catalog),
        })
        with self.assertRaisesRegex(StagingPreflightError, "catalog"):
            evaluate_gateway_contracts(
                fetch_bad, fetch_bad.asset, expected_site_commit=SITE_COMMIT,
                expected_manifest_sha256=bad_pin, scope="static",
            )

    def test_stale_os_bundle_or_mismatched_manifest_never_passes(self):
        fetch, calls, pin = make_fetch()
        with self.assertRaisesRegex(StagingPreflightError, "site-bundle-manifest-digest-mismatch"):
            prove(fetch, "0" * 64)
        self.assertEqual([path for path, _ in calls], ["/public-site-manifest.json"])
        fetch, _, pin = make_fetch({
            "/config/public-site.json": (200, CONFIG)
        })
        with self.assertRaisesRegex(StagingPreflightError, "expected-site-commit-invalid"):
            evaluate_gateway_contracts(fetch, fetch.asset, expected_site_commit="old",
                                       expected_manifest_sha256=pin)
        with self.assertRaisesRegex(StagingPreflightError, "expected-site-manifest-sha256-invalid"):
            evaluate_gateway_contracts(fetch, fetch.asset, expected_site_commit=SITE_COMMIT,
                                       expected_manifest_sha256="weak")

    def test_incorrect_site_source_commit_or_legacy_bundle_is_blocked(self):
        fetch, _, pin = make_fetch()
        with self.assertRaisesRegex(StagingPreflightError, "site-bundle-manifest-identity-invalid"):
            evaluate_gateway_contracts(fetch, fetch.asset, expected_site_commit="2" * 40,
                                       expected_manifest_sha256=pin)

        def legacy(path, limit):
            if path == "/public-site-manifest.json":
                return 503, {"error": "missing"}, "0" * 64, 10
            raise AssertionError("must fail before reading legacy API")

        with self.assertRaisesRegex(StagingPreflightError, "site-bundle-manifest-digest-mismatch"):
            prove(legacy, pin)

    def test_published_config_and_catalog_must_match_bundle_inventory_bytes(self):
        fetch, _, pin = make_fetch()
        def tampered_config(path, maximum):
            status, payload, sha, size = fetch(path, maximum)
            if path == "/config/public-site.json":
                return status, payload, "f" * 64, size
            return status, payload, sha, size
        with self.assertRaisesRegex(StagingPreflightError, "site-bundle-file-mismatch:config"):
            prove(tampered_config, pin, asset=fetch.asset)

        def tampered_catalog(path, maximum):
            status, payload, sha, size = fetch(path, maximum)
            if path == "/releases/catalog.json":
                return status, payload, sha, size + 1
            return status, payload, sha, size
        with self.assertRaisesRegex(StagingPreflightError, "site-bundle-file-mismatch:releases"):
            prove(tampered_catalog, pin, asset=fetch.asset)

    def test_injected_login_html_or_javascript_is_rejected_before_identity(self):
        for tampered in ("login/index.html", "assets/site.js"):
            with self.subTest(tampered=tampered):
                fetch, calls, pin = make_fetch()

                def injected(name, size):
                    actual_sha, actual_size = fetch.asset(name, size)
                    if name == tampered:
                        return "f" * 64, actual_size
                    return actual_sha, actual_size

                with self.assertRaisesRegex(StagingPreflightError, "site-bundle-file-mismatch"):
                    prove(fetch, pin, asset=injected)
                self.assertNotIn("/auth/session", [path for path, _ in calls])

    def test_missing_static_asset_is_not_ignored(self):
        fetch, _, pin = make_fetch()
        def unavailable(name, size):
            raise StagingPreflightError("site-bundle-file-http-mismatch:" + name)
        with self.assertRaisesRegex(StagingPreflightError, "site-bundle-file-http-mismatch"):
            prove(fetch, pin, asset=unavailable)

    def test_static_transfer_checks_real_response_bytes_and_size_without_network(self):
        class Response(io.BytesIO):
            def __init__(self, raw, *, status=200, url, advertised=None):
                super().__init__(raw)
                self.status = status
                self.url = url
                self.headers = {"Content-Length": str(advertised)} if advertised is not None else {}
            def geturl(self):
                return self.url

        class FakeOpener:
            def __init__(self, response):
                self.response = response
            def open(self, request, timeout):
                self.request = request
                return self.response

        origin = "https://ordax-site-staging.vercel.app"
        raw = b"published <html>."
        self.assertEqual(_public_file_url("index.html"), "/")
        self.assertEqual(_public_file_url("conta/index.html"), "/conta/")
        self.assertEqual(_public_file_url("assets/site.js"), "/assets/site.js")

        response = Response(raw, url=origin + "/conta/", advertised=len(raw))
        opener = FakeOpener(response)
        with patch("staging_preflight.build_opener", return_value=opener):
            sha, size = _fetch_asset_digest(origin, "conta/index.html", len(raw))
        self.assertEqual(size, len(raw))
        self.assertEqual(sha, hashlib.sha256(raw).hexdigest())
        self.assertEqual(opener.request.get_method(), "GET")
        self.assertIsNone(opener.request.get_header("Cookie"))
        self.assertEqual(opener.request.get_header("Accept-encoding"), "identity")

        bad = [
            Response(raw, status=302, url=origin + "/conta/"),
            Response(raw, url=origin + "/login/", advertised=len(raw)),
            Response(raw, url=origin + "/conta/", advertised=len(raw) + 1),
            Response(raw + b"x", url=origin + "/conta/"),
        ]
        for reply in bad:
            with self.subTest(reply=reply.status, url=reply.url, headers=reply.headers):
                with patch("staging_preflight.build_opener",
                           return_value=FakeOpener(reply)):
                    with self.assertRaisesRegex(
                        StagingPreflightError,
                        "site-bundle-file-(http|size)-mismatch",
                    ):
                        _fetch_asset_digest(origin, "conta/index.html", len(raw))

    def test_bundle_inventory_rejects_ambiguous_paths_and_oversized_total(self):
        good = [{"path": p, "sha256": hashlib.sha256(raw).hexdigest(),
                 "size": len(raw)} for p, raw in ASSETS.items()]
        good += [{"path": p, "sha256": digest(data), "size": len(encoded(data))}
                 for p, data in (("config/public-site.json", CONFIG),
                                 ("releases/catalog.json", CATALOG))]
        self.assertEqual(len(_manifest_files({"files": good})), len(good))
        for bad_path in (
            "/index.html", "conta//index.html", "conta/../index.html",
            "conta/./index.html", "conta/index.html/", "foo/%2e%2e/bar",
            "assets\\site.js",
        ):
            bad = copy.deepcopy(good)
            bad[0]["path"] = bad_path
            with self.subTest(path=bad_path), self.assertRaisesRegex(
                StagingPreflightError, "site-bundle-file-inventory-invalid"
            ):
                _manifest_files({"files": bad})
        oversized = copy.deepcopy(good)
        oversized[0]["size"] = 65 * 1024 * 1024
        with self.assertRaisesRegex(
            StagingPreflightError, "site-bundle-file-inventory-too-large"
        ):
            _manifest_files({"files": oversized})

    def test_unavailable_active_gateway_is_never_reported_ready(self):
        bad = {"$schema": "prototype-ordax.public-site-proxy-error/1",
               "error": "account-gateway-unconfigured"}
        fetch, _, pin = make_fetch({"/auth/session": (503, bad)})
        with self.assertRaisesRegex(StagingPreflightError, "active-account-session-unavailable"):
            prove(fetch, pin)

    def test_unconfigured_gated_identity_cannot_claim_integration_ready(self):
        config = {**CONFIG, "legal": {
            "account_activation_ready": False, "auth_only_source_enabled": False
        }}
        gated = {**SESSION, "provider": "gated", "status": "unavailable"}
        fetch, _, pin = make_fetch({
            "/config/public-site.json": (200, config),
            "/auth/session": (200, gated),
        })
        with self.assertRaisesRegex(StagingPreflightError, "identity-gateway-still-gated"):
            prove(fetch, pin)

    def test_wrong_session_provider_or_authenticated_session_fails(self):
        for session in (
            {**SESSION, "provider": "gated"},
            {**SESSION, "authenticated": True, "status": "authenticated", "subject": "fake"},
        ):
            with self.subTest(session=session):
                fetch, _, pin = make_fetch({"/auth/session": (200, session)})
                with self.assertRaisesRegex(StagingPreflightError, "identity-contract"):
                    prove(fetch, pin)

    def test_static_client_cannot_force_web_or_catalog_authority(self):
        for config in (
            {**CONFIG, "product": {"web": {"enabled": True}}},
            {**CONFIG, "product": {"web": None}},
            {**CONFIG, "downloads": {"catalog_url": "//malicious.example/catalog"}},
            {**CONFIG, "downloads": None},
        ):
            with self.subTest(config=config):
                fetch, _, pin = make_fetch({"/config/public-site.json": (200, config)})
                with self.assertRaises(StagingPreflightError):
                    prove(fetch, pin)

    def test_ready_or_malformed_release_catalog_is_refused(self):
        for value in (
            {**CATALOG, "status": "ready", "releases": [{"release_id": "invented"}]},
            {**CATALOG, "status": "empty", "releases": [{"release_id": "invented"}]},
            {**CATALOG, "status": "ready", "releases": []},
            {**CATALOG, "unexpected": "field"},
        ):
            with self.subTest(catalog=value):
                fetch, _, pin = make_fetch({"/releases/catalog.json": (200, value)})
                with self.assertRaisesRegex(StagingPreflightError, "catalog"):
                    prove(fetch, pin)

    def test_missing_catalog_or_invalid_config_fails(self):
        fetch, _, pin = make_fetch({"/releases/catalog.json": (503, CATALOG)})
        with self.assertRaisesRegex(StagingPreflightError, "catalog-http-status"):
            prove(fetch, pin)
        fetch, _, pin = make_fetch({"/config/public-site.json": (200, {**CONFIG, "$schema": "other"})})
        with self.assertRaisesRegex(StagingPreflightError, "site-runtime-contract"):
            prove(fetch, pin)


if __name__ == "__main__":
    unittest.main()
