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
