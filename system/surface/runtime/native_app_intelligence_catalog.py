#!/usr/bin/env python3
"""Read verified first-party app intelligence manifests from active component slots."""

from __future__ import annotations

import json
import os
import re
import stat

from native_component_slots import (
    ComponentSlotError,
    ComponentSlotResolution,
    ComponentSlotUnavailableError,
    read_component_app_intelligence_manifest,
    resolve_component_metadata_slot,
)

NATIVE_APP_INTELLIGENCE_MANIFESTS_SCHEMA = "ordax.native-app-intelligence-manifests/1"
ORDAX_APPS_SOURCE_REPOSITORY = "washingtonmsdj/ordax-apps"
ACTIVATION_STATE_NAME = "activation-state.json"
MAX_COMPONENT_CANDIDATES = 64
MAX_ACTIVE_APP_MANIFESTS = 32
MAX_TOTAL_MANIFEST_BYTES = 512 * 1024

_COMPONENT_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_EXPECTED_MANIFEST_KEYS = {
    "schema",
    "appId",
    "appVersion",
    "authority",
    "execution",
    "instructions",
    "intents",
}


class NativeAppIntelligenceError(RuntimeError):
    pass


class NativeAppIntelligenceVerificationError(NativeAppIntelligenceError):
    pass


class NativeAppIntelligenceUnavailableError(NativeAppIntelligenceError):
    pass


def _regular_non_symlink(path: str) -> bool:
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise NativeAppIntelligenceVerificationError(
            "app intelligence activation state is unreadable"
        ) from exc
    return stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode)


def discover_active_component_candidates(slot_root: str) -> tuple[str, ...]:
    try:
        root_info = os.lstat(slot_root)
    except FileNotFoundError:
        return ()
    except OSError as exc:
        raise NativeAppIntelligenceVerificationError(
            "runtime component root is unreadable"
        ) from exc

    if not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode):
        raise NativeAppIntelligenceVerificationError(
            "runtime component root must be a real directory"
        )

    candidates: list[str] = []
    try:
        entries = list(os.scandir(slot_root))
    except OSError as exc:
        raise NativeAppIntelligenceVerificationError(
            "runtime component root cannot be enumerated"
        ) from exc
    if len(entries) > MAX_COMPONENT_CANDIDATES * 4:
        raise NativeAppIntelligenceVerificationError(
            "runtime component root entry count exceeds bound"
        )

    for entry in entries:
        component_id = entry.name
        if not _COMPONENT_RE.fullmatch(component_id):
            continue
        try:
            if entry.is_symlink():
                raise NativeAppIntelligenceVerificationError(
                    "runtime component directory may not be a symlink"
                )
            if not entry.is_dir(follow_symlinks=False):
                continue
        except OSError as exc:
            raise NativeAppIntelligenceVerificationError(
                "runtime component directory cannot be verified"
            ) from exc

        activation_path = os.path.join(entry.path, ACTIVATION_STATE_NAME)
        if not _regular_non_symlink(activation_path):
            continue
        candidates.append(component_id)
        if len(candidates) > MAX_COMPONENT_CANDIDATES:
            raise NativeAppIntelligenceVerificationError(
                "active runtime component candidate count exceeds bound"
            )

    return tuple(sorted(candidates))


def _parse_manifest(
    payload: bytes,
    resolution: ComponentSlotResolution,
) -> dict:
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise NativeAppIntelligenceVerificationError(
            "verified app intelligence manifest is not UTF-8 JSON"
        ) from exc
    if not isinstance(value, dict) or set(value) != _EXPECTED_MANIFEST_KEYS:
        raise NativeAppIntelligenceVerificationError(
            "verified app intelligence manifest fields are not canonical"
        )
    if value.get("schema") != "ordax.app-intelligence-manifest/1":
        raise NativeAppIntelligenceVerificationError(
            "verified app intelligence manifest schema is incompatible"
        )
    if value.get("appId") != resolution.component_id:
        raise NativeAppIntelligenceVerificationError(
            "verified app intelligence manifest appId does not match active component"
        )
    if value.get("appVersion") != resolution.version:
        raise NativeAppIntelligenceVerificationError(
            "verified app intelligence manifest version does not match active slot"
        )
    if value.get("authority") != "none" or value.get("execution") != "declarative-only":
        raise NativeAppIntelligenceVerificationError(
            "verified app intelligence manifest crossed the authority boundary"
        )
    if not isinstance(value.get("instructions"), list) or not isinstance(value.get("intents"), list):
        raise NativeAppIntelligenceVerificationError(
            "verified app intelligence manifest collections are invalid"
        )
    return value


def read_native_app_intelligence_manifests(
    *,
    helper_path: str,
    trust_path: str,
    slot_root: str,
) -> dict:
    manifests: list[dict] = []
    total_bytes = 0

    for component_id in discover_active_component_candidates(slot_root):
        try:
            resolution = resolve_component_metadata_slot(
                helper_path=helper_path,
                trust_path=trust_path,
                component_id=component_id,
                slot_root=slot_root,
            )
        except ComponentSlotUnavailableError as exc:
            raise NativeAppIntelligenceUnavailableError(
                "runtime component verifier is unavailable"
            ) from exc
        except ComponentSlotError as exc:
            raise NativeAppIntelligenceVerificationError(
                f"runtime component metadata verification failed: {component_id}"
            ) from exc

        if resolution.source != "slot":
            continue
        if resolution.source_repository != ORDAX_APPS_SOURCE_REPOSITORY:
            continue
        expected_prefix = f"system/apps/{component_id}/"
        if (
            resolution.version is None
            or resolution.source_commit is None
            or resolution.entrypoint is None
            or not resolution.entrypoint.startswith(expected_prefix)
        ):
            raise NativeAppIntelligenceVerificationError(
                "external first-party app slot identity is incomplete"
            )

        try:
            payload = read_component_app_intelligence_manifest(
                helper_path=helper_path,
                trust_path=trust_path,
                component_id=component_id,
                version=resolution.version,
                source_commit=resolution.source_commit,
                slot_root=slot_root,
            )
        except ComponentSlotUnavailableError as exc:
            raise NativeAppIntelligenceUnavailableError(
                "runtime component verifier is unavailable"
            ) from exc
        except ComponentSlotError as exc:
            raise NativeAppIntelligenceVerificationError(
                f"active first-party app has no verified intelligence manifest: {component_id}"
            ) from exc

        total_bytes += len(payload)
        if total_bytes > MAX_TOTAL_MANIFEST_BYTES:
            raise NativeAppIntelligenceVerificationError(
                "app intelligence manifest catalog exceeds byte bound"
            )
        manifests.append(_parse_manifest(payload, resolution))
        if len(manifests) > MAX_ACTIVE_APP_MANIFESTS:
            raise NativeAppIntelligenceVerificationError(
                "active app intelligence manifest count exceeds bound"
            )

    manifests.sort(key=lambda value: value["appId"])
    return {
        "schema": NATIVE_APP_INTELLIGENCE_MANIFESTS_SCHEMA,
        "manifests": manifests,
    }
