#!/usr/bin/env python3
"""Trusted Native command boundary for local Profile activation."""

from __future__ import annotations

import json
import re
from pathlib import Path

from native_profile_activation_state import (
    PROFILE_ACTIVATION_STATE_FILE,
    PROFILE_ACTIVATION_LOCK_FILE,
    activate_profile,
    deactivate_profile,
    read_profile_activation_state,
    rollback_profile,
)
from native_profile_component_inventory import PROFILE_COMPONENT_INVENTORY_FILE
from native_profile_install_receipt import DEFAULT_PROFILE_RECEIPT_ROOT

COMMAND_SCHEMA = "ordax.profile-activation-command/1"
MAX_COMMAND_COMPONENTS = 64
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,79}$")
_SPACE_KINDS = frozenset(("personal", "work", "professional"))


def _system_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _read_json(path: Path) -> dict:
    raw = path.read_bytes()
    if len(raw) > 256 * 1024:
        raise ValueError("Profile metadata exceeds bounded size")
    value = json.loads(raw.decode("utf-8", errors="strict"))
    if not isinstance(value, dict):
        raise ValueError("Profile metadata must be an object")
    return value


def _canonical_manifest(slug: str, version: int) -> dict:
    if _SLUG_RE.fullmatch(slug) is None or not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise ValueError("Profile identity is invalid")
    root = _system_root()
    catalog = _read_json(root / "system" / "profile-packs" / "catalog.json")
    if catalog.get("$schema") != "ordax.profile-pack-bundled-catalog/1":
        raise ValueError("Profile catalog schema is incompatible")
    expected = f"/system/profile-packs/{slug}/v{version}/manifest.json"
    entries = catalog.get("entries")
    if not isinstance(entries, list) or not any(
        isinstance(row, dict)
        and row.get("slug") == slug
        and row.get("version") == version
        and row.get("manifest") == expected
        for row in entries
    ):
        raise ValueError("Profile is not present in the canonical bundled catalog")
    manifest = _read_json(root / expected.lstrip("/"))
    if (
        manifest.get("$schema") != "ordax.profile-pack/1"
        or manifest.get("slug") != slug
        or manifest.get("version") != version
    ):
        raise ValueError("Profile manifest identity is incompatible")
    return manifest


def _assert_internal_activation_allowed(manifest: dict, space_kind: str, components: list) -> None:
    if manifest.get("space_kind") != space_kind:
        raise ValueError("Profile Space kind does not match canonical manifest")
    if manifest.get("state") == "retired":
        raise ValueError("Retired Profile cannot be activated")
    activation = manifest.get("activation")
    if isinstance(activation, dict) and activation.get("publicly_available") is False:
        raise PermissionError("Profile activation is blocked by canonical manifest")
    intelligence = manifest.get("intelligence")
    if not isinstance(intelligence, dict) or intelligence.get("external_provider_required") is not False:
        raise PermissionError("Profile requires unsupported activation authority")
    security = manifest.get("security")
    if not isinstance(security, dict):
        raise ValueError("Profile security policy is missing")
    for field in ("auto_grant_privileges", "allow_unsigned_apps", "generic_shell_implied", "cross_space_memory"):
        if security.get(field, False) is True:
            raise PermissionError("Profile attempts to broaden authority")
    if components:
        raise PermissionError(
            "Component-bearing Profile activation awaits canonical distribution permission diff"
        )


def execute_profile_activation_command(
    payload: object,
    *,
    distribution_profile: str,
    state_path: str = PROFILE_ACTIVATION_STATE_FILE,
    inventory_path: str = PROFILE_COMPONENT_INVENTORY_FILE,
    receipt_root: str = DEFAULT_PROFILE_RECEIPT_ROOT,
    lock_path: str = PROFILE_ACTIVATION_LOCK_FILE,
) -> dict:
    if distribution_profile != "owner-development":
        raise PermissionError("Profile activation command is unavailable in this distribution")
    if not isinstance(payload, dict):
        raise ValueError("Profile activation command must be an object")
    action = payload.get("action")
    expected_revision = payload.get("expectedRevision")
    if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
        raise ValueError("Profile activation expected revision is invalid")
    if action == "activate":
        if set(payload) != {"schema", "action", "expectedRevision", "spaceId", "spaceKind", "profile", "components", "activatedAt"}:
            raise ValueError("Profile activate command fields are incompatible")
        if payload.get("schema") != COMMAND_SCHEMA:
            raise ValueError("Profile activation command schema is incompatible")
        space_id = payload.get("spaceId")
        space_kind = payload.get("spaceKind")
        profile = payload.get("profile")
        components = payload.get("components")
        if not isinstance(space_id, str) or not space_id or len(space_id) > 160:
            raise ValueError("Profile activation Space id is invalid")
        if space_kind not in _SPACE_KINDS:
            raise ValueError("Profile activation Space kind is invalid")
        if not isinstance(profile, dict) or set(profile) != {"slug", "version"}:
            raise ValueError("Profile activation identity is invalid")
        if not isinstance(components, list) or len(components) > MAX_COMMAND_COMPONENTS:
            raise ValueError("Profile activation components are invalid")
        manifest = _canonical_manifest(profile.get("slug"), profile.get("version"))
        _assert_internal_activation_allowed(manifest, space_kind, components)
        result = activate_profile(
            space_id=space_id,
            space_kind=space_kind,
            activation={
                "profile": profile,
                "components": components,
                "activatedAt": payload.get("activatedAt"),
            },
            expected_revision=expected_revision,
            state_path=state_path,
            inventory_path=inventory_path,
            receipt_root=receipt_root,
            lock_path=lock_path,
        )
    elif action in {"deactivate", "rollback"}:
        if set(payload) != {"schema", "action", "expectedRevision", "spaceId"}:
            raise ValueError("Profile mutation command fields are incompatible")
        if payload.get("schema") != COMMAND_SCHEMA:
            raise ValueError("Profile activation command schema is incompatible")
        space_id = payload.get("spaceId")
        if not isinstance(space_id, str) or not space_id or len(space_id) > 160:
            raise ValueError("Profile activation Space id is invalid")
        if action == "deactivate":
            result = deactivate_profile(
                space_id=space_id,
                expected_revision=expected_revision,
                state_path=state_path,
                lock_path=lock_path,
            )
        else:
            result = rollback_profile(
                space_id=space_id,
                expected_revision=expected_revision,
                state_path=state_path,
                inventory_path=inventory_path,
                receipt_root=receipt_root,
                lock_path=lock_path,
            )
    else:
        raise ValueError("Profile activation action is unsupported")

    return {
        "schema": COMMAND_SCHEMA,
        "action": action,
        "changed": result["changed"],
        "state": result["state"],
    }
