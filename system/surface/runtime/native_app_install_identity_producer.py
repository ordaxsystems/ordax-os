#!/usr/bin/env python3
"""Trusted producer core for bundled first-party app install identity receipts.

This module is intentionally dormant. It does not activate Native App Data.
Bundled receipts require two independent trusted inputs owned by the platform:

1. an exact portable-release verification handoff that carries the already
   authenticated system.erofs digest; and
2. a first-party identity selected from the machine-readable inventory shipped
   inside that authenticated system release.

App/request metadata never supplies publisher principal, app id, component
version, source digest, source class or verification owner to the producer.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import stat
from dataclasses import dataclass
from pathlib import PurePosixPath

from native_app_install_identity import (
    DEFAULT_RECEIPT_ROOT,
    MAX_RECEIPT_BYTES,
    RECEIPT_FILE_MODE,
    RECEIPT_ROOT_MODE,
    VerifiedAppInstallIdentityError,
    canonical_verified_app_install_identity_bytes,
    read_verified_app_install_identity,
)

DEFAULT_RELEASE_HANDOFF_PATH = "/run/portable-release-verify.json"
DEFAULT_PORTABLE_ROOT = "/ordax-data/.ordax"
DEFAULT_FIRST_PARTY_IDENTITY_INVENTORY_PATH = (
    "/srv/ordax-system/services/apps/first-party-identities.json"
)
MAX_RELEASE_HANDOFF_BYTES = 64 * 1024
MAX_IDENTITY_INVENTORY_BYTES = 64 * 1024
FIRST_PARTY_IDENTITY_INVENTORY_SCHEMA = "ordax.first-party-app-identity-inventory/1"
FIRST_PARTY_IDENTITY_INVENTORY_STATUS = "system-release-authenticated-source"
FIRST_PARTY_IDENTITY_INVENTORY_AUTHORITY = "semantic-identity-only"

_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_PUBLISHER_PRINCIPAL_RE = re.compile(r"^[a-z][a-z0-9.-]{0,95}$")
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$"
)
_POLICY_RE = re.compile(r"^[a-z][a-z0-9.-]{0,95}/[1-9][0-9]{0,5}$")
_INVENTORY_AUTHORITY_TOKEN = object()
_STATUS_FIELDS = {
    "verified-portable-exact": {
        "status",
        "source_commit",
        "release_path",
        "artifact_path",
        "artifact_sha256",
        "activation_allowed",
    },
    "verified-portable-v3-exact": {
        "status",
        "source_commit",
        "release_path",
        "artifact_path",
        "artifact_sha256",
        "runtime_path",
        "activation_allowed",
    },
    "verified-portable-v4-exact": {
        "status",
        "source_commit",
        "release_path",
        "artifact_path",
        "artifact_sha256",
        "runtime_path",
        "ai_runtime_path",
        "activation_allowed",
    },
}


class VerifiedSystemReleaseHandoffError(RuntimeError):
    pass


class FirstPartyIdentityInventoryError(RuntimeError):
    pass


@dataclass(frozen=True)
class VerifiedSystemReleaseHandoff:
    status: str
    source_commit: str
    release_path: str
    artifact_path: str
    artifact_sha256: str


class VerifiedBundledAppIdentity:
    __slots__ = (
        "publisher_principal_id",
        "app_id",
        "source_version",
        "verification_policy",
        "verification_generation",
    )

    def __init__(
        self,
        *,
        publisher_principal_id: str,
        app_id: str,
        source_version: str,
        verification_policy: str,
        verification_generation: int,
        _authority: object,
    ) -> None:
        if _authority is not _INVENTORY_AUTHORITY_TOKEN:
            raise TypeError("bundled app identity must come from verified inventory")
        object.__setattr__(self, "publisher_principal_id", publisher_principal_id)
        object.__setattr__(self, "app_id", app_id)
        object.__setattr__(self, "source_version", source_version)
        object.__setattr__(self, "verification_policy", verification_policy)
        object.__setattr__(self, "verification_generation", verification_generation)

    def __setattr__(self, _name, _value) -> None:
        raise AttributeError("verified bundled app identity is immutable")


def _validate_expected_uid(expected_uid: int) -> int:
    if (
        not isinstance(expected_uid, int)
        or isinstance(expected_uid, bool)
        or expected_uid < 0
    ):
        raise TypeError("expected uid is invalid")
    return expected_uid


def _read_bounded_owned_file(
    path: str,
    *,
    expected_uid: int,
    max_bytes: int,
    label: str,
    error_type: type[RuntimeError],
) -> bytes:
    if not isinstance(path, str) or not path.startswith("/") or "\x00" in path:
        raise error_type(f"{label} path is invalid")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise error_type(f"{label} is unavailable") from exc
    try:
        info = os.fstat(fd)
        mode = stat.S_IMODE(info.st_mode)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != expected_uid
            or info.st_nlink != 1
            or mode & 0o022
            or info.st_size < 1
            or info.st_size > max_bytes
        ):
            raise error_type(f"{label} metadata is invalid")
        payload = bytearray()
        while len(payload) < info.st_size:
            chunk = os.read(fd, min(4096, info.st_size - len(payload)))
            if not chunk:
                break
            payload.extend(chunk)
        if len(payload) != info.st_size or os.read(fd, 1):
            raise error_type(f"{label} changed while reading")
        return bytes(payload)
    finally:
        os.close(fd)


def _canonical_child(parent: str, *parts: str) -> str:
    base = PurePosixPath(parent)
    child = base.joinpath(*parts)
    if not child.is_absolute() or ".." in child.parts:
        raise VerifiedSystemReleaseHandoffError("release handoff path is not canonical")
    return child.as_posix()


def validate_verified_system_release_handoff(
    value: object,
    *,
    portable_root: str = DEFAULT_PORTABLE_ROOT,
) -> VerifiedSystemReleaseHandoff:
    if not isinstance(value, dict):
        raise VerifiedSystemReleaseHandoffError("release handoff must be an object")
    status = value.get("status")
    expected_fields = _STATUS_FIELDS.get(status)
    if expected_fields is None or set(value) != expected_fields:
        raise VerifiedSystemReleaseHandoffError("release handoff fields/status are invalid")

    commit = value.get("source_commit")
    digest = value.get("artifact_sha256")
    if not isinstance(commit, str) or _COMMIT_RE.fullmatch(commit) is None:
        raise VerifiedSystemReleaseHandoffError("release handoff source commit is invalid")
    if not isinstance(digest, str) or _SHA256_RE.fullmatch(digest) is None:
        raise VerifiedSystemReleaseHandoffError("release handoff system digest is invalid")
    if value.get("activation_allowed") is not False:
        raise VerifiedSystemReleaseHandoffError("release handoff activation flag is invalid")
    if (
        not isinstance(portable_root, str)
        or not PurePosixPath(portable_root).is_absolute()
        or portable_root != PurePosixPath(portable_root).as_posix()
    ):
        raise VerifiedSystemReleaseHandoffError("portable root is invalid")

    expected_release = _canonical_child(portable_root, "releases", commit)
    expected_artifact = _canonical_child(expected_release, "system.erofs")
    if value.get("release_path") != expected_release:
        raise VerifiedSystemReleaseHandoffError("release handoff release path is not canonical")
    if value.get("artifact_path") != expected_artifact:
        raise VerifiedSystemReleaseHandoffError("release handoff artifact path is not canonical")

    for optional_key in ("runtime_path", "ai_runtime_path"):
        if optional_key in value:
            optional_value = value[optional_key]
            if (
                not isinstance(optional_value, str)
                or not PurePosixPath(optional_value).is_absolute()
                or ".." in PurePosixPath(optional_value).parts
                or optional_value != PurePosixPath(optional_value).as_posix()
            ):
                raise VerifiedSystemReleaseHandoffError(
                    f"release handoff {optional_key} is invalid"
                )

    return VerifiedSystemReleaseHandoff(
        status=status,
        source_commit=commit,
        release_path=expected_release,
        artifact_path=expected_artifact,
        artifact_sha256=digest,
    )


def read_verified_system_release_handoff(
    path: str = DEFAULT_RELEASE_HANDOFF_PATH,
    *,
    expected_uid: int,
    portable_root: str = DEFAULT_PORTABLE_ROOT,
) -> VerifiedSystemReleaseHandoff:
    uid = _validate_expected_uid(expected_uid)
    payload = _read_bounded_owned_file(
        path,
        expected_uid=uid,
        max_bytes=MAX_RELEASE_HANDOFF_BYTES,
        label="release handoff",
        error_type=VerifiedSystemReleaseHandoffError,
    )
    try:
        decoded = json.loads(payload.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise VerifiedSystemReleaseHandoffError("release handoff is invalid JSON") from exc
    return validate_verified_system_release_handoff(decoded, portable_root=portable_root)


def validate_first_party_identity_inventory(value: object) -> dict:
    if not isinstance(value, dict):
        raise FirstPartyIdentityInventoryError("first-party identity inventory must be an object")
    expected = {
        "$schema",
        "status",
        "authority",
        "verificationPolicy",
        "verificationGeneration",
        "apps",
    }
    if set(value) != expected:
        raise FirstPartyIdentityInventoryError("first-party identity inventory fields are invalid")
    if value["$schema"] != FIRST_PARTY_IDENTITY_INVENTORY_SCHEMA:
        raise FirstPartyIdentityInventoryError("first-party identity inventory schema is invalid")
    if value["status"] != FIRST_PARTY_IDENTITY_INVENTORY_STATUS:
        raise FirstPartyIdentityInventoryError("first-party identity inventory status is invalid")
    if value["authority"] != FIRST_PARTY_IDENTITY_INVENTORY_AUTHORITY:
        raise FirstPartyIdentityInventoryError("first-party identity inventory authority is invalid")

    policy = value["verificationPolicy"]
    generation = value["verificationGeneration"]
    if not isinstance(policy, str) or _POLICY_RE.fullmatch(policy) is None:
        raise FirstPartyIdentityInventoryError("first-party verification policy is invalid")
    if (
        not isinstance(generation, int)
        or isinstance(generation, bool)
        or generation < 1
        or generation > 2**53 - 1
    ):
        raise FirstPartyIdentityInventoryError("first-party verification generation is invalid")

    apps = value["apps"]
    if not isinstance(apps, list) or not apps or len(apps) > 256:
        raise FirstPartyIdentityInventoryError("first-party identity app list is invalid")
    normalized_apps = []
    seen = set()
    for entry in apps:
        if not isinstance(entry, dict) or set(entry) != {
            "appId",
            "publisherPrincipalId",
            "version",
        }:
            raise FirstPartyIdentityInventoryError("first-party app identity fields are invalid")
        app_id = entry["appId"]
        principal = entry["publisherPrincipalId"]
        version = entry["version"]
        if not isinstance(app_id, str) or _APP_ID_RE.fullmatch(app_id) is None:
            raise FirstPartyIdentityInventoryError("first-party app id is invalid")
        if app_id in seen:
            raise FirstPartyIdentityInventoryError("first-party app id is duplicated")
        seen.add(app_id)
        if (
            not isinstance(principal, str)
            or _PUBLISHER_PRINCIPAL_RE.fullmatch(principal) is None
        ):
            raise FirstPartyIdentityInventoryError("first-party publisher principal is invalid")
        if not isinstance(version, str) or _SEMVER_RE.fullmatch(version) is None:
            raise FirstPartyIdentityInventoryError("first-party app version is invalid")
        normalized_apps.append(
            {
                "appId": app_id,
                "publisherPrincipalId": principal,
                "version": version,
            }
        )

    if [entry["appId"] for entry in normalized_apps] != sorted(seen):
        raise FirstPartyIdentityInventoryError("first-party identity inventory must be sorted")
    return {
        "$schema": FIRST_PARTY_IDENTITY_INVENTORY_SCHEMA,
        "status": FIRST_PARTY_IDENTITY_INVENTORY_STATUS,
        "authority": FIRST_PARTY_IDENTITY_INVENTORY_AUTHORITY,
        "verificationPolicy": policy,
        "verificationGeneration": generation,
        "apps": normalized_apps,
    }


def read_bundled_first_party_identity(
    app_id: str,
    *,
    path: str = DEFAULT_FIRST_PARTY_IDENTITY_INVENTORY_PATH,
    expected_uid: int,
) -> VerifiedBundledAppIdentity:
    uid = _validate_expected_uid(expected_uid)
    if not isinstance(app_id, str) or _APP_ID_RE.fullmatch(app_id) is None:
        raise FirstPartyIdentityInventoryError("requested first-party app id is invalid")
    payload = _read_bounded_owned_file(
        path,
        expected_uid=uid,
        max_bytes=MAX_IDENTITY_INVENTORY_BYTES,
        label="first-party identity inventory",
        error_type=FirstPartyIdentityInventoryError,
    )
    try:
        decoded = json.loads(payload.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise FirstPartyIdentityInventoryError("first-party identity inventory is invalid JSON") from exc
    inventory = validate_first_party_identity_inventory(decoded)
    for entry in inventory["apps"]:
        if entry["appId"] == app_id:
            return VerifiedBundledAppIdentity(
                publisher_principal_id=entry["publisherPrincipalId"],
                app_id=entry["appId"],
                source_version=entry["version"],
                verification_policy=inventory["verificationPolicy"],
                verification_generation=inventory["verificationGeneration"],
                _authority=_INVENTORY_AUTHORITY_TOKEN,
            )
    raise FirstPartyIdentityInventoryError("requested first-party app is not in inventory")


def _assert_receipt_root(root: str, expected_uid: int) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(root, flags)
    except OSError as exc:
        raise VerifiedAppInstallIdentityError(
            "verified install identity root is unavailable"
        ) from exc
    info = os.fstat(fd)
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != expected_uid
        or stat.S_IMODE(info.st_mode) != RECEIPT_ROOT_MODE
    ):
        os.close(fd)
        raise VerifiedAppInstallIdentityError(
            "verified install identity root ownership/mode is invalid"
        )
    return fd


def _write_all(fd: int, payload: bytes) -> None:
    offset = 0
    while offset < len(payload):
        written = os.write(fd, payload[offset:])
        if written <= 0:
            raise OSError("short write while persisting verified install identity")
        offset += written


def write_verified_app_install_identity_receipt(
    value: object,
    *,
    root: str = DEFAULT_RECEIPT_ROOT,
    expected_uid: int,
) -> str:
    uid = _validate_expected_uid(expected_uid)
    payload = canonical_verified_app_install_identity_bytes(value)
    if len(payload) > MAX_RECEIPT_BYTES:
        raise VerifiedAppInstallIdentityError("verified install identity receipt is too large")
    digest = hashlib.sha256(payload).hexdigest()
    final_name = f"{digest}.json"
    root_fd = _assert_receipt_root(root, uid)
    temporary_name = f".receipt-{secrets.token_hex(16)}.tmp"
    temp_fd = -1
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        temp_fd = os.open(temporary_name, flags, RECEIPT_FILE_MODE, dir_fd=root_fd)
        os.fchmod(temp_fd, RECEIPT_FILE_MODE)
        _write_all(temp_fd, payload)
        os.fsync(temp_fd)
        os.close(temp_fd)
        temp_fd = -1
        try:
            os.link(
                temporary_name,
                final_name,
                src_dir_fd=root_fd,
                dst_dir_fd=root_fd,
                follow_symlinks=False,
            )
        except FileExistsError:
            pass
        finally:
            try:
                os.unlink(temporary_name, dir_fd=root_fd)
            except FileNotFoundError:
                pass
        os.fsync(root_fd)
    finally:
        if temp_fd >= 0:
            os.close(temp_fd)
            try:
                os.unlink(temporary_name, dir_fd=root_fd)
            except FileNotFoundError:
                pass
        os.close(root_fd)

    verified = read_verified_app_install_identity(
        digest,
        root=root,
        expected_uid=uid,
    )
    if verified.receipt_sha256 != digest:
        raise VerifiedAppInstallIdentityError("persisted verified identity digest changed")
    return digest


def produce_system_release_bundled_receipt(
    handoff: VerifiedSystemReleaseHandoff,
    app_identity: VerifiedBundledAppIdentity,
    *,
    root: str = DEFAULT_RECEIPT_ROOT,
    expected_uid: int,
) -> str:
    if not isinstance(handoff, VerifiedSystemReleaseHandoff):
        raise TypeError("verified system release handoff is required")
    if not isinstance(app_identity, VerifiedBundledAppIdentity):
        raise TypeError("verified bundled app identity is required")
    receipt = {
        "$schema": "ordax.verified-app-install-identity/1",
        "status": "verified",
        "publisherPrincipalId": app_identity.publisher_principal_id,
        "appId": app_identity.app_id,
        "ownerScope": "device",
        "sourceClass": "system-release-bundled",
        "sourceVersion": app_identity.source_version,
        "sourceDigest": handoff.artifact_sha256,
        "verificationOwner": "release-acquisition",
        "verificationPolicy": app_identity.verification_policy,
        "verificationGeneration": app_identity.verification_generation,
    }
    return write_verified_app_install_identity_receipt(
        receipt,
        root=root,
        expected_uid=expected_uid,
    )
