#!/usr/bin/env python3
"""Read-only, opt-in staging gateway preflight for an independent Site bundle.

No credentials, POST requests, cookies, login simulations, deployment or DNS
changes. Passing proves ONLY the anonymous response contracts at that origin,
not authenticated Identity, publishing authority, or production readiness.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import re
import json
import ssl
import tempfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

from build import SCHEMA as SITE_BUNDLE_SCHEMA, SiteError, validate_bundle_inventory
from public_identity_state import PublicIdentityStateError, resolve_public_identity_mode
from public_release_catalog import PublicReleaseCatalogError, validate_catalog
from vercel_staging_transport import VercelTransportError, get_raw as vercel_get_raw

MAX_CONFIG = 32 * 1024
MAX_SESSION = 16 * 1024
MAX_CATALOG = 256 * 1024
MAX_MANIFEST = 512 * 1024
FULL_SHA = re.compile(r"[0-9a-f]{40}")
SHA256 = re.compile(r"[0-9a-f]{64}")


class StagingPreflightError(ValueError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def validate_staging_origin(value: str) -> str:
    """Only explicitly selected HTTPS staging/preview hosts may be probed."""
    if not isinstance(value, str) or value != value.strip():
        raise StagingPreflightError("staging-origin-invalid")
    try:
        parsed = urlsplit(value)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        requested_port = parsed.port
    except ValueError as error:
        raise StagingPreflightError("staging-origin-invalid") from error
    if (parsed.scheme != "https" or not hostname or parsed.username or parsed.password
            or requested_port not in (None, 443) or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment or parsed.netloc.endswith(".")):
        raise StagingPreflightError("staging-origin-invalid")
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise StagingPreflightError("staging-origin-ip-address-forbidden")
    if hostname in {"localhost", "ordax.com.br", "www.ordax.com.br"} or hostname.endswith(".local"):
        raise StagingPreflightError("staging-origin-production-or-local")
    labels = hostname.split(".")
    if (len(labels) < 2 or not all(label and label.isascii() and
            all(c.isalnum() or c == "-" for c in label) and
            not label.startswith("-") and not label.endswith("-") for label in labels)):
        raise StagingPreflightError("staging-origin-host-invalid")
    # Explicit staging/preview naming prevents accidentally using an arbitrary
    # production host. This is not a certificate of environment ownership.
    if not ({"staging", "preview"} & set(labels)
            or hostname.endswith((".vercel.app", ".pages.dev"))):
        raise StagingPreflightError("staging-origin-not-explicit")
    return "https://" + hostname


def _parse_json_response(status: int, headers, raw: bytes, path: str,
                         maximum: int) -> tuple[int, dict, str, int]:
    """One JSON/MIME/size validation contract for both HTTPS transports."""
    if status not in (200, 503):
        raise StagingPreflightError("unexpected-response-status:" + path)
    media_type = headers.get("Content-Type", headers.get("content-type", ""))
    if media_type.split(";", 1)[0].strip().lower() != "application/json":
        raise StagingPreflightError("json-content-type:" + path)
    cache = headers.get("Cache-Control", headers.get("cache-control", ""))
    if path == "/auth/session" and "no-store" not in cache.lower():
        raise StagingPreflightError("session-not-no-store")
    length = headers.get("Content-Length", headers.get("content-length"))
    if length is not None and (not length.isdigit() or int(length) > maximum):
        raise StagingPreflightError("response-too-large:" + path)
    if len(raw) > maximum:
        raise StagingPreflightError("response-too-large:" + path)
    try:
        result = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError) as error:
        raise StagingPreflightError("invalid-json:" + path) from error
    if not isinstance(result, dict):
        raise StagingPreflightError("json-object-required:" + path)
    return status, result, hashlib.sha256(raw).hexdigest(), len(raw)


def _fetch_json(origin: str, path: str, maximum: int) -> tuple[int, dict, str, int]:
    opener = build_opener(ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context()),
                          NoRedirect())
    req = Request(origin + path, headers={
        "Accept": "application/json", "Accept-Encoding": "identity",
        "User-Agent": "OrdaX-Site-Staging-Preflight/1",
    }, method="GET")
    try:
        response = opener.open(req, timeout=10)
    except HTTPError as error:
        response = error
    except (URLError, TimeoutError, OSError) as error:
        raise StagingPreflightError("staging-network-unavailable") from error
    with response:
        if response.geturl() != origin + path:
            raise StagingPreflightError("redirect-or-origin-mismatch:" + path)
        return _parse_json_response(response.status, response.headers,
                                    response.read(maximum + 1), path, maximum)


def _fetch_vercel_json(origin: str, path: str, maximum: int) -> tuple[int, dict, str, int]:
    try:
        status, headers, raw = vercel_get_raw(origin, path, maximum)
    except VercelTransportError as error:
        raise StagingPreflightError(str(error)) from error
    return _parse_json_response(status, headers, raw, path, maximum)



def _public_file_url(relative: str) -> str:
    """Resolve directory-index HTML to the navigation URL browsers actually use."""
    if relative == "index.html":
        return "/"
    if relative.endswith("/index.html"):
        return "/" + relative[:-len("index.html")]
    return "/" + relative


def _fetch_asset_digest(origin: str, relative: str, expected_size: int) -> tuple[str, int]:
    """Stream one public static asset without cookies, redirects or buffering binary."""
    path = _public_file_url(relative)
    opener = build_opener(ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context()), NoRedirect())
    request = Request(origin + path, headers={
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "User-Agent": "OrdaX-Site-Staging-Preflight/1",
    }, method="GET")
    try:
        response = opener.open(request, timeout=10)
    except HTTPError as error:
        response = error
    except (URLError, TimeoutError, OSError) as error:
        raise StagingPreflightError("site-bundle-file-unavailable:" + relative) from error
    with response:
        if response.status != 200 or response.geturl() != origin + path:
            raise StagingPreflightError("site-bundle-file-http-mismatch:" + relative)
        advertised = response.headers.get("Content-Length")
        if advertised is not None and (not advertised.isdigit() or int(advertised) != expected_size):
            raise StagingPreflightError("site-bundle-file-size-mismatch:" + relative)
        size = 0
        digest = hashlib.sha256()
        while True:
            chunk = response.read(min(65536, expected_size - size + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > expected_size:
                raise StagingPreflightError("site-bundle-file-size-mismatch:" + relative)
            digest.update(chunk)
        return digest.hexdigest(), size


def _fetch_vercel_asset_digest(origin: str, relative: str,
                               expected_size: int) -> tuple[str, int]:
    """Authenticated CLI, same verifier: hash unmodified response bytes."""
    try:
        status, _, raw = vercel_get_raw(origin, _public_file_url(relative), expected_size)
    except VercelTransportError as error:
        raise StagingPreflightError(str(error)) from error
    if status != 200 or len(raw) != expected_size:
        raise StagingPreflightError("site-bundle-file-http-or-size-mismatch:" + relative)
    return hashlib.sha256(raw).hexdigest(), len(raw)


def _manifest_files(manifest: dict) -> dict:
    """Translate the Site builder's single inventory contract to this gate."""
    try:
        return validate_bundle_inventory(manifest)
    except SiteError as error:
        raise StagingPreflightError(str(error)) from error


def _verify_published_file(path: str, record: dict, digest: str, size: int) -> None:
    if digest != record["sha256"] or size != record["size"]:
        raise StagingPreflightError("site-bundle-file-mismatch:" + path)


def evaluate_gateway_contracts(
    fetch_json, fetch_asset, *, expected_site_commit: str, expected_manifest_sha256: str,
    scope: str = "anonymous",
) -> dict:
    """Verify the complete pinned Site bundle, optionally checking anonymous Identity.

    Static PASS is distinct from gateway PASS; neither authorizes deployment,
    authentication or publishing. Both use the same bundle inventory and bytes.
    """
    if scope not in ("static", "anonymous"):
        raise StagingPreflightError("staging-preflight-scope-invalid")
    if not isinstance(expected_site_commit, str) or not FULL_SHA.fullmatch(expected_site_commit):
        raise StagingPreflightError("expected-site-commit-invalid")
    if not isinstance(expected_manifest_sha256, str) or not SHA256.fullmatch(expected_manifest_sha256):
        raise StagingPreflightError("expected-site-manifest-sha256-invalid")

    manifest_status, manifest, manifest_digest, _ = fetch_json(
        "/public-site-manifest.json", MAX_MANIFEST
    )
    if manifest_status != 200 or manifest_digest != expected_manifest_sha256:
        raise StagingPreflightError("site-bundle-manifest-digest-mismatch")
    if (manifest.get("$schema") != SITE_BUNDLE_SCHEMA
            or manifest.get("artifact_class") != "public-site"
            or manifest.get("source_commit") != expected_site_commit
            or manifest.get("catalog_status") != "empty"
            or manifest.get("publications_sha256") is not None):
        raise StagingPreflightError("site-bundle-manifest-identity-invalid")
    files = _manifest_files(manifest)
    # A valid manifest alone is insufficient: a preview can serve correct
    # config/catalog while substituting login HTML, JS or Surface assets.
    # Verify all published files against the pinned CI inventory first.
    for relative, record in sorted(files.items()):
        if relative in ("config/public-site.json", "releases/catalog.json"):
            continue  # Their JSON and raw bytes are checked separately below.
        actual_digest, actual_size = fetch_asset(relative, record["size"])
        _verify_published_file(relative, record, actual_digest, actual_size)
    config_status, config, config_digest, config_size = fetch_json("/config/public-site.json", MAX_CONFIG)
    _verify_published_file("config/public-site.json", files["config/public-site.json"],
                           config_digest, config_size)
    if config_status != 200 or config.get("$schema") != "prototype-ordax.public-site-runtime/1":
        raise StagingPreflightError("site-runtime-contract-invalid")
    downloads = config.get("downloads")
    product = config.get("product")
    web = product.get("web") if isinstance(product, dict) else None
    if not isinstance(downloads, dict) or downloads.get("catalog_url") != "/releases/catalog.json":
        raise StagingPreflightError("catalog-not-canonical-same-origin")
    if not isinstance(web, dict) or web.get("enabled") is not False:
        raise StagingPreflightError("web-product-not-gated")
    identity_mode = "NOT_TESTED"
    if scope == "anonymous":
        session_status, session, _, _ = fetch_json("/auth/session", MAX_SESSION)
        try:
            identity_mode = resolve_public_identity_mode(
                config, session, session_http_status=session_status
            )
        except PublicIdentityStateError as error:
            raise StagingPreflightError("identity-contract:" + str(error)) from error
        if identity_mode == "disabled-unconfigured":
            raise StagingPreflightError("identity-gateway-not-configured")
        if identity_mode == "gated":
            raise StagingPreflightError("identity-gateway-still-gated")
    catalog_status, catalog, catalog_digest, catalog_size = fetch_json(
        "/releases/catalog.json", MAX_CATALOG
    )
    _verify_published_file("releases/catalog.json", files["releases/catalog.json"],
                           catalog_digest, catalog_size)
    if catalog_status != 200:
        raise StagingPreflightError("catalog-http-status-invalid")
    # Reuse the Site's canonical catalog validator, not a second schema.
    with tempfile.TemporaryDirectory(prefix="ordax-site-staging-proof-") as tmp:
        path = Path(tmp) / "catalog.json"
        path.write_text(json.dumps(catalog), encoding="utf-8")
        try:
            checked = validate_catalog(path)
        except PublicReleaseCatalogError as error:
            raise StagingPreflightError("catalog-contract-invalid") from error
    # Until an owner-published attestation is integrated, a "ready" catalog
    # in staging does not prove trustworthy public download authorization.
    if checked["status"] != "empty" or checked["releases"]:
        raise StagingPreflightError("catalog-unattested-publications")
    return {
        "result": "PASS",
        "scope": ("static-bundle-integrity-only" if scope == "static"
                  else "anonymous-staging-contracts-only"),
        "identity_mode": identity_mode,
        "catalog_status": checked["status"],
        "candidate_source_commit": expected_site_commit,
        "verified_bundle_files": len(files),
        "authenticated_e2e": "NOT_TESTED",
        "publisher_attestation": "NOT_TESTED",
        "production_approval": False,
    }


def run(staging_origin: str, expected_site_commit: str, expected_manifest_sha256: str,
        *, scope: str = "anonymous", transport: str = "direct") -> dict:
    origin = validate_staging_origin(staging_origin)
    if transport == "direct":
        read_json = lambda path, maximum: _fetch_json(origin, path, maximum)
        read_asset = lambda relative, size: _fetch_asset_digest(origin, relative, size)
    elif transport == "vercel-cli":
        read_json = lambda path, maximum: _fetch_vercel_json(origin, path, maximum)
        read_asset = lambda relative, size: _fetch_vercel_asset_digest(origin, relative, size)
    else:
        raise StagingPreflightError("staging-transport-unsupported")
    return evaluate_gateway_contracts(
        read_json, read_asset,
        expected_site_commit=expected_site_commit,
        expected_manifest_sha256=expected_manifest_sha256,
        scope=scope,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging-origin", required=True,
                        help="Explicit HTTPS preview/staging origin, never production")
    parser.add_argument("--scope", choices=("static", "anonymous"), default="anonymous",
                        help="Static bundle integrity without Identity, or anonymous gateway integration")
    parser.add_argument("--transport", choices=("direct", "vercel-cli"), default="direct",
                        help="Use official authenticated Vercel CLI to read protected staging bytes")
    parser.add_argument("--expected-site-commit", required=True,
                        help="Exact build source commit from a trusted Site CI artifact")
    parser.add_argument("--expected-manifest-sha256", required=True,
                        help="SHA-256 of public-site-manifest.json from trusted Site CI")
    args = parser.parse_args()
    report = run(args.staging_origin, args.expected_site_commit,
                 args.expected_manifest_sha256, scope=args.scope, transport=args.transport)
    print("SITE_STAGING_PREFLIGHT=" + json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except StagingPreflightError as error:
        raise SystemExit("SITE_STAGING_PREFLIGHT=BLOCKED reason=" + str(error))
