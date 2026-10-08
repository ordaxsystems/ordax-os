#!/usr/bin/env python3
"""Fail-closed HTTPS acquisition for the signed first-party Store catalog.

The remote source may provide bytes only. Cryptographic verification and
anti-replay acceptance remain owned by native_store_catalog.
"""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
from urllib import error, parse, request

from native_store_https_origin import (
    StoreHttpsOriginError,
    normalize_store_https_base_origin,
)

from native_store_catalog import (
    MAX_ENVELOPE_BYTES,
    StoreCatalogError,
    promote_verified_store_catalog_envelope,
    verify_store_catalog_envelope,
)

DEFAULT_TIMEOUT_SECONDS = 20
CATALOG_ENVELOPE_NAME = "catalog-envelope.json"
USER_AGENT = "OrdaX-Store-Catalog-Transport/1"


class StoreCatalogAcquisitionError(RuntimeError):
    pass


class _RejectRedirects(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def normalize_catalog_base_origin(value: object) -> str:
    try:
        return normalize_store_https_base_origin(value)
    except StoreHttpsOriginError as exc:
        raise StoreCatalogAcquisitionError(str(exc)) from exc

def catalog_envelope_url(base_origin: object) -> str:
    base = normalize_catalog_base_origin(base_origin)
    parsed = parse.urlsplit(base)
    return parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path + CATALOG_ENVELOPE_NAME, "", "")
    )


def _read_bounded(response) -> bytes:
    payload = bytearray()
    remaining = MAX_ENVELOPE_BYTES + 1
    while remaining > 0:
        chunk = response.read(min(1024 * 1024, remaining))
        if not chunk:
            break
        if not isinstance(chunk, (bytes, bytearray)):
            raise StoreCatalogAcquisitionError("Store catalog HTTPS response body is invalid")
        payload.extend(chunk)
        remaining = MAX_ENVELOPE_BYTES + 1 - len(payload)
    if not payload or len(payload) > MAX_ENVELOPE_BYTES:
        raise StoreCatalogAcquisitionError("Store catalog HTTPS response size is invalid")
    return bytes(payload)


def fetch_store_catalog_envelope(
    *,
    base_origin: object,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    opener=None,
) -> bytes:
    if (
        not isinstance(timeout_seconds, int)
        or isinstance(timeout_seconds, bool)
        or timeout_seconds <= 0
        or timeout_seconds > 120
    ):
        raise StoreCatalogAcquisitionError("Store catalog HTTPS timeout is invalid")

    url = catalog_envelope_url(base_origin)
    transport = opener or request.build_opener(_RejectRedirects())
    req = request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        response = transport.open(req, timeout=timeout_seconds)
    except (error.URLError, OSError) as exc:
        raise StoreCatalogAcquisitionError("Store catalog HTTPS request failed") from exc

    try:
        if getattr(response, "status", None) != 200:
            raise StoreCatalogAcquisitionError("Store catalog HTTPS response status is invalid")
        if response.geturl() != url:
            raise StoreCatalogAcquisitionError("Store catalog HTTPS redirect is not allowed")
        encoding = response.headers.get("Content-Encoding")
        if encoding not in (None, "", "identity"):
            raise StoreCatalogAcquisitionError(
                "Store catalog HTTPS content encoding is not allowed"
            )
        length = response.headers.get("Content-Length")
        if length is not None:
            try:
                declared = int(length)
            except (TypeError, ValueError) as exc:
                raise StoreCatalogAcquisitionError(
                    "Store catalog HTTPS content length is invalid"
                ) from exc
            if declared <= 0 or declared > MAX_ENVELOPE_BYTES:
                raise StoreCatalogAcquisitionError(
                    "Store catalog HTTPS content length is outside allowed bounds"
                )
        payload = _read_bounded(response)
        if length is not None and len(payload) != declared:
            raise StoreCatalogAcquisitionError(
                "Store catalog HTTPS content length mismatch"
            )
        return payload
    finally:
        try:
            response.close()
        except Exception:
            pass


def acquire_and_promote_store_catalog(
    *,
    base_origin: object,
    helper_path: Path,
    trust_path: Path,
    envelope_path: Path,
    watermark_path: Path,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    opener=None,
    runner=None,
) -> tuple[dict, bool]:
    """Fetch, verify and atomically promote a signed Store catalog candidate."""
    payload = fetch_store_catalog_envelope(
        base_origin=base_origin,
        timeout_seconds=timeout_seconds,
        opener=opener,
    )
    parent = envelope_path.parent
    try:
        metadata = parent.lstat()
    except OSError as exc:
        raise StoreCatalogAcquisitionError(
            "Store catalog envelope parent is unavailable"
        ) from exc
    if not parent.is_dir() or parent.is_symlink():
        raise StoreCatalogAcquisitionError(
            "Store catalog envelope parent must be a real directory"
        )

    fd, candidate_name = tempfile.mkstemp(
        prefix=".catalog-envelope.remote-",
        dir=parent,
    )
    candidate = Path(candidate_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())

        verify_kwargs = {
            "helper_path": helper_path,
            "trust_path": trust_path,
            "envelope_path": candidate,
        }
        if runner is not None:
            verify_kwargs["runner"] = runner
        try:
            verified = verify_store_catalog_envelope(**verify_kwargs)
            return promote_verified_store_catalog_envelope(
                verified_catalog=verified,
                candidate_envelope_path=candidate,
                envelope_path=envelope_path,
                watermark_path=watermark_path,
            )
        except StoreCatalogError as exc:
            raise StoreCatalogAcquisitionError(
                "remote Store catalog verification or promotion failed"
            ) from exc
    finally:
        try:
            candidate.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass
