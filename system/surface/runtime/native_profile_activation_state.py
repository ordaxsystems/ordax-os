#!/usr/bin/env python3
"""Durable local Profile activation state.

This file stores composition references only. It never owns Space documents,
Memory, prompts, credentials or professional content. Mutations are internal
helpers and are not exposed by the Native HTTP host.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import secrets
import stat
import threading
from pathlib import Path

from native_profile_component_inventory import (
    PROFILE_COMPONENT_INVENTORY_FILE,
    read_profile_component_inventory,
)

PROFILE_ACTIVATION_STATE_SCHEMA = "ordax.profile-activation-state/1"
PROFILE_ACTIVATION_STATE_FILE = "/var/lib/ordax/profile-activation-state.json"
PROFILE_ACTIVATION_LOCK_FILE = "/var/lib/ordax/profile-activation-state.lock"
MAX_PROFILE_ACTIVATION_STATE_BYTES = 256 * 1024
MAX_PROFILE_ACTIVATION_SPACES = 64
MAX_PROFILE_ACTIVATION_COMPONENTS = 64

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,79}$")
_COMPONENT_ID_RE = re.compile(r"^[a-z][a-z0-9._-]{1,127}$")
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$"
)
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_SPACE_KINDS = frozenset(("personal", "work", "professional"))
_COMPONENT_KINDS = frozenset((
    "app",
    "knowledge-pack",
    "skill-pack",
    "model-pack",
    "connector",
))


def empty_profile_activation_state() -> dict:
    return {
        "schema": PROFILE_ACTIVATION_STATE_SCHEMA,
        "revision": 0,
        "persistence": "device",
        "spaces": [],
    }


def _bounded_text(value: object, label: str, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum
        or "\x00" in value
    ):
        raise ValueError(f"{label} is invalid")
    return value


def _epoch(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} is invalid")
    return value


def _validate_component(value: object, label: str) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "id",
        "kind",
        "version",
        "sha256",
        "receiptSha256",
        "installedAt",
    }:
        raise ValueError(f"{label} fields are incompatible")
    component_id = _bounded_text(value["id"], f"{label}.id", 128)
    if _COMPONENT_ID_RE.fullmatch(component_id) is None:
        raise ValueError(f"{label}.id is invalid")
    if value["kind"] not in _COMPONENT_KINDS:
        raise ValueError(f"{label}.kind is invalid")
    version = _bounded_text(value["version"], f"{label}.version", 64)
    if _SEMVER_RE.fullmatch(version) is None:
        raise ValueError(f"{label}.version is invalid")
    sha256 = _bounded_text(value["sha256"], f"{label}.sha256", 64)
    receipt_sha256 = _bounded_text(
        value["receiptSha256"],
        f"{label}.receiptSha256",
        64,
    )
    if _SHA256_RE.fullmatch(sha256) is None or _SHA256_RE.fullmatch(receipt_sha256) is None:
        raise ValueError(f"{label} hashes are invalid")
    return {
        "id": component_id,
        "kind": value["kind"],
        "version": version,
        "sha256": sha256,
        "receiptSha256": receipt_sha256,
        "installedAt": _epoch(value["installedAt"], f"{label}.installedAt"),
    }


def validate_profile_activation_ref(value: object, label: str = "Profile activation") -> dict:
    if not isinstance(value, dict) or set(value) != {
        "profile",
        "components",
        "activatedAt",
    }:
        raise ValueError(f"{label} fields are incompatible")
    profile = value["profile"]
    if not isinstance(profile, dict) or set(profile) != {"slug", "version"}:
        raise ValueError(f"{label}.profile fields are incompatible")
    slug = _bounded_text(profile["slug"], f"{label}.profile.slug", 80)
    if _SLUG_RE.fullmatch(slug) is None:
        raise ValueError(f"{label}.profile.slug is invalid")
    version = profile["version"]
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValueError(f"{label}.profile.version is invalid")

    raw_components = value["components"]
    if (
        not isinstance(raw_components, list)
        or len(raw_components) > MAX_PROFILE_ACTIVATION_COMPONENTS
    ):
        raise ValueError(f"{label}.components are outside bounds")
    components = sorted(
        (
            _validate_component(component, f"{label}.components[{index}]")
            for index, component in enumerate(raw_components)
        ),
        key=lambda component: (
            component["id"],
            component["version"],
            component["sha256"],
        ),
    )
    identities = {
        (component["id"], component["version"], component["sha256"])
        for component in components
    }
    if len(identities) != len(components):
        raise ValueError(f"{label}.components contains duplicate identities")
    return {
        "profile": {"slug": slug, "version": version},
        "components": components,
        "activatedAt": _epoch(value["activatedAt"], f"{label}.activatedAt"),
    }


def validate_profile_activation_state(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "schema",
        "revision",
        "persistence",
        "spaces",
    }:
        raise ValueError("Profile activation state fields are incompatible")
    if value["schema"] != PROFILE_ACTIVATION_STATE_SCHEMA:
        raise ValueError("Profile activation state schema is incompatible")
    revision = value["revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise ValueError("Profile activation state revision is invalid")
    if value["persistence"] != "device":
        raise ValueError("Native Profile activation state must be device-persistent")
    raw_spaces = value["spaces"]
    if not isinstance(raw_spaces, list) or len(raw_spaces) > MAX_PROFILE_ACTIVATION_SPACES:
        raise ValueError("Profile activation state spaces are outside bounds")

    spaces: list[dict] = []
    ids: set[str] = set()
    for index, row in enumerate(raw_spaces):
        label = f"Profile activation state spaces[{index}]"
        if not isinstance(row, dict) or set(row) != {"spaceId", "spaceKind", "current", "previous"}:
            raise ValueError(f"{label} fields are incompatible")
        space_id = _bounded_text(row["spaceId"], f"{label}.spaceId", 160)
        space_kind = _bounded_text(row["spaceKind"], f"{label}.spaceKind", 32)
        if space_kind not in _SPACE_KINDS:
            raise ValueError(f"{label}.spaceKind is invalid")
        if space_id in ids:
            raise ValueError("Profile activation state contains duplicate Space ids")
        ids.add(space_id)
        current = (
            None
            if row["current"] is None
            else validate_profile_activation_ref(row["current"], f"{label}.current")
        )
        previous = (
            None
            if row["previous"] is None
            else validate_profile_activation_ref(row["previous"], f"{label}.previous")
        )
        if current is None and previous is None:
            raise ValueError(f"{label} cannot be empty")
        if (
            current is not None
            and previous is not None
            and _activation_identity(current) == _activation_identity(previous)
        ):
            raise ValueError(f"{label} current and previous must differ")
        spaces.append({
            "spaceId": space_id,
            "spaceKind": space_kind,
            "current": current,
            "previous": previous,
        })
    return {
        "schema": PROFILE_ACTIVATION_STATE_SCHEMA,
        "revision": revision,
        "persistence": "device",
        "spaces": spaces,
    }


def _validate_existing_target(path: str) -> None:
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or stat.S_IMODE(metadata.st_mode) & 0o077
        or metadata.st_size > MAX_PROFILE_ACTIVATION_STATE_BYTES
    ):
        raise ValueError("Profile activation state file boundary is unsafe")


def read_profile_activation_state(
    path: str = PROFILE_ACTIVATION_STATE_FILE,
) -> dict:
    _validate_existing_target(path)
    try:
        descriptor = os.open(
            path,
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
    except FileNotFoundError:
        return empty_profile_activation_state()

    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_size < 0
            or metadata.st_size > MAX_PROFILE_ACTIVATION_STATE_BYTES
        ):
            raise ValueError("Profile activation state changed to an unsafe file")
        chunks: list[bytes] = []
        remaining = MAX_PROFILE_ACTIVATION_STATE_BYTES + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
    finally:
        os.close(descriptor)
    if len(raw) > MAX_PROFILE_ACTIVATION_STATE_BYTES:
        raise ValueError("Profile activation state exceeds maximum size")
    try:
        payload = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Profile activation state is invalid JSON") from exc
    return validate_profile_activation_state(payload)


def write_profile_activation_state(
    value: dict,
    path: str = PROFILE_ACTIVATION_STATE_FILE,
) -> None:
    state = validate_profile_activation_state(value)
    directory = os.path.abspath(os.path.dirname(path) or ".")
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    _validate_existing_target(path)
    payload = (
        json.dumps(
            state,
            separators=(",", ":"),
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")
    if len(payload) > MAX_PROFILE_ACTIVATION_STATE_BYTES:
        raise ValueError("Profile activation state exceeds maximum size")

    temporary = os.path.join(
        directory,
        f".profile-activation.tmp.{os.getpid()}.{threading.get_ident()}.{secrets.token_hex(4)}",
    )
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    descriptor = -1
    directory_fd = os.open(
        directory,
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        descriptor = os.open(temporary, flags, 0o600)
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                raise OSError("Profile activation state write made no progress")
            offset += written
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, path)
        os.chmod(path, 0o600, follow_symlinks=False)
        os.fsync(directory_fd)
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    finally:
        os.close(directory_fd)


def _component_key(component: dict) -> tuple[str, str, str]:
    return component["id"], component["version"], component["sha256"]


def _assert_activation_components_installed(
    activation: dict,
    inventory_path: str,
) -> None:
    inventory = read_profile_component_inventory(inventory_path)
    installed = {
        _component_key(entry): entry
        for entry in inventory["entries"]
    }
    for component in activation["components"]:
        entry = installed.get(_component_key(component))
        if entry is None:
            raise ValueError("Profile activation references a component that is not installed")
        if (
            entry["kind"] != component["kind"]
            or entry["receiptSha256"] != component["receiptSha256"]
            or entry["installedAt"] != component["installedAt"]
        ):
            raise ValueError("Profile activation component receipt does not match inventory")


def _activation_identity(value: dict | None) -> tuple | None:
    if value is None:
        return None
    return (
        value["profile"]["slug"],
        value["profile"]["version"],
        tuple(
            (
                component["id"],
                component["kind"],
                component["version"],
                component["sha256"],
                component["receiptSha256"],
                component["installedAt"],
            )
            for component in value["components"]
        ),
    )


def _lock(path: str):
    directory = os.path.abspath(os.path.dirname(path) or ".")
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    descriptor = os.open(
        path,
        os.O_RDWR
        | os.O_CREAT
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    os.chmod(path, 0o600, follow_symlinks=False)
    handle = os.fdopen(descriptor, "a+b", closefd=True)
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    return handle


def _space_index(state: dict, space_id: str) -> int | None:
    for index, row in enumerate(state["spaces"]):
        if row["spaceId"] == space_id:
            return index
    return None


def activate_profile(
    *,
    space_id: str,
    space_kind: str,
    activation: dict,
    expected_revision: int | None = None,
    state_path: str = PROFILE_ACTIVATION_STATE_FILE,
    inventory_path: str = PROFILE_COMPONENT_INVENTORY_FILE,
    lock_path: str = PROFILE_ACTIVATION_LOCK_FILE,
) -> dict:
    space_id = _bounded_text(space_id, "Profile activation Space id", 160)
    space_kind = _bounded_text(space_kind, "Profile activation Space kind", 32)
    if space_kind not in _SPACE_KINDS:
        raise ValueError("Profile activation Space kind is invalid")
    candidate = validate_profile_activation_ref(activation)
    _assert_activation_components_installed(candidate, inventory_path)

    with _lock(lock_path) as lock_handle:
        try:
            state = read_profile_activation_state(state_path)
            if expected_revision is not None and state["revision"] != expected_revision:
                raise RuntimeError("Profile activation state revision changed")
            index = _space_index(state, space_id)
            existing = None if index is None else state["spaces"][index]
            if existing is not None and existing["spaceKind"] != space_kind:
                raise ValueError("Profile activation Space kind changed unexpectedly")
            if existing is not None and _activation_identity(existing["current"]) == _activation_identity(candidate):
                return {"changed": False, "state": state}

            previous = None
            if existing is not None:
                previous = existing["current"] if existing["current"] is not None else existing["previous"]
            row = {
                "spaceId": space_id,
                "spaceKind": space_kind,
                "current": candidate,
                "previous": previous,
            }
            spaces = list(state["spaces"])
            if index is None:
                if len(spaces) >= MAX_PROFILE_ACTIVATION_SPACES:
                    raise ValueError("Profile activation state Space limit reached")
                spaces.append(row)
            else:
                spaces[index] = row
            next_state = {
                "schema": PROFILE_ACTIVATION_STATE_SCHEMA,
                "revision": state["revision"] + 1,
                "persistence": "device",
                "spaces": spaces,
            }
            write_profile_activation_state(next_state, state_path)
            return {"changed": True, "state": next_state}
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def deactivate_profile(
    *,
    space_id: str,
    expected_revision: int | None = None,
    state_path: str = PROFILE_ACTIVATION_STATE_FILE,
    lock_path: str = PROFILE_ACTIVATION_LOCK_FILE,
) -> dict:
    space_id = _bounded_text(space_id, "Profile deactivation Space id", 160)
    with _lock(lock_path) as lock_handle:
        try:
            state = read_profile_activation_state(state_path)
            if expected_revision is not None and state["revision"] != expected_revision:
                raise RuntimeError("Profile activation state revision changed")
            index = _space_index(state, space_id)
            if index is None or state["spaces"][index]["current"] is None:
                return {"changed": False, "state": state}
            row = state["spaces"][index]
            spaces = list(state["spaces"])
            spaces[index] = {
                "spaceId": space_id,
                "spaceKind": row["spaceKind"],
                "current": None,
                "previous": row["current"],
            }
            next_state = {
                "schema": PROFILE_ACTIVATION_STATE_SCHEMA,
                "revision": state["revision"] + 1,
                "persistence": "device",
                "spaces": spaces,
            }
            write_profile_activation_state(next_state, state_path)
            return {"changed": True, "state": next_state}
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def rollback_profile(
    *,
    space_id: str,
    expected_revision: int | None = None,
    state_path: str = PROFILE_ACTIVATION_STATE_FILE,
    inventory_path: str = PROFILE_COMPONENT_INVENTORY_FILE,
    lock_path: str = PROFILE_ACTIVATION_LOCK_FILE,
) -> dict:
    space_id = _bounded_text(space_id, "Profile rollback Space id", 160)
    with _lock(lock_path) as lock_handle:
        try:
            state = read_profile_activation_state(state_path)
            if expected_revision is not None and state["revision"] != expected_revision:
                raise RuntimeError("Profile activation state revision changed")
            index = _space_index(state, space_id)
            if index is None or state["spaces"][index]["previous"] is None:
                return {"changed": False, "state": state}
            row = state["spaces"][index]
            target = row["previous"]
            _assert_activation_components_installed(target, inventory_path)
            spaces = list(state["spaces"])
            spaces[index] = {
                "spaceId": space_id,
                "spaceKind": row["spaceKind"],
                "current": target,
                "previous": row["current"],
            }
            next_state = {
                "schema": PROFILE_ACTIVATION_STATE_SCHEMA,
                "revision": state["revision"] + 1,
                "persistence": "device",
                "spaces": spaces,
            }
            write_profile_activation_state(next_state, state_path)
            return {"changed": True, "state": next_state}
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
