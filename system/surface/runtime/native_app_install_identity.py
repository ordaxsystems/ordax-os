#!/usr/bin/env python3
"""Fail-closed consumer for verified app install identity receipts.

This module does not verify packages and does not mint App Data capabilities.
It consumes an immutable, content-addressed receipt whose exact digest is
supplied by a trusted install/inventory owner.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass

RECEIPT_SCHEMA = "ordax.verified-app-install-identity/1"
DEFAULT_RECEIPT_ROOT = "/var/lib/ordax/app-install/verified-identities/v1"
MAX_RECEIPT_BYTES = 16 * 1024
RECEIPT_ROOT_MODE = 0o700
RECEIPT_FILE_MODE = 0o600

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_PUBLISHER_PRINCIPAL_RE = re.compile(r"^[a-z][a-z0-9.-]{0,95}$")
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$"
)
_POLICY_RE = re.compile(r"^[a-z][a-z0-9.-]{0,95}/[1-9][0-9]{0,5}$")

_SOURCE_OWNER = {
    "system-release-bundled": "release-acquisition",
    "component-release-v2": "component-manager",
    "external-app-production": "app-install-owner",
}


class VerifiedAppInstallIdentityError(RuntimeError):
    pass


@dataclass(frozen=True)
class VerifiedAppInstallIdentity:
    publisher_principal_id: str
    app_id: str
    owner_scope: str
    source_class: str
    source_version: str
    source_digest: str
    verification_owner: str
    verification_policy: str
    verification_generation: int
    receipt_sha256: str

    def app_data_identity(self) -> dict:
        return {
            "publisherId": self.publisher_principal_id,
            "appId": self.app_id,
            "ownerScope": self.owner_scope,
        }


def _canonical_payload(value: dict) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        + "\n"
    ).encode("utf-8")


def _bounded_string(value: object, label: str, pattern: re.Pattern[str]) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise VerifiedAppInstallIdentityError(f"{label} is invalid")
    return value


def validate_verified_app_install_identity(value: object) -> dict:
    if not isinstance(value, dict):
        raise VerifiedAppInstallIdentityError("verified install identity receipt must be an object")
    expected = {
        "$schema",
        "status",
        "publisherPrincipalId",
        "appId",
        "ownerScope",
        "sourceClass",
        "sourceVersion",
        "sourceDigest",
        "verificationOwner",
        "verificationPolicy",
        "verificationGeneration",
    }
    if set(value) != expected:
        raise VerifiedAppInstallIdentityError(
            "verified install identity receipt fields are not canonical"
        )
    if value["$schema"] != RECEIPT_SCHEMA or value["status"] != "verified":
        raise VerifiedAppInstallIdentityError("verified install identity receipt schema/status is invalid")

    publisher = _bounded_string(
        value["publisherPrincipalId"],
        "publisher principal id",
        _PUBLISHER_PRINCIPAL_RE,
    )
    app_id = _bounded_string(value["appId"], "app id", _APP_ID_RE)
    if value["ownerScope"] != "device":
        raise VerifiedAppInstallIdentityError("owner scope is unsupported")

    source_class = value["sourceClass"]
    if source_class not in _SOURCE_OWNER:
        raise VerifiedAppInstallIdentityError("source class is unsupported")
    source_version = _bounded_string(value["sourceVersion"], "source version", _SEMVER_RE)
    source_digest = _bounded_string(value["sourceDigest"], "source digest", _SHA256_RE)

    verification_owner = value["verificationOwner"]
    if verification_owner != _SOURCE_OWNER[source_class]:
        raise VerifiedAppInstallIdentityError(
            "verification owner does not match source class"
        )
    verification_policy = _bounded_string(
        value["verificationPolicy"],
        "verification policy",
        _POLICY_RE,
    )
    generation = value["verificationGeneration"]
    if (
        not isinstance(generation, int)
        or isinstance(generation, bool)
        or generation < 1
        or generation > 2**53 - 1
    ):
        raise VerifiedAppInstallIdentityError("verification generation is invalid")

    return {
        "$schema": RECEIPT_SCHEMA,
        "status": "verified",
        "publisherPrincipalId": publisher,
        "appId": app_id,
        "ownerScope": "device",
        "sourceClass": source_class,
        "sourceVersion": source_version,
        "sourceDigest": source_digest,
        "verificationOwner": verification_owner,
        "verificationPolicy": verification_policy,
        "verificationGeneration": generation,
    }


def canonical_verified_app_install_identity_bytes(value: object) -> bytes:
    return _canonical_payload(validate_verified_app_install_identity(value))


def _assert_owned_directory(fd: int, expected_uid: int) -> None:
    info = os.fstat(fd)
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != expected_uid
        or stat.S_IMODE(info.st_mode) != RECEIPT_ROOT_MODE
    ):
        raise VerifiedAppInstallIdentityError(
            "verified install identity root ownership/mode is invalid"
        )


def _assert_owned_file(fd: int, expected_uid: int) -> int:
    info = os.fstat(fd)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != expected_uid
        or stat.S_IMODE(info.st_mode) != RECEIPT_FILE_MODE
        or info.st_nlink != 1
        or info.st_size < 1
        or info.st_size > MAX_RECEIPT_BYTES
    ):
        raise VerifiedAppInstallIdentityError(
            "verified install identity receipt metadata is invalid"
        )
    return info.st_size


def _read_exact(fd: int, size: int) -> bytes:
    payload = bytearray()
    while len(payload) < size:
        chunk = os.read(fd, min(4096, size - len(payload)))
        if not chunk:
            break
        payload.extend(chunk)
    if len(payload) != size or os.read(fd, 1):
        raise VerifiedAppInstallIdentityError(
            "verified install identity receipt changed while reading"
        )
    return bytes(payload)


def read_verified_app_install_identity(
    receipt_sha256: str,
    *,
    root: str = DEFAULT_RECEIPT_ROOT,
    expected_uid: int,
) -> VerifiedAppInstallIdentity:
    digest = _bounded_string(receipt_sha256, "receipt sha256", _SHA256_RE)
    if (
        not isinstance(expected_uid, int)
        or isinstance(expected_uid, bool)
        or expected_uid < 0
    ):
        raise VerifiedAppInstallIdentityError("expected uid is invalid")

    directory_flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    directory_flags |= getattr(os, "O_DIRECTORY", 0)
    directory_flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        root_fd = os.open(root, directory_flags)
    except OSError as exc:
        raise VerifiedAppInstallIdentityError(
            "verified install identity root is unavailable"
        ) from exc

    try:
        _assert_owned_directory(root_fd, expected_uid)
        file_flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        file_flags |= getattr(os, "O_NOFOLLOW", 0)
        try:
            receipt_fd = os.open(f"{digest}.json", file_flags, dir_fd=root_fd)
        except OSError as exc:
            raise VerifiedAppInstallIdentityError(
                "verified install identity receipt is unavailable"
            ) from exc

        try:
            size = _assert_owned_file(receipt_fd, expected_uid)
            payload = _read_exact(receipt_fd, size)
        finally:
            os.close(receipt_fd)
    finally:
        os.close(root_fd)

    actual_digest = hashlib.sha256(payload).hexdigest()
    if actual_digest != digest:
        raise VerifiedAppInstallIdentityError(
            "verified install identity receipt digest mismatch"
        )
    try:
        decoded = json.loads(payload.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise VerifiedAppInstallIdentityError(
            "verified install identity receipt is invalid JSON"
        ) from exc

    normalized = validate_verified_app_install_identity(decoded)
    canonical = _canonical_payload(normalized)
    if payload != canonical:
        raise VerifiedAppInstallIdentityError(
            "verified install identity receipt is not canonical"
        )

    return VerifiedAppInstallIdentity(
        publisher_principal_id=normalized["publisherPrincipalId"],
        app_id=normalized["appId"],
        owner_scope=normalized["ownerScope"],
        source_class=normalized["sourceClass"],
        source_version=normalized["sourceVersion"],
        source_digest=normalized["sourceDigest"],
        verification_owner=normalized["verificationOwner"],
        verification_policy=normalized["verificationPolicy"],
        verification_generation=normalized["verificationGeneration"],
        receipt_sha256=digest,
    )
