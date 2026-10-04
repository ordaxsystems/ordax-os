#!/usr/bin/env python3
"""Trusted current-boot consumer for verified App Data receipt bindings.

This module consumes the root-only receipt index produced by the verified
first-party receipt bootstrap, cross-checks it against the authenticated
portable release handoff and first-party inventory, reopens every immutable
receipt through the canonical consumer, and only then asks the Native App Data
registry to mint opaque per-app bindings.

The app-facing descriptor returned here deliberately omits receipt SHA. Apps do
not select receipts, identity, or capability tokens through request metadata.
"""

from __future__ import annotations

import json
import os
import re
import stat
from dataclasses import dataclass

from native_app_install_identity import (
    DEFAULT_RECEIPT_ROOT,
    read_verified_app_install_identity,
)
from native_app_install_identity_bootstrap import (
    DEFAULT_SESSION_DIR,
    MAX_SESSION_INDEX_BYTES,
    SESSION_INDEX_MODE,
    SESSION_INDEX_NAME,
    SESSION_INDEX_SCHEMA,
)
from native_app_install_identity_producer import (
    DEFAULT_FIRST_PARTY_IDENTITY_INVENTORY_PATH,
    DEFAULT_PORTABLE_ROOT,
    DEFAULT_RELEASE_HANDOFF_PATH,
    read_bundled_first_party_identity,
    read_verified_system_release_handoff,
)

DEFAULT_SESSION_INDEX_PATH = f"{DEFAULT_SESSION_DIR}/{SESSION_INDEX_NAME}"
SESSION_INDEX_STATUS = "verified-current-boot"
MAX_SESSION_RECEIPTS = 256

_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


class NativeAppDataSessionBindingError(RuntimeError):
    pass


@dataclass(frozen=True)
class TrustedAppDataPortBinding:
    app_id: str
    endpoint: str
    publisher_id: str
    owner_scope: str

    def app_data_identity(self) -> dict:
        return {
            "publisherId": self.publisher_id,
            "appId": self.app_id,
            "ownerScope": self.owner_scope,
        }


def _validate_uid(expected_uid: int) -> int:
    if (
        not isinstance(expected_uid, int)
        or isinstance(expected_uid, bool)
        or expected_uid < 0
    ):
        raise TypeError("expected uid is invalid")
    return expected_uid


def _read_owned_index(path: str, *, expected_uid: int) -> object:
    if not isinstance(path, str) or not path.startswith("/") or "\x00" in path:
        raise NativeAppDataSessionBindingError("session receipt index path is invalid")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise NativeAppDataSessionBindingError("session receipt index is unavailable") from exc
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != expected_uid
            or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != SESSION_INDEX_MODE
            or info.st_size < 1
            or info.st_size > MAX_SESSION_INDEX_BYTES
        ):
            raise NativeAppDataSessionBindingError("session receipt index metadata is invalid")
        payload = bytearray()
        while len(payload) < info.st_size:
            chunk = os.read(fd, min(4096, info.st_size - len(payload)))
            if not chunk:
                break
            payload.extend(chunk)
        if len(payload) != info.st_size or os.read(fd, 1):
            raise NativeAppDataSessionBindingError("session receipt index changed while reading")
    finally:
        os.close(fd)
    try:
        return json.loads(bytes(payload).decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise NativeAppDataSessionBindingError("session receipt index is invalid JSON") from exc


def validate_session_receipt_index(value: object) -> dict:
    if not isinstance(value, dict):
        raise NativeAppDataSessionBindingError("session receipt index must be an object")
    expected_fields = {
        "$schema",
        "status",
        "sourceCommit",
        "systemDigest",
        "receipts",
    }
    if set(value) != expected_fields:
        raise NativeAppDataSessionBindingError("session receipt index fields are not canonical")
    if value["$schema"] != SESSION_INDEX_SCHEMA or value["status"] != SESSION_INDEX_STATUS:
        raise NativeAppDataSessionBindingError("session receipt index schema/status is invalid")

    commit = value["sourceCommit"]
    digest = value["systemDigest"]
    if not isinstance(commit, str) or _COMMIT_RE.fullmatch(commit) is None:
        raise NativeAppDataSessionBindingError("session receipt source commit is invalid")
    if not isinstance(digest, str) or _SHA256_RE.fullmatch(digest) is None:
        raise NativeAppDataSessionBindingError("session receipt system digest is invalid")

    receipts = value["receipts"]
    if (
        not isinstance(receipts, list)
        or not receipts
        or len(receipts) > MAX_SESSION_RECEIPTS
    ):
        raise NativeAppDataSessionBindingError("session receipt list is invalid")

    normalized = []
    seen = set()
    for entry in receipts:
        if not isinstance(entry, dict) or set(entry) != {"appId", "receiptSha256"}:
            raise NativeAppDataSessionBindingError("session receipt entry fields are invalid")
        app_id = entry["appId"]
        receipt_sha = entry["receiptSha256"]
        if not isinstance(app_id, str) or _APP_ID_RE.fullmatch(app_id) is None:
            raise NativeAppDataSessionBindingError("session receipt app id is invalid")
        if app_id in seen:
            raise NativeAppDataSessionBindingError("session receipt app id is duplicated")
        seen.add(app_id)
        if not isinstance(receipt_sha, str) or _SHA256_RE.fullmatch(receipt_sha) is None:
            raise NativeAppDataSessionBindingError("session receipt digest is invalid")
        normalized.append({"appId": app_id, "receiptSha256": receipt_sha})

    if [entry["appId"] for entry in normalized] != sorted(seen):
        raise NativeAppDataSessionBindingError("session receipt list must be sorted")

    return {
        "$schema": SESSION_INDEX_SCHEMA,
        "status": SESSION_INDEX_STATUS,
        "sourceCommit": commit,
        "systemDigest": digest,
        "receipts": normalized,
    }


def _validate_receipts_before_mint(
    index: dict,
    *,
    expected_uid: int,
    receipt_root: str,
    inventory_path: str,
) -> list[tuple[str, str, object]]:
    validated = []
    for entry in index["receipts"]:
        app_id = entry["appId"]
        receipt_sha = entry["receiptSha256"]
        verified = read_verified_app_install_identity(
            receipt_sha,
            root=receipt_root,
            expected_uid=expected_uid,
        )
        bundled = read_bundled_first_party_identity(
            app_id,
            path=inventory_path,
            expected_uid=expected_uid,
        )
        if (
            verified.app_id != app_id
            or verified.publisher_principal_id != bundled.publisher_principal_id
            or verified.owner_scope != "device"
            or verified.source_class != "system-release-bundled"
            or verified.source_version != bundled.source_version
            or verified.source_digest != index["systemDigest"]
            or verified.verification_owner != "release-acquisition"
            or verified.verification_policy != bundled.verification_policy
            or verified.verification_generation != bundled.verification_generation
        ):
            raise NativeAppDataSessionBindingError(
                f"verified receipt does not match current bundled identity: {app_id}"
            )
        validated.append((app_id, receipt_sha, verified))
    return validated


def load_current_boot_app_data_bindings(
    server,
    *,
    expected_uid: int,
    index_path: str = DEFAULT_SESSION_INDEX_PATH,
    handoff_path: str = DEFAULT_RELEASE_HANDOFF_PATH,
    receipt_root: str = DEFAULT_RECEIPT_ROOT,
    inventory_path: str = DEFAULT_FIRST_PARTY_IDENTITY_INVENTORY_PATH,
    portable_root: str = DEFAULT_PORTABLE_ROOT,
) -> tuple[TrustedAppDataPortBinding, ...]:
    uid = _validate_uid(expected_uid)
    mint = getattr(server, "bind_app_data_receipt", None)
    if not callable(mint):
        raise TypeError("Native App Data host must provide bind_app_data_receipt")

    index = validate_session_receipt_index(_read_owned_index(index_path, expected_uid=uid))
    handoff = read_verified_system_release_handoff(
        handoff_path,
        expected_uid=uid,
        portable_root=portable_root,
    )
    if (
        index["sourceCommit"] != handoff.source_commit
        or index["systemDigest"] != handoff.artifact_sha256
    ):
        raise NativeAppDataSessionBindingError(
            "session receipt index does not match current verified release"
        )

    # Validate every receipt before minting the first capability. A malformed or
    # stale index must never leave a partially authorized registry behind.
    validated = _validate_receipts_before_mint(
        index,
        expected_uid=uid,
        receipt_root=receipt_root,
        inventory_path=inventory_path,
    )

    descriptors = []
    for app_id, receipt_sha, verified in validated:
        binding = mint(receipt_sha)
        if (
            getattr(binding, "receipt_sha256", None) != receipt_sha
            or getattr(binding, "app_id", None) != app_id
            or getattr(binding, "publisher_id", None) != verified.publisher_principal_id
            or getattr(binding, "owner_scope", None) != "device"
            or not isinstance(getattr(binding, "endpoint", None), str)
        ):
            raise NativeAppDataSessionBindingError(
                f"Native App Data registry returned an invalid binding: {app_id}"
            )
        descriptors.append(
            TrustedAppDataPortBinding(
                app_id=app_id,
                endpoint=binding.endpoint,
                publisher_id=binding.publisher_id,
                owner_scope=binding.owner_scope,
            )
        )

    return tuple(descriptors)
