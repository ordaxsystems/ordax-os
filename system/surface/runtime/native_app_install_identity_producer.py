#!/usr/bin/env python3
"""Trusted producer core for bundled first-party app install identity receipts.

This module is intentionally dormant. It does not activate Native App Data and
it does not discover publisher identity from app/request metadata. A trusted
runtime owner must provide publisher/app/version policy inputs and an exact
portable-release verification handoff that includes the verified system.erofs
digest.
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
MAX_RELEASE_HANDOFF_BYTES = 64 * 1024

_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
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


@dataclass(frozen=True)
class VerifiedSystemReleaseHandoff:
    status: str
    source_commit: str
    release_path: str
    artifact_path: str
    artifact_sha256: str


def _validate_expected_uid(expected_uid: int) -> int:
    if (
        not isinstance(expected_uid, int)
        or isinstance(expected_uid, bool)
        or expected_uid < 0
    ):
        raise TypeError("expected uid is invalid")
    return expected_uid


def _read_bounded_owned_file(path: str, *, expected_uid: int) -> bytes:
    if not isinstance(path, str) or not path.startswith("/"):
        raise VerifiedSystemReleaseHandoffError("release handoff path is invalid")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise VerifiedSystemReleaseHandoffError("release handoff is unavailable") from exc
    try:
        info = os.fstat(fd)
        mode = stat.S_IMODE(info.st_mode)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != expected_uid
            or info.st_nlink != 1
            or mode & 0o022
            or info.st_size < 1
            or info.st_size > MAX_RELEASE_HANDOFF_BYTES
        ):
            raise VerifiedSystemReleaseHandoffError("release handoff metadata is invalid")
        payload = bytearray()
        while len(payload) < info.st_size:
            chunk = os.read(fd, min(4096, info.st_size - len(payload)))
            if not chunk:
                break
            payload.extend(chunk)
        if len(payload) != info.st_size or os.read(fd, 1):
            raise VerifiedSystemReleaseHandoffError("release handoff changed while reading")
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
    if not isinstance(portable_root, str) or portable_root != PurePosixPath(portable_root).as_posix():
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
            if not isinstance(optional_value, str) or not optional_value.startswith("/"):
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
    payload = _read_bounded_owned_file(path, expected_uid=uid)
    try:
        decoded = json.loads(payload.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise VerifiedSystemReleaseHandoffError("release handoff is invalid JSON") from exc
    return validate_verified_system_release_handoff(decoded, portable_root=portable_root)


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
    *,
    publisher_principal_id: str,
    app_id: str,
    source_version: str,
    verification_policy: str,
    verification_generation: int,
    root: str = DEFAULT_RECEIPT_ROOT,
    expected_uid: int,
) -> str:
    if not isinstance(handoff, VerifiedSystemReleaseHandoff):
        raise TypeError("verified system release handoff is required")
    receipt = {
        "$schema": "ordax.verified-app-install-identity/1",
        "status": "verified",
        "publisherPrincipalId": publisher_principal_id,
        "appId": app_id,
        "ownerScope": "device",
        "sourceClass": "system-release-bundled",
        "sourceVersion": source_version,
        "sourceDigest": handoff.artifact_sha256,
        "verificationOwner": "release-acquisition",
        "verificationPolicy": verification_policy,
        "verificationGeneration": verification_generation,
    }
    return write_verified_app_install_identity_receipt(
        receipt,
        root=root,
        expected_uid=expected_uid,
    )
