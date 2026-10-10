#!/usr/bin/env python3
"""Fail-closed Native adapter for verified OrdaX runtime component slots."""

from __future__ import annotations

import os
import re
import stat
import subprocess
from dataclasses import dataclass

from native_store_metadata_policy import STORE_METADATA_COMPONENT_IDS

DEFAULT_SLOT_ROOT = "/var/lib/ordax/components"
COMPONENT_MODULE_PREFIX = "/__ordax/native/component-module/"
MAX_RUNTIME_FILE_BYTES = 2 * 1024 * 1024
MAX_RESOLVE_OUTPUT_BYTES = 16 * 1024
MAX_HEALTH_OUTPUT_BYTES = 16 * 1024
DEFAULT_TIMEOUT_SECONDS = 3.0

_COMPONENT_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
_SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$")

SUPPORTED_COMPONENTS = frozenset({"internet", "notes", "studio"})
# Metadata-only current-state queries may include more known first-party apps.
# Executable file reads, Native module URLs and health writes stay restricted.
if not SUPPORTED_COMPONENTS.issubset(STORE_METADATA_COMPONENT_IDS):
    raise RuntimeError("Native module components missing from canonical metadata registry")
HEALTH_MUTATION_COMPONENTS = frozenset({"internet", "notes"})
SUPPORTED_STATES = frozenset({"current", "pending"})


class ComponentSlotError(RuntimeError):
    pass


class ComponentSlotUnavailableError(ComponentSlotError):
    pass


class ComponentSlotRequestError(ComponentSlotError):
    pass


class ComponentSlotVerificationError(ComponentSlotError):
    pass


@dataclass(frozen=True)
class ComponentModuleRequest:
    component_id: str
    state: str
    version: str
    source_commit: str
    requested_path: str


@dataclass(frozen=True)
class ComponentSlotResolution:
    component_id: str
    state: str
    source: str
    revision: int
    version: str | None
    source_commit: str | None
    entrypoint: str | None
    slot: str | None
    pending_health: str | None = None


@dataclass(frozen=True)
class ComponentHealthRecord:
    component_id: str
    revision: int
    version: str
    source_commit: str
    health: str


def _safe_regular_file(path: str, *, executable: bool = False) -> bool:
    try:
        metadata = os.lstat(path)
    except OSError:
        return False
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        return False
    if executable and not os.access(path, os.X_OK):
        return False
    return True


def component_slot_reader_available(
    *,
    helper_path: str,
    trust_path: str,
    distribution_profile: str,
    product_mode: str | None,
) -> bool:
    return (
        distribution_profile == "stable-mvp"
        and product_mode == "usb"
        and _safe_regular_file(helper_path, executable=True)
        and _safe_regular_file(trust_path)
    )


def _validate_request(
    component_id: str,
    state: str,
    requested_path: str | None = None,
    *,
    metadata_current_only: bool = False,
) -> None:
    allowed = STORE_METADATA_COMPONENT_IDS if metadata_current_only and state == "current" else SUPPORTED_COMPONENTS
    if component_id not in allowed or not _COMPONENT_RE.fullmatch(component_id):
        raise ComponentSlotRequestError("unsupported runtime component")
    if state not in SUPPORTED_STATES:
        raise ComponentSlotRequestError("unsupported runtime component state")
    if requested_path is None:
        return
    if (
        not requested_path
        or len(requested_path) > 512
        or "\x00" in requested_path
        or "\\" in requested_path
        or requested_path.startswith("/")
    ):
        raise ComponentSlotRequestError("invalid runtime component path")
    parts = requested_path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ComponentSlotRequestError("invalid runtime component path")


def parse_component_module_path(path: str) -> ComponentModuleRequest:
    if (
        not isinstance(path, str)
        or not path.startswith(COMPONENT_MODULE_PREFIX)
        or "\x00" in path
        or "\\" in path
        or "%" in path
        or "?" in path
        or "#" in path
    ):
        raise ComponentSlotRequestError("invalid runtime component module path")

    suffix = path[len(COMPONENT_MODULE_PREFIX):]
    parts = suffix.split("/", 4)
    if len(parts) != 5:
        raise ComponentSlotRequestError("invalid runtime component module path")

    component_id, state, version, source_commit, requested_path = parts
    _validate_request(component_id, state, requested_path)
    if not _SEMVER_RE.fullmatch(version) or not _SHA40_RE.fullmatch(source_commit):
        raise ComponentSlotRequestError("invalid runtime component slot identity")

    return ComponentModuleRequest(
        component_id=component_id,
        state=state,
        version=version,
        source_commit=source_commit,
        requested_path=requested_path,
    )


def _run_helper(
    helper_path: str,
    argv: list[str],
    *,
    max_stdout_bytes: int,
    timeout_seconds: float,
) -> bytes:
    try:
        completed = subprocess.run(
            [helper_path, *argv],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_seconds,
            env={
                "PATH": "/usr/bin:/bin",
                "LANG": "C",
                "LC_ALL": "C",
            },
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ComponentSlotUnavailableError("runtime component verifier unavailable") from exc

    if completed.returncode != 0:
        raise ComponentSlotVerificationError("runtime component verifier rejected request")
    if len(completed.stdout) > max_stdout_bytes:
        raise ComponentSlotVerificationError("runtime component verifier output exceeded limit")
    if len(completed.stderr) > 4096:
        raise ComponentSlotVerificationError("runtime component verifier stderr exceeded limit")
    return completed.stdout


def _parse_resolution_output(payload: bytes, component_id: str, state: str) -> ComponentSlotResolution:
    if len(payload) > MAX_RESOLVE_OUTPUT_BYTES:
        raise ComponentSlotVerificationError("runtime component resolution output exceeded limit")
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ComponentSlotVerificationError("runtime component resolution is not UTF-8") from exc

    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        if not raw_line or "=" not in raw_line:
            raise ComponentSlotVerificationError("runtime component resolution is malformed")
        key, value = raw_line.split("=", 1)
        if not key or key in values:
            raise ComponentSlotVerificationError("runtime component resolution contains duplicate fields")
        values[key] = value

    marker = (
        "RUNTIME_COMPONENT_CURRENT_RESOLVED"
        if state == "current"
        else "RUNTIME_COMPONENT_PENDING_RESOLVED"
    )
    if values.get(marker) != "YES":
        raise ComponentSlotVerificationError("runtime component resolution marker is missing")
    if values.get("COMPONENT_ID") != component_id:
        raise ComponentSlotVerificationError("runtime component resolution identity mismatch")
    if values.get("RUNTIME_SERVED_FROM_SLOT") != "NO":
        raise ComponentSlotVerificationError("runtime component verifier exceeded read-only authority")

    try:
        revision = int(values["REVISION"])
    except (KeyError, ValueError) as exc:
        raise ComponentSlotVerificationError("runtime component revision is invalid") from exc
    if revision < 0:
        raise ComponentSlotVerificationError("runtime component revision is invalid")

    source = values.get("SOURCE")
    if state == "current" and source == "BUNDLED":
        allowed = {
            marker,
            "COMPONENT_ID",
            "REVISION",
            "SOURCE",
            "RUNTIME_SERVED_FROM_SLOT",
        }
        if set(values) != allowed:
            raise ComponentSlotVerificationError("bundled resolution contains unexpected fields")
        return ComponentSlotResolution(
            component_id=component_id,
            state=state,
            source="bundled",
            revision=revision,
            version=None,
            source_commit=None,
            entrypoint=None,
            slot=None,
        )

    if state == "current" and source in {"ABSENT", "REMOVED"}:
        allowed = {
            marker,
            "COMPONENT_ID",
            "REVISION",
            "SOURCE",
            "RUNTIME_SERVED_FROM_SLOT",
        }
        if set(values) != allowed:
            raise ComponentSlotVerificationError("absent or removed resolution contains unexpected fields")
        return ComponentSlotResolution(
            component_id=component_id,
            state=state,
            source="removed" if source == "REMOVED" else "absent",
            revision=revision,
            version=None,
            source_commit=None,
            entrypoint=None,
            slot=None,
        )

    if source != "SLOT":
        raise ComponentSlotVerificationError("runtime component source is invalid")
    version_key = "CURRENT_VERSION" if state == "current" else "PENDING_VERSION"
    commit_key = "CURRENT_SOURCE_COMMIT" if state == "current" else "PENDING_SOURCE_COMMIT"
    version = values.get(version_key, "")
    source_commit = values.get(commit_key, "")
    entrypoint = values.get("ENTRYPOINT", "")
    slot = values.get("SLOT", "")
    if not _SEMVER_RE.fullmatch(version) or not _SHA40_RE.fullmatch(source_commit):
        raise ComponentSlotVerificationError("runtime component slot identity is invalid")
    if (
        not entrypoint
        or not slot
        or not entrypoint.startswith(("system/apps/" + component_id + "/", "system/components/" + component_id + "/"))
    ):
        raise ComponentSlotVerificationError("runtime component entrypoint is invalid")
    if not os.path.isabs(slot):
        raise ComponentSlotVerificationError("runtime component slot path is invalid")

    pending_health = values.get("PENDING_HEALTH") if state == "pending" else None
    if state == "pending" and pending_health not in {"unknown", "healthy", "failed"}:
        raise ComponentSlotVerificationError("runtime component pending health is invalid")

    required = {
        marker,
        "COMPONENT_ID",
        "REVISION",
        "SOURCE",
        version_key,
        commit_key,
        "SLOT",
        "ENTRYPOINT",
        "RUNTIME_SERVED_FROM_SLOT",
    }
    if state == "pending":
        required.add("PENDING_HEALTH")
    if set(values) != required:
        raise ComponentSlotVerificationError("runtime component resolution contains unexpected fields")

    return ComponentSlotResolution(
        component_id=component_id,
        state=state,
        source="slot",
        revision=revision,
        version=version,
        source_commit=source_commit,
        entrypoint=entrypoint,
        slot=slot,
        pending_health=pending_health,
    )


def resolve_component_slot(
    *,
    helper_path: str,
    trust_path: str,
    component_id: str,
    state: str,
    slot_root: str = DEFAULT_SLOT_ROOT,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> ComponentSlotResolution:
    _validate_request(component_id, state, metadata_current_only=True)
    command = "resolve-current" if state == "current" else "resolve-pending"
    output = _run_helper(
        helper_path,
        [
            command,
            "--component",
            component_id,
            "--trust",
            trust_path,
            "--root",
            slot_root,
        ],
        max_stdout_bytes=MAX_RESOLVE_OUTPUT_BYTES,
        timeout_seconds=timeout_seconds,
    )
    return _parse_resolution_output(output, component_id, state)


def read_component_runtime_file(
    *,
    helper_path: str,
    trust_path: str,
    component_id: str,
    state: str,
    version: str,
    source_commit: str,
    requested_path: str,
    slot_root: str = DEFAULT_SLOT_ROOT,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> bytes:
    _validate_request(component_id, state, requested_path)
    if not _SEMVER_RE.fullmatch(version) or not _SHA40_RE.fullmatch(source_commit):
        raise ComponentSlotRequestError("invalid runtime component slot identity")
    return _run_helper(
        helper_path,
        [
            "read-runtime-file",
            "--component",
            component_id,
            "--trust",
            trust_path,
            "--state",
            state,
            "--version",
            version,
            "--source-commit",
            source_commit,
            "--path",
            requested_path,
            "--root",
            slot_root,
        ],
        max_stdout_bytes=MAX_RUNTIME_FILE_BYTES,
        timeout_seconds=timeout_seconds,
    )


def _parse_health_record_output(
    payload: bytes,
    *,
    component_id: str,
    version: str,
    source_commit: str,
    expected_revision: int,
    health: str,
) -> ComponentHealthRecord:
    if len(payload) > MAX_HEALTH_OUTPUT_BYTES:
        raise ComponentSlotVerificationError("runtime component health output exceeded limit")
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ComponentSlotVerificationError("runtime component health output is not UTF-8") from exc

    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        if not raw_line or "=" not in raw_line:
            raise ComponentSlotVerificationError("runtime component health output is malformed")
        key, value = raw_line.split("=", 1)
        if not key or key in values:
            raise ComponentSlotVerificationError("runtime component health output contains duplicate fields")
        values[key] = value

    required = {
        "RUNTIME_COMPONENT_PENDING_HEALTH_RECORDED",
        "COMPONENT_ID",
        "REVISION",
        "PENDING_VERSION",
        "PENDING_SOURCE_COMMIT",
        "PENDING_HEALTH",
        "RUNTIME_ACTIVATED",
    }
    if set(values) != required:
        raise ComponentSlotVerificationError("runtime component health output contains unexpected fields")
    if values["RUNTIME_COMPONENT_PENDING_HEALTH_RECORDED"] != "YES":
        raise ComponentSlotVerificationError("runtime component health marker is missing")
    if values["RUNTIME_ACTIVATED"] != "NO":
        raise ComponentSlotVerificationError("runtime component health recorder exceeded authority")
    if values["COMPONENT_ID"] != component_id:
        raise ComponentSlotVerificationError("runtime component health component mismatch")
    if values["PENDING_VERSION"] != version or values["PENDING_SOURCE_COMMIT"] != source_commit:
        raise ComponentSlotVerificationError("runtime component health identity mismatch")
    if values["PENDING_HEALTH"] != health:
        raise ComponentSlotVerificationError("runtime component health result mismatch")
    try:
        revision = int(values["REVISION"])
    except ValueError as exc:
        raise ComponentSlotVerificationError("runtime component health revision is invalid") from exc
    if revision != expected_revision + 1:
        raise ComponentSlotVerificationError("runtime component health revision did not advance exactly once")

    return ComponentHealthRecord(
        component_id=component_id,
        revision=revision,
        version=version,
        source_commit=source_commit,
        health=health,
    )


def record_component_pending_health(
    *,
    helper_path: str,
    component_id: str,
    version: str,
    source_commit: str,
    expected_revision: int,
    health: str,
    slot_root: str = DEFAULT_SLOT_ROOT,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> ComponentHealthRecord:
    if component_id not in HEALTH_MUTATION_COMPONENTS or not _COMPONENT_RE.fullmatch(component_id):
        raise ComponentSlotRequestError("unsupported runtime component health mutation")
    if not _SEMVER_RE.fullmatch(version) or not _SHA40_RE.fullmatch(source_commit):
        raise ComponentSlotRequestError("invalid runtime component health identity")
    if not isinstance(expected_revision, int) or isinstance(expected_revision, bool) or expected_revision <= 0:
        raise ComponentSlotRequestError("invalid runtime component probation revision")
    if health not in {"healthy", "failed"}:
        raise ComponentSlotRequestError("invalid runtime component health result")

    output = _run_helper(
        helper_path,
        [
            "record-health",
            "--component",
            component_id,
            "--version",
            version,
            "--source-commit",
            source_commit,
            "--expected-revision",
            str(expected_revision),
            "--health",
            health,
            "--root",
            slot_root,
        ],
        max_stdout_bytes=MAX_HEALTH_OUTPUT_BYTES,
        timeout_seconds=timeout_seconds,
    )
    return _parse_health_record_output(
        output,
        component_id=component_id,
        version=version,
        source_commit=source_commit,
        expected_revision=expected_revision,
        health=health,
    )
