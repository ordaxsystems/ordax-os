#!/usr/bin/env python3
"""Bootstrap verified first-party install receipts for the current system release.

This module is deliberately capability-free. It runs only in trusted platform
composition, consumes the already-authenticated portable release handoff plus
the first-party identity inventory shipped inside the verified system release,
materializes content-addressed install identity receipts, and publishes a
root-only ephemeral index for a later Native binding stage.

No app request supplies publisher identity, app id, source version, source
digest, receipt digest, or capability token here.
"""

from __future__ import annotations

import json
import os
import secrets
import stat
import sys
from pathlib import Path

from native_app_install_identity import (
    DEFAULT_RECEIPT_ROOT,
    RECEIPT_FILE_MODE,
    RECEIPT_ROOT_MODE,
    read_verified_app_install_identity,
)
from native_app_install_identity_producer import (
    DEFAULT_FIRST_PARTY_IDENTITY_INVENTORY_PATH,
    DEFAULT_PORTABLE_ROOT,
    DEFAULT_RELEASE_HANDOFF_PATH,
    MAX_IDENTITY_INVENTORY_BYTES,
    FirstPartyIdentityInventoryError,
    produce_system_release_bundled_receipt,
    read_bundled_first_party_identity,
    read_verified_system_release_handoff,
    validate_first_party_identity_inventory,
)

DEFAULT_STATE_ROOT = "/var/lib/ordax"
DEFAULT_SESSION_DIR = "/run/ordax-surface"
SESSION_INDEX_NAME = "app-install-identities.json"
SESSION_INDEX_SCHEMA = "ordax.verified-app-install-session/1"
SESSION_INDEX_MODE = 0o600
MAX_SESSION_INDEX_BYTES = 128 * 1024

_RECEIPT_RELATIVE_PARTS = ("app-install", "verified-identities", "v1")


class VerifiedInstallBootstrapError(RuntimeError):
    pass


def _validate_uid(expected_uid: int) -> int:
    if (
        not isinstance(expected_uid, int)
        or isinstance(expected_uid, bool)
        or expected_uid < 0
    ):
        raise TypeError("expected uid is invalid")
    return expected_uid


def _open_owned_directory(path: str, *, expected_uid: int, exact_mode: int, label: str) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise VerifiedInstallBootstrapError(f"{label} is unavailable") from exc
    info = os.fstat(fd)
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != expected_uid
        or stat.S_IMODE(info.st_mode) != exact_mode
    ):
        os.close(fd)
        raise VerifiedInstallBootstrapError(f"{label} ownership/mode is invalid")
    return fd


def _open_or_create_owned_child(parent_fd: int, name: str, *, expected_uid: int) -> int:
    if not name or "/" in name or name in {".", ".."}:
        raise VerifiedInstallBootstrapError("receipt namespace component is invalid")
    try:
        os.mkdir(name, RECEIPT_ROOT_MODE, dir_fd=parent_fd)
    except FileExistsError:
        pass
    except OSError as exc:
        raise VerifiedInstallBootstrapError("receipt namespace could not be created") from exc

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        child_fd = os.open(name, flags, dir_fd=parent_fd)
    except OSError as exc:
        raise VerifiedInstallBootstrapError("receipt namespace contains an unsafe component") from exc
    info = os.fstat(child_fd)
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != expected_uid
        or stat.S_IMODE(info.st_mode) != RECEIPT_ROOT_MODE
    ):
        os.close(child_fd)
        raise VerifiedInstallBootstrapError("receipt namespace ownership/mode is invalid")
    return child_fd


def receipt_root_for_state(state_root: str) -> str:
    if not isinstance(state_root, str) or not state_root.startswith("/") or "\x00" in state_root:
        raise VerifiedInstallBootstrapError("state root path is invalid")
    return str(Path(state_root).joinpath(*_RECEIPT_RELATIVE_PARTS))


def ensure_verified_receipt_root(
    *,
    state_root: str = DEFAULT_STATE_ROOT,
    expected_uid: int,
) -> str:
    uid = _validate_uid(expected_uid)
    state_fd = _open_owned_directory(
        state_root,
        expected_uid=uid,
        exact_mode=RECEIPT_ROOT_MODE,
        label="persistent Native state root",
    )
    current_fd = state_fd
    try:
        for part in _RECEIPT_RELATIVE_PARTS:
            next_fd = _open_or_create_owned_child(current_fd, part, expected_uid=uid)
            if current_fd != state_fd:
                os.close(current_fd)
            current_fd = next_fd
        os.fsync(current_fd)
    finally:
        if current_fd != state_fd:
            os.close(current_fd)
        os.close(state_fd)

    root = receipt_root_for_state(state_root)
    if state_root == DEFAULT_STATE_ROOT and root != DEFAULT_RECEIPT_ROOT:
        raise VerifiedInstallBootstrapError("receipt root disagrees with canonical identity consumer")
    return root


def _read_inventory(path: str, *, expected_uid: int) -> dict:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise VerifiedInstallBootstrapError("first-party identity inventory is unavailable") from exc
    try:
        info = os.fstat(fd)
        mode = stat.S_IMODE(info.st_mode)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != expected_uid
            or info.st_nlink != 1
            or mode & 0o022
            or info.st_size < 1
            or info.st_size > MAX_IDENTITY_INVENTORY_BYTES
        ):
            raise VerifiedInstallBootstrapError("first-party identity inventory metadata is invalid")
        payload = bytearray()
        while len(payload) < info.st_size:
            chunk = os.read(fd, min(4096, info.st_size - len(payload)))
            if not chunk:
                break
            payload.extend(chunk)
        if len(payload) != info.st_size or os.read(fd, 1):
            raise VerifiedInstallBootstrapError("first-party identity inventory changed while reading")
    finally:
        os.close(fd)

    try:
        decoded = json.loads(bytes(payload).decode("utf-8", errors="strict"))
        return validate_first_party_identity_inventory(decoded)
    except (UnicodeError, json.JSONDecodeError, FirstPartyIdentityInventoryError) as exc:
        raise VerifiedInstallBootstrapError("first-party identity inventory is invalid") from exc


def _session_index_bytes(handoff, receipts: list[dict]) -> bytes:
    value = {
        "$schema": SESSION_INDEX_SCHEMA,
        "status": "verified-current-boot",
        "sourceCommit": handoff.source_commit,
        "systemDigest": handoff.artifact_sha256,
        "receipts": receipts,
    }
    payload = (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        + "\n"
    ).encode("utf-8")
    if len(payload) > MAX_SESSION_INDEX_BYTES:
        raise VerifiedInstallBootstrapError("session receipt index exceeds byte limit")
    return payload


def _clear_session_index(session_dir: str, *, expected_uid: int) -> None:
    session_fd = _open_owned_directory(
        session_dir,
        expected_uid=expected_uid,
        exact_mode=RECEIPT_ROOT_MODE,
        label="Native session directory",
    )
    try:
        try:
            os.unlink(SESSION_INDEX_NAME, dir_fd=session_fd)
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise VerifiedInstallBootstrapError("stale session receipt index could not be removed") from exc
        os.fsync(session_fd)
    finally:
        os.close(session_fd)


def _write_session_index(
    session_dir: str,
    payload: bytes,
    *,
    expected_uid: int,
) -> str:
    session_fd = _open_owned_directory(
        session_dir,
        expected_uid=expected_uid,
        exact_mode=RECEIPT_ROOT_MODE,
        label="Native session directory",
    )
    temporary = f".{SESSION_INDEX_NAME}-{secrets.token_hex(16)}.tmp"
    temp_fd = -1
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        temp_fd = os.open(temporary, flags, SESSION_INDEX_MODE, dir_fd=session_fd)
        os.fchmod(temp_fd, SESSION_INDEX_MODE)
        offset = 0
        while offset < len(payload):
            written = os.write(temp_fd, payload[offset:])
            if written <= 0:
                raise OSError("short write while persisting session receipt index")
            offset += written
        os.fsync(temp_fd)
        os.close(temp_fd)
        temp_fd = -1
        os.replace(
            temporary,
            SESSION_INDEX_NAME,
            src_dir_fd=session_fd,
            dst_dir_fd=session_fd,
        )
        os.fsync(session_fd)

        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        verify_fd = os.open(SESSION_INDEX_NAME, flags, dir_fd=session_fd)
        try:
            info = os.fstat(verify_fd)
            stored = b""
            while len(stored) < info.st_size:
                chunk = os.read(verify_fd, min(4096, info.st_size - len(stored)))
                if not chunk:
                    break
                stored += chunk
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != expected_uid
                or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != SESSION_INDEX_MODE
                or stored != payload
                or os.read(verify_fd, 1)
            ):
                raise VerifiedInstallBootstrapError("persisted session receipt index failed verification")
        finally:
            os.close(verify_fd)
    finally:
        if temp_fd >= 0:
            os.close(temp_fd)
        try:
            os.unlink(temporary, dir_fd=session_fd)
        except FileNotFoundError:
            pass
        os.close(session_fd)
    return str(Path(session_dir) / SESSION_INDEX_NAME)


def bootstrap_system_release_bundled_receipts(
    *,
    expected_uid: int,
    state_root: str = DEFAULT_STATE_ROOT,
    session_dir: str = DEFAULT_SESSION_DIR,
    handoff_path: str = DEFAULT_RELEASE_HANDOFF_PATH,
    inventory_path: str = DEFAULT_FIRST_PARTY_IDENTITY_INVENTORY_PATH,
    portable_root: str = DEFAULT_PORTABLE_ROOT,
) -> dict:
    uid = _validate_uid(expected_uid)

    # A previous index must never survive a failed refresh in the same boot.
    _clear_session_index(session_dir, expected_uid=uid)

    receipt_root = ensure_verified_receipt_root(
        state_root=state_root,
        expected_uid=uid,
    )
    handoff = read_verified_system_release_handoff(
        handoff_path,
        expected_uid=uid,
        portable_root=portable_root,
    )
    inventory_before = _read_inventory(inventory_path, expected_uid=uid)

    receipts = []
    for entry in inventory_before["apps"]:
        identity = read_bundled_first_party_identity(
            entry["appId"],
            path=inventory_path,
            expected_uid=uid,
        )
        if (
            identity.app_id != entry["appId"]
            or identity.publisher_principal_id != entry["publisherPrincipalId"]
            or identity.source_version != entry["version"]
            or identity.verification_policy != inventory_before["verificationPolicy"]
            or identity.verification_generation != inventory_before["verificationGeneration"]
        ):
            raise VerifiedInstallBootstrapError("first-party identity inventory changed during bootstrap")
        digest = produce_system_release_bundled_receipt(
            handoff,
            identity,
            root=receipt_root,
            expected_uid=uid,
        )
        verified = read_verified_app_install_identity(
            digest,
            root=receipt_root,
            expected_uid=uid,
        )
        if verified.app_id != identity.app_id or verified.source_digest != handoff.artifact_sha256:
            raise VerifiedInstallBootstrapError("materialized receipt identity does not match verified release")
        receipts.append({"appId": identity.app_id, "receiptSha256": digest})

    inventory_after = _read_inventory(inventory_path, expected_uid=uid)
    if inventory_after != inventory_before:
        raise VerifiedInstallBootstrapError("first-party identity inventory changed during bootstrap")

    index_payload = _session_index_bytes(handoff, receipts)
    index_path = _write_session_index(
        session_dir,
        index_payload,
        expected_uid=uid,
    )
    return {
        "sourceCommit": handoff.source_commit,
        "systemDigest": handoff.artifact_sha256,
        "receiptCount": len(receipts),
        "indexPath": index_path,
    }


def main() -> int:
    uid = os.geteuid()
    try:
        result = bootstrap_system_release_bundled_receipts(expected_uid=uid)
    except Exception as exc:  # fail closed for the App Data capability bootstrap
        print(f"ordax-app-install-bootstrap: {exc}", file=sys.stderr, flush=True)
        return 1
    print(
        json.dumps(
            {
                "status": "verified-install-receipts-ready",
                "receiptCount": result["receiptCount"],
                "sourceCommit": result["sourceCommit"],
            },
            sort_keys=True,
            separators=(",", ":"),
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
