#!/usr/bin/env python3
"""Canonical Native validation for content-addressed Profile install receipts."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat

PROFILE_INSTALL_RECEIPT_SCHEMA = "ordax.profile-install-receipt/1"
PROFILE_CONTENT_HEALTH_SCHEMA = "ordax.profile-content-health/1"
DEFAULT_PROFILE_RECEIPT_ROOT = "/var/lib/ordax/profile-content-receipts"
MAX_PROFILE_RECEIPT_BYTES = 64 * 1024

_ID_RE = re.compile(r"^[a-z][a-z0-9._-]{1,127}$")
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$"
)
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_KINDS = frozenset((
    "app",
    "knowledge-pack",
    "skill-pack",
    "model-pack",
    "connector",
))
_MAX_SAFE_INTEGER = (1 << 53) - 1


def _exact_keys(value: object, expected: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(f"{label} fields are incompatible")
    return value


def _bounded_text(value: object, label: str, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum
        or "\0" in value
    ):
        raise ValueError(f"{label} is invalid")
    return value


def _epoch(value: object, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > _MAX_SAFE_INTEGER
    ):
        raise ValueError(f"{label} is invalid")
    return value


def validate_profile_install_receipt(value: object) -> dict:
    receipt = _exact_keys(
        value,
        {"schema", "artifact", "verification", "health", "installedAt"},
        "Profile install receipt",
    )
    if receipt["schema"] != PROFILE_INSTALL_RECEIPT_SCHEMA:
        raise ValueError("Profile install receipt schema is unsupported")

    artifact = _exact_keys(
        receipt["artifact"],
        {"id", "kind", "version", "sha256", "sizeBytes"},
        "Profile install receipt artifact",
    )
    component_id = _bounded_text(artifact["id"], "artifact id", 128)
    if _ID_RE.fullmatch(component_id) is None:
        raise ValueError("artifact id is invalid")
    kind = artifact["kind"]
    if kind not in _KINDS:
        raise ValueError("artifact kind is unsupported")
    version = _bounded_text(artifact["version"], "artifact version", 64)
    if _SEMVER_RE.fullmatch(version) is None:
        raise ValueError("artifact version is invalid")
    artifact_sha = _bounded_text(artifact["sha256"], "artifact sha256", 64)
    if _SHA256_RE.fullmatch(artifact_sha) is None:
        raise ValueError("artifact sha256 is invalid")
    size_bytes = artifact["sizeBytes"]
    if (
        isinstance(size_bytes, bool)
        or not isinstance(size_bytes, int)
        or size_bytes <= 0
        or size_bytes > _MAX_SAFE_INTEGER
    ):
        raise ValueError("artifact sizeBytes is invalid")

    verification = _exact_keys(
        receipt["verification"],
        {"signatureAlgorithm", "keyId", "manifestSha256", "verifiedAt"},
        "Profile install receipt verification",
    )
    if verification["signatureAlgorithm"] != "ed25519":
        raise ValueError("Profile install receipt signature algorithm is unsupported")
    key_id = _bounded_text(verification["keyId"], "verification keyId", 160)
    manifest_sha = _bounded_text(
        verification["manifestSha256"], "verification manifestSha256", 64
    )
    if _SHA256_RE.fullmatch(manifest_sha) is None:
        raise ValueError("verification manifestSha256 is invalid")
    verified_at = _epoch(verification["verifiedAt"], "verifiedAt")

    health = _exact_keys(
        receipt["health"],
        {
            "schema", "state", "entryCount", "perEntryHashVerified",
            "perEntryProvenanceVerified", "executablePayloadAllowed",
            "authority", "checkedAt",
        },
        "Profile install receipt health",
    )
    if health["schema"] != PROFILE_CONTENT_HEALTH_SCHEMA or health["state"] != "healthy":
        raise ValueError("Profile install receipt health is not healthy")
    entry_count = health["entryCount"]
    if (
        isinstance(entry_count, bool)
        or not isinstance(entry_count, int)
        or entry_count < 1
        or entry_count > 2048
    ):
        raise ValueError("Profile install receipt entryCount is invalid")
    if (
        health["perEntryHashVerified"] is not True
        or health["perEntryProvenanceVerified"] is not True
        or health["executablePayloadAllowed"] is not False
        or health["authority"] != "none"
    ):
        raise ValueError("Profile install receipt health authority is unsafe")
    checked_at = _epoch(health["checkedAt"], "checkedAt")
    installed_at = _epoch(receipt["installedAt"], "installedAt")

    return {
        "schema": PROFILE_INSTALL_RECEIPT_SCHEMA,
        "artifact": {
            "id": component_id,
            "kind": kind,
            "version": version,
            "sha256": artifact_sha,
            "sizeBytes": size_bytes,
        },
        "verification": {
            "signatureAlgorithm": "ed25519",
            "keyId": key_id,
            "manifestSha256": manifest_sha,
            "verifiedAt": verified_at,
        },
        "health": {
            "schema": PROFILE_CONTENT_HEALTH_SCHEMA,
            "state": "healthy",
            "entryCount": entry_count,
            "perEntryHashVerified": True,
            "perEntryProvenanceVerified": True,
            "executablePayloadAllowed": False,
            "authority": "none",
            "checkedAt": checked_at,
        },
        "installedAt": installed_at,
    }


def canonical_profile_install_receipt_bytes(value: object) -> bytes:
    receipt = validate_profile_install_receipt(value)
    return (
        json.dumps(
            receipt,
            separators=(",", ":"),
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def read_verified_profile_install_receipt(
    receipt_sha256: str,
    receipt_root: str = DEFAULT_PROFILE_RECEIPT_ROOT,
) -> dict:
    if not isinstance(receipt_sha256, str) or _SHA256_RE.fullmatch(receipt_sha256) is None:
        raise ValueError("Profile install receipt hash is invalid")

    root_info = os.stat(receipt_root, follow_symlinks=False)
    if (
        not stat.S_ISDIR(root_info.st_mode)
        or stat.S_ISLNK(root_info.st_mode)
        or stat.S_IMODE(root_info.st_mode) & 0o077
    ):
        raise ValueError("Profile receipt directory boundary is unsafe")

    path = os.path.join(receipt_root, f"{receipt_sha256}.json")
    descriptor = os.open(
        path,
        os.O_RDONLY
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or stat.S_IMODE(info.st_mode) & 0o077
            or info.st_size <= 0
            or info.st_size > MAX_PROFILE_RECEIPT_BYTES
        ):
            raise ValueError("Installed Profile component receipt boundary is unsafe")
        chunks: list[bytes] = []
        remaining = MAX_PROFILE_RECEIPT_BYTES + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
    finally:
        os.close(descriptor)

    if len(raw) > MAX_PROFILE_RECEIPT_BYTES:
        raise ValueError("Installed Profile component receipt exceeds maximum size")
    if hashlib.sha256(raw).hexdigest() != receipt_sha256:
        raise ValueError("Installed Profile component receipt hash mismatch")
    try:
        parsed = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Installed Profile component receipt is invalid JSON") from exc
    receipt = validate_profile_install_receipt(parsed)
    if canonical_profile_install_receipt_bytes(receipt) != raw:
        raise ValueError("Installed Profile component receipt is not canonical")
    return receipt
