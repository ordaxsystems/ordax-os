#!/usr/bin/env python3
"""Privileged Native adapter for exact-revision component pending decisions.

This module is intentionally separate from native_component_slots.py. The slot
reader/health bridge must not gain promotion or rejection authority.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass

MAX_OUTPUT_BYTES = 16 * 1024
DEFAULT_TIMEOUT_SECONDS = 3.0

_COMPONENT_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$"
)
SUPPORTED_COMPONENTS = frozenset({"internet", "notes"})


class ComponentPendingDecisionError(RuntimeError):
    pass


@dataclass(frozen=True)
class ComponentPendingDecisionRecord:
    component_id: str
    revision: int
    version: str
    source_commit: str
    action: str


def _validate_identity(
    *,
    component_id: object,
    version: object,
    source_commit: object,
    expected_revision: object,
) -> tuple[str, str, str, int]:
    if (
        not isinstance(component_id, str)
        or component_id not in SUPPORTED_COMPONENTS
        or not _COMPONENT_RE.fullmatch(component_id)
    ):
        raise ComponentPendingDecisionError("unsupported runtime component pending decision")
    if not isinstance(version, str) or not _SEMVER_RE.fullmatch(version):
        raise ComponentPendingDecisionError("invalid runtime component pending version")
    if not isinstance(source_commit, str) or not _SHA40_RE.fullmatch(source_commit):
        raise ComponentPendingDecisionError("invalid runtime component pending source commit")
    if (
        not isinstance(expected_revision, int)
        or isinstance(expected_revision, bool)
        or expected_revision <= 0
    ):
        raise ComponentPendingDecisionError("invalid runtime component pending revision")
    return component_id, version, source_commit, expected_revision


def _run_helper(
    helper_path: object,
    argv: list[str],
    *,
    timeout_seconds: float,
) -> bytes:
    if not isinstance(helper_path, str) or not helper_path:
        raise ComponentPendingDecisionError("runtime component channel is unavailable")
    if (
        not isinstance(timeout_seconds, (int, float))
        or isinstance(timeout_seconds, bool)
        or timeout_seconds <= 0
        or timeout_seconds > 30
    ):
        raise ComponentPendingDecisionError("runtime component pending decision timeout is invalid")
    try:
        completed = subprocess.run(
            [helper_path, *argv],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=float(timeout_seconds),
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ComponentPendingDecisionError(
            "runtime component pending decision helper unavailable"
        ) from exc
    if completed.returncode != 0:
        raise ComponentPendingDecisionError(
            "runtime component pending decision helper rejected request"
        )
    if len(completed.stdout) > MAX_OUTPUT_BYTES or len(completed.stderr) > 4096:
        raise ComponentPendingDecisionError(
            "runtime component pending decision helper output exceeded limit"
        )
    return completed.stdout


def _parse_receipt(
    payload: bytes,
    *,
    component_id: str,
    version: str,
    source_commit: str,
    expected_revision: int,
    action: str,
) -> ComponentPendingDecisionRecord:
    if len(payload) > MAX_OUTPUT_BYTES:
        raise ComponentPendingDecisionError("runtime component pending decision output exceeded limit")
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ComponentPendingDecisionError(
            "runtime component pending decision output is not UTF-8"
        ) from exc

    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        if not raw_line or "=" not in raw_line:
            raise ComponentPendingDecisionError("runtime component pending decision output is malformed")
        key, value = raw_line.split("=", 1)
        if not key or key in values:
            raise ComponentPendingDecisionError(
                "runtime component pending decision output contains duplicate fields"
            )
        values[key] = value

    if action == "promote":
        marker = "RUNTIME_COMPONENT_STATE_PROMOTED"
        version_key = "CURRENT_VERSION"
        commit_key = "CURRENT_SOURCE_COMMIT"
    elif action == "reject":
        marker = "RUNTIME_COMPONENT_PENDING_REJECTED"
        version_key = "REJECTED_VERSION"
        commit_key = "REJECTED_SOURCE_COMMIT"
    else:
        raise ComponentPendingDecisionError("unsupported runtime component pending decision")

    required = {
        marker,
        "COMPONENT_ID",
        "REVISION",
        version_key,
        commit_key,
        "RUNTIME_ACTIVATED",
    }
    if set(values) != required:
        raise ComponentPendingDecisionError(
            "runtime component pending decision output contains unexpected fields"
        )
    if values[marker] != "YES" or values["RUNTIME_ACTIVATED"] != "NO":
        raise ComponentPendingDecisionError(
            "runtime component pending decision receipt exceeded authority"
        )
    if values["COMPONENT_ID"] != component_id:
        raise ComponentPendingDecisionError(
            "runtime component pending decision component mismatch"
        )
    if values[version_key] != version or values[commit_key] != source_commit:
        raise ComponentPendingDecisionError(
            "runtime component pending decision identity mismatch"
        )
    try:
        revision = int(values["REVISION"])
    except ValueError as exc:
        raise ComponentPendingDecisionError(
            "runtime component pending decision revision is invalid"
        ) from exc
    if revision != expected_revision + 1:
        raise ComponentPendingDecisionError(
            "runtime component pending decision revision did not advance exactly once"
        )

    return ComponentPendingDecisionRecord(
        component_id=component_id,
        revision=revision,
        version=version,
        source_commit=source_commit,
        action=action,
    )


def promote_component_pending(
    *,
    helper_path: str,
    trust_path: str,
    component_id: str,
    version: str,
    source_commit: str,
    expected_revision: int,
    slot_root: str,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> ComponentPendingDecisionRecord:
    component_id, version, source_commit, expected_revision = _validate_identity(
        component_id=component_id,
        version=version,
        source_commit=source_commit,
        expected_revision=expected_revision,
    )
    if not isinstance(trust_path, str) or not trust_path:
        raise ComponentPendingDecisionError("runtime component trust is unavailable")
    if not isinstance(slot_root, str) or not slot_root:
        raise ComponentPendingDecisionError("runtime component slot root is unavailable")
    output = _run_helper(
        helper_path,
        [
            "promote-state",
            "--component", component_id,
            "--version", version,
            "--source-commit", source_commit,
            "--expected-revision", str(expected_revision),
            "--trust", trust_path,
            "--root", slot_root,
        ],
        timeout_seconds=timeout_seconds,
    )
    return _parse_receipt(
        output,
        component_id=component_id,
        version=version,
        source_commit=source_commit,
        expected_revision=expected_revision,
        action="promote",
    )


def reject_component_pending(
    *,
    helper_path: str,
    component_id: str,
    version: str,
    source_commit: str,
    expected_revision: int,
    slot_root: str,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> ComponentPendingDecisionRecord:
    component_id, version, source_commit, expected_revision = _validate_identity(
        component_id=component_id,
        version=version,
        source_commit=source_commit,
        expected_revision=expected_revision,
    )
    if not isinstance(slot_root, str) or not slot_root:
        raise ComponentPendingDecisionError("runtime component slot root is unavailable")
    output = _run_helper(
        helper_path,
        [
            "reject-pending",
            "--component", component_id,
            "--version", version,
            "--source-commit", source_commit,
            "--expected-revision", str(expected_revision),
            "--root", slot_root,
        ],
        timeout_seconds=timeout_seconds,
    )
    return _parse_receipt(
        output,
        component_id=component_id,
        version=version,
        source_commit=source_commit,
        expected_revision=expected_revision,
        action="reject",
    )
