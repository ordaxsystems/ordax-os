#!/usr/bin/env python3
"""Trusted Native command boundary for local Profile activation."""

from __future__ import annotations

import hashlib
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

COMMAND_SCHEMA = "ordax.profile-activation-command/1"
MAX_COMMAND_COMPONENTS = 64
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,79}$")
_SPACE_KINDS = frozenset(("personal", "work", "professional"))
_COMPONENT_KINDS = frozenset(("app", "knowledge-pack", "skill-pack", "model-pack", "connector"))
_CONTENT_ONLY_KINDS = frozenset(("knowledge-pack", "skill-pack"))
_SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


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


def _canonical_component_binding(manifest: dict, components: list) -> dict:
    requirements = manifest.get("components")
    if not isinstance(requirements, list) or len(requirements) > MAX_COMMAND_COMPONENTS:
        raise ValueError("Profile canonical component declaration is invalid")
    expected_by_id: dict[str, dict] = {}
    for index, requirement in enumerate(requirements):
        if not isinstance(requirement, dict):
            raise ValueError("Profile canonical component declaration is invalid")
        component_id = requirement.get("id")
        kind = requirement.get("kind")
        version = requirement.get("version")
        availability = requirement.get("availability")
        required = requirement.get("required")
        signature_required = requirement.get("signature_required")
        sha256 = requirement.get("sha256")
        if (
            not isinstance(component_id, str)
            or not component_id
            or len(component_id) > 128
            or component_id in expected_by_id
            or kind not in _COMPONENT_KINDS
            or not isinstance(version, str)
            or _SEMVER_RE.fullmatch(version) is None
            or availability not in {"available", "planned"}
            or not isinstance(required, bool)
            or not isinstance(signature_required, bool)
        ):
            raise ValueError(f"Profile canonical component declaration[{index}] is invalid")
        if availability == "available":
            if not signature_required or not isinstance(sha256, str) or _SHA256_RE.fullmatch(sha256) is None:
                raise ValueError("Published Profile component declaration is incomplete")
        elif sha256 is not None:
            raise ValueError("Planned Profile component cannot claim a publish hash")
        expected_by_id[component_id] = requirement

    requested_by_id: dict[str, dict] = {}
    for component in components:
        if not isinstance(component, dict):
            raise ValueError("Profile activation component is invalid")
        component_id = component.get("id")
        if not isinstance(component_id, str) or component_id in requested_by_id:
            raise ValueError("Profile activation components contain duplicate or invalid ids")
        requested_by_id[component_id] = component

    unexpected = sorted(set(requested_by_id) - set(expected_by_id))
    if unexpected:
        raise ValueError("Profile activation contains components outside the canonical manifest")

    added: list[dict] = []
    for component_id, requirement in expected_by_id.items():
        requested = requested_by_id.get(component_id)
        if requirement["availability"] == "planned":
            if requested is not None:
                raise PermissionError("Planned Profile component is not activatable")
            if requirement["required"]:
                continue
        elif requirement["required"] and requested is None:
            raise ValueError("Required canonical Profile component is missing")
        if requested is None:
            continue
        if (
            requested.get("kind") != requirement["kind"]
            or requested.get("version") != requirement["version"]
            or requested.get("sha256") != requirement["sha256"]
        ):
            raise ValueError("Profile activation component identity does not match canonical manifest")
        if requirement["kind"] not in _CONTENT_ONLY_KINDS:
            raise PermissionError("Profile component kind requires a future authority review")
        added.append({
            "id": component_id,
            "kind": requirement["kind"],
            "version": requirement["version"],
            "sha256": requirement["sha256"],
        })

    return {
        "schema": "ordax.profile-permission-diff/1",
        "componentAdds": added,
        "componentRemovals": [],
        "authorityChanges": [],
        "requiresExplicitReview": bool(added),
    }


def _permission_review_digest(
    *,
    expected_revision: int,
    space_id: str,
    space_kind: str,
    profile: dict,
    components: list,
    permission_diff: dict,
) -> str:
    payload = {
        "schema": "ordax.profile-permission-review/1",
        "expectedRevision": expected_revision,
        "spaceId": space_id,
        "spaceKind": space_kind,
        "profile": profile,
        "components": components,
        "permissionDiff": permission_diff,
    }
    canonical = json.dumps(
        payload,
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _assert_internal_activation_allowed(manifest: dict, space_kind: str, components: list) -> dict:
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
    return _canonical_component_binding(manifest, components)


def execute_profile_activation_command(
    payload: object,
    *,
    distribution_profile: str,
    state_path: str = PROFILE_ACTIVATION_STATE_FILE,
    inventory_path: str = PROFILE_COMPONENT_INVENTORY_FILE,
    lock_path: str = PROFILE_ACTIVATION_LOCK_FILE,
    human_consent_authority=None,
    human_consent_resolver=None,
) -> dict:
    if distribution_profile != "owner-development":
        raise PermissionError("Profile activation command is unavailable in this distribution")
    if not isinstance(payload, dict):
        raise ValueError("Profile activation command must be an object")
    action = payload.get("action")
    expected_revision = payload.get("expectedRevision")
    if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
        raise ValueError("Profile activation expected revision is invalid")
    if action in {"preview-activate", "activate"}:
        activate_fields = {"schema", "action", "expectedRevision", "spaceId", "spaceKind", "profile", "components"}
        if action == "activate":
            activate_fields = {*activate_fields, "activatedAt"}
            if "acceptedPermissionDiffSha256" in payload:
                activate_fields.add("acceptedPermissionDiffSha256")
        if set(payload) != activate_fields:
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
        permission_diff = _assert_internal_activation_allowed(manifest, space_kind, components)
        review_digest = _permission_review_digest(
            expected_revision=expected_revision,
            space_id=space_id,
            space_kind=space_kind,
            profile=profile,
            components=components,
            permission_diff=permission_diff,
        )
        if action == "preview-activate":
            return {
                "schema": COMMAND_SCHEMA,
                "action": action,
                "changed": False,
                "state": read_profile_activation_state(state_path),
                "permissionDiff": permission_diff,
                "permissionDiffSha256": review_digest,
            }
        accepted_digest = payload.get("acceptedPermissionDiffSha256")
        if permission_diff["requiresExplicitReview"]:
            if not isinstance(accepted_digest, str) or accepted_digest != review_digest:
                raise PermissionError("Profile permission diff acceptance is missing or stale")
            if human_consent_authority is None or human_consent_resolver is None:
                raise PermissionError(
                    "Profile component activation awaits a trusted human confirmation surface"
                )
            consent_receipt = human_consent_resolver(
                permission_diff=permission_diff,
                permission_diff_sha256=review_digest,
                expected_revision=expected_revision,
                space_id=space_id,
                space_kind=space_kind,
                profile=profile,
            )
            if consent_receipt is None:
                raise PermissionError("Profile component activation was rejected by the user")
            human_consent_authority.consume(
                consent_receipt,
                permission_diff_sha256=review_digest,
                expected_revision=expected_revision,
                space_id=space_id,
                profile=profile,
            )
        elif accepted_digest is not None and accepted_digest != review_digest:
            raise PermissionError("Profile permission diff acceptance does not match activation intent")
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
            lock_path=lock_path,
        )
    elif action in {"deactivate", "rollback"}:
        permission_diff = None
        review_digest = None
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
                lock_path=lock_path,
            )
    else:
        raise ValueError("Profile activation action is unsupported")

    return {
        "schema": COMMAND_SCHEMA,
        "action": action,
        "changed": result["changed"],
        "state": result["state"],
        "permissionDiff": permission_diff,
    }
