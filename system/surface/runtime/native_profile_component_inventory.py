#!/usr/bin/env python3
"""Read the durable, content-addressed Profile component inventory.

The Surface is deliberately read-only. A future trusted provisioning executor owns
writing verified install receipts; UI/runtime code can only observe them.
"""

from __future__ import annotations

import json
import os
import re
import stat

from native_profile_install_receipt import (
    DEFAULT_PROFILE_RECEIPT_ROOT,
    read_verified_profile_install_receipt,
)

PROFILE_COMPONENT_INVENTORY_FILE = "/var/lib/ordax/profile-component-inventory.json"
PROFILE_COMPONENT_INVENTORY_SCHEMA = "ordax.profile-component-inventory/1"
MAX_PROFILE_COMPONENT_INVENTORY_BYTES = 256 * 1024
MAX_PROFILE_COMPONENT_ENTRIES = 256
_COMPONENT_ID_RE = re.compile(r"^[a-z][a-z0-9._-]{1,127}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$")
_COMPONENT_KINDS = frozenset((
    "app",
    "knowledge-pack",
    "skill-pack",
    "model-pack",
    "connector",
))


def empty_profile_component_inventory() -> dict:
    return {
        "schema": PROFILE_COMPONENT_INVENTORY_SCHEMA,
        "revision": 0,
        "persistence": "device",
        "entries": [],
    }


def valid_profile_component_inventory(value: object) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "schema", "revision", "persistence", "entries"
    }:
        return False
    if value.get("schema") != PROFILE_COMPONENT_INVENTORY_SCHEMA:
        return False
    revision = value.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        return False
    if value.get("persistence") != "device":
        return False
    entries = value.get("entries")
    if not isinstance(entries, list) or len(entries) > MAX_PROFILE_COMPONENT_ENTRIES:
        return False

    identities: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {
            "id", "kind", "version", "sha256", "installedAt", "receiptSha256"
        }:
            return False
        component_id = entry.get("id")
        kind = entry.get("kind")
        version = entry.get("version")
        artifact_sha = entry.get("sha256")
        receipt_sha = entry.get("receiptSha256")
        installed_at = entry.get("installedAt")
        if not isinstance(component_id, str) or _COMPONENT_ID_RE.fullmatch(component_id) is None:
            return False
        if kind not in _COMPONENT_KINDS:
            return False
        if not isinstance(version, str) or _SEMVER_RE.fullmatch(version) is None:
            return False
        if not isinstance(artifact_sha, str) or _SHA256_RE.fullmatch(artifact_sha) is None:
            return False
        if not isinstance(receipt_sha, str) or _SHA256_RE.fullmatch(receipt_sha) is None:
            return False
        if isinstance(installed_at, bool) or not isinstance(installed_at, int) or installed_at < 0:
            return False
        identity = f"{component_id}@{version}@{artifact_sha}"
        if identity in identities:
            return False
        identities.add(identity)
    return True


def read_profile_component_inventory(
    path: str = PROFILE_COMPONENT_INVENTORY_FILE,
) -> dict:
    try:
        metadata = os.stat(path, follow_symlinks=False)
    except FileNotFoundError:
        return empty_profile_component_inventory()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or stat.S_IMODE(metadata.st_mode) & 0o077
        or metadata.st_size > MAX_PROFILE_COMPONENT_INVENTORY_BYTES
    ):
        raise ValueError("Profile component inventory file boundary is unsafe")

    with open(path, "rb") as handle:
        raw = handle.read(MAX_PROFILE_COMPONENT_INVENTORY_BYTES + 1)
    if len(raw) > MAX_PROFILE_COMPONENT_INVENTORY_BYTES:
        raise ValueError("Profile component inventory exceeds maximum size")
    try:
        payload = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Profile component inventory is invalid JSON") from exc
    if not valid_profile_component_inventory(payload):
        raise ValueError("Profile component inventory is invalid")
    return payload


def read_verified_profile_component_inventory(
    path: str = PROFILE_COMPONENT_INVENTORY_FILE,
    receipt_root: str = DEFAULT_PROFILE_RECEIPT_ROOT,
) -> dict:
    inventory = read_profile_component_inventory(path)
    for entry in inventory["entries"]:
        try:
            receipt = read_verified_profile_install_receipt(
                entry["receiptSha256"],
                receipt_root,
            )
        except FileNotFoundError as exc:
            raise ValueError("Installed Profile component receipt is missing") from exc
        artifact = receipt["artifact"]
        if (
            artifact["id"] != entry["id"]
            or artifact["kind"] != entry["kind"]
            or artifact["version"] != entry["version"]
            or artifact["sha256"] != entry["sha256"]
            or receipt["installedAt"] != entry["installedAt"]
        ):
            raise ValueError("Installed Profile component receipt does not match inventory")
    return inventory


def write_profile_component_inventory(
    inventory: dict,
    path: str = PROFILE_COMPONENT_INVENTORY_FILE,
) -> None:
    """Atomically persist a validated device inventory.

    This function is intentionally not exposed by native_host_server.py. Only a
    future trusted provisioning executor may call it after package signature,
    content, compatibility and health verification.
    """
    if not valid_profile_component_inventory(inventory):
        raise ValueError("Profile component inventory is invalid")
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    temporary = f"{path}.tmp.{os.getpid()}"
    payload = (
        json.dumps(
            inventory,
            separators=(",", ":"),
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")
    if len(payload) > MAX_PROFILE_COMPONENT_INVENTORY_BYTES:
        raise ValueError("Profile component inventory exceeds maximum size")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_NOFOLLOW", 0)
    flags |= getattr(os, "O_CLOEXEC", 0)
    descriptor = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    try:
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
