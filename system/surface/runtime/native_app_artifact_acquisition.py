#!/usr/bin/env python3
"""Native HTTPS byte source for content-addressed first-party Store artifacts.

This module owns transport only. It derives a blob URL from a separately
configured HTTPS base origin plus a verified SHA-256 identity. It never accepts
an artifact URL from Store UI, never selects versions or apps, and never stages,
activates, removes, rolls back, or grants permissions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
from urllib import error, parse, request

from native_store_https_origin import (
    StoreHttpsOriginError,
    normalize_store_https_base_origin,
)

from native_app_artifact_store import (
    AppArtifactStoreError,
    MAX_ARTIFACT_BYTES,
    acquire_verified_artifact_set,
    validate_artifact_identity,
)
from native_app_lifecycle_executor import (
    NativeAppLifecycleError,
    validate_lifecycle_plan,
)
from native_store_catalog import (
    StoreCatalogError,
    guard_store_catalog_watermark,
)

DEFAULT_TIMEOUT_SECONDS = 20
USER_AGENT = "OrdaX-Store-Artifact-Transport/1"


class AppArtifactAcquisitionError(RuntimeError):
    pass


class _RejectRedirects(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass(frozen=True)
class HttpsArtifactSource:
    base_origin: str
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS
    opener: object | None = None

    def load(self, identity: dict) -> bytes:
        return load_https_artifact(
            identity,
            base_origin=self.base_origin,
            timeout_seconds=self.timeout_seconds,
            opener=self.opener,
        )


def normalize_https_base_origin(value: object) -> str:
    try:
        return normalize_store_https_base_origin(value)
    except StoreHttpsOriginError as exc:
        raise AppArtifactAcquisitionError(str(exc)) from exc

def artifact_relative_path(identity: object) -> str:
    normalized = validate_artifact_identity(identity)
    digest = normalized["sha256"]
    return f"sha256/{digest[:2]}/{digest}"


def artifact_url(base_origin: object, identity: object) -> str:
    base = normalize_https_base_origin(base_origin)
    relative = artifact_relative_path(identity)
    parsed = parse.urlsplit(base)
    return parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path + relative, "", "")
    )


def _read_bounded(response, expected_size: int) -> bytes:
    payload = bytearray()
    remaining = expected_size + 1
    while remaining > 0:
        chunk = response.read(min(1024 * 1024, remaining))
        if not chunk:
            break
        if not isinstance(chunk, (bytes, bytearray)):
            raise AppArtifactAcquisitionError("artifact HTTPS response body is invalid")
        payload.extend(chunk)
        remaining = expected_size + 1 - len(payload)
    if len(payload) != expected_size:
        raise AppArtifactAcquisitionError("artifact HTTPS response size mismatch")
    return bytes(payload)


def load_https_artifact(
    identity: object,
    *,
    base_origin: object,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    opener=None,
) -> bytes:
    normalized = validate_artifact_identity(identity)
    if (
        not isinstance(timeout_seconds, int)
        or isinstance(timeout_seconds, bool)
        or timeout_seconds <= 0
        or timeout_seconds > 120
    ):
        raise AppArtifactAcquisitionError("artifact HTTPS timeout is invalid")

    url = artifact_url(base_origin, normalized)
    transport = opener or request.build_opener(_RejectRedirects())
    req = request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/octet-stream",
            "Accept-Encoding": "identity",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        response = transport.open(req, timeout=timeout_seconds)
    except (error.URLError, OSError) as exc:
        raise AppArtifactAcquisitionError("artifact HTTPS request failed") from exc

    try:
        status = getattr(response, "status", None)
        if status != 200:
            raise AppArtifactAcquisitionError("artifact HTTPS response status is invalid")
        final_url = response.geturl()
        if final_url != url:
            raise AppArtifactAcquisitionError("artifact HTTPS redirect is not allowed")
        encoding = response.headers.get("Content-Encoding")
        if encoding not in (None, "", "identity"):
            raise AppArtifactAcquisitionError("artifact HTTPS content encoding is not allowed")
        length = response.headers.get("Content-Length")
        if length is not None:
            try:
                declared = int(length)
            except (TypeError, ValueError) as exc:
                raise AppArtifactAcquisitionError("artifact HTTPS content length is invalid") from exc
            if declared != normalized["size"] or declared > MAX_ARTIFACT_BYTES:
                raise AppArtifactAcquisitionError("artifact HTTPS content length mismatch")
        return _read_bounded(response, normalized["size"])
    finally:
        try:
            response.close()
        except Exception:
            pass


def create_https_artifact_loader(
    base_origin: object,
    *,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    opener=None,
) -> Callable[[dict], bytes]:
    base = normalize_https_base_origin(base_origin)
    source = HttpsArtifactSource(
        base_origin=base,
        timeout_seconds=timeout_seconds,
        opener=opener,
    )
    return source.load


def acquire_lifecycle_plan_artifacts(
    raw_plan: object,
    *,
    base_origin: object,
    artifact_root: str,
    watermark_path: str,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    opener=None,
) -> dict[str, str]:
    """Populate the verified artifact cache for a current install/update plan.

    The current catalog watermark is locked for the full acquisition so a plan
    cannot be fulfilled against a catalog identity that changes mid-flight.
    """
    plan = validate_lifecycle_plan(raw_plan)
    if plan["request"]["operation"] not in {"install", "update"} or plan["candidate"] is None:
        raise AppArtifactAcquisitionError("artifact acquisition requires install/update candidate")

    loader = create_https_artifact_loader(
        base_origin,
        timeout_seconds=timeout_seconds,
        opener=opener,
    )
    try:
        with guard_store_catalog_watermark(parse_path(watermark_path)) as watermark:
            if (
                watermark["sequence"] != plan["catalogSequence"]
                or watermark["catalogSha256"] != plan["catalogSha256"]
            ):
                raise AppArtifactAcquisitionError(
                    "artifact acquisition plan does not match current Store catalog watermark"
                )
            try:
                return acquire_verified_artifact_set(
                    plan["candidate"]["artifacts"],
                    loader=loader,
                    root=artifact_root,
                )
            except AppArtifactStoreError as exc:
                raise AppArtifactAcquisitionError(
                    "verified artifact acquisition failed"
                ) from exc
    except StoreCatalogError as exc:
        raise AppArtifactAcquisitionError(
            "current Store catalog watermark is unavailable"
        ) from exc
    except NativeAppLifecycleError as exc:
        raise AppArtifactAcquisitionError("artifact acquisition plan is invalid") from exc


def parse_path(value: object):
    from pathlib import Path

    if not isinstance(value, str) or not value:
        raise AppArtifactAcquisitionError("catalog watermark path is invalid")
    return Path(value)
