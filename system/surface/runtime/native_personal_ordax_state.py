#!/usr/bin/env python3
"""Private atomic Native owner for Personal OrdaX Work/Activity/Result state."""

from __future__ import annotations

import hashlib
import json
import os

from native_partitioned_json_state import (
    MAX_SAFE_REVISION,
    compare_and_swap_partitioned_json_record,
    partition_state_path,
    read_partitioned_json_record,
)

RECORD_SCHEMA = "ordax.native-personal-ordax-record/1"
STORE_STATE_SCHEMA = "ordax.personal-work-store-state/1"
DEFAULT_PERSONAL_ORDAX_STATE_ROOT = "/var/lib/ordax/personal-ordax"
MAX_PERSONAL_STATE_PAYLOAD_BYTES = 4 * 1024 * 1024
MAX_PERSONAL_RECORD_BYTES = 6 * MAX_PERSONAL_STATE_PAYLOAD_BYTES + 4096
MAX_WORK_ITEMS = 32
MAX_ACTIVITY_EVENTS = 512
MAX_RESULTS = 32
MAX_APPROVALS = 64
MAX_DECISIONS = 64
MAX_ATTEMPTS = 128

_OWNER_KINDS = frozenset(("device", "account"))
_STATE_KEYS = frozenset((
    "schema", "ownerKind", "ownerId", "nextOrdinal", "workItems", "activities",
    "results", "approvals", "decisions", "attempts",
))


def _text(value: object, label: str, max_chars: int) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError(f"{label} is invalid")
    normalized = value.strip()
    if not normalized or len(normalized) > max_chars:
        raise ValueError(f"{label} is invalid")
    return normalized


def normalize_owner(owner_kind: object, owner_id: object = None) -> tuple[str, str | None]:
    if owner_kind not in _OWNER_KINDS:
        raise ValueError("Personal OrdaX owner kind is invalid")
    if owner_kind == "device":
        if owner_id is not None:
            raise ValueError("Device Personal OrdaX owner cannot carry account id")
        return "device", None
    return "account", _text(owner_id, "Personal OrdaX owner id", 160)


def _owner_stem(owner_kind: str, owner_id: str | None) -> str:
    if owner_kind == "device":
        return "device"
    digest = hashlib.sha256(owner_id.encode("utf-8")).hexdigest()
    return f"account-{digest}"


def _state_path(root: str, owner_kind: str, owner_id: str | None) -> str:
    return partition_state_path(root, _owner_stem(owner_kind, owner_id))


def _bounded_array(state: dict, key: str, maximum: int) -> list:
    value = state.get(key)
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f"Personal OrdaX {key} is invalid or unbounded")
    return value


def _assert_authority_none(value: object) -> None:
    if isinstance(value, dict):
        if "authority" in value and value["authority"] != "none":
            raise ValueError("Personal OrdaX persisted authority must remain none")
        for child in value.values():
            _assert_authority_none(child)
    elif isinstance(value, list):
        for child in value:
            _assert_authority_none(child)


def validate_personal_payload(
    payload: object,
    owner_kind: object,
    owner_id: object = None,
) -> str:
    owner_kind, owner_id = normalize_owner(owner_kind, owner_id)
    if not isinstance(payload, str):
        raise ValueError("Personal OrdaX payload must be UTF-8 JSON text")
    encoded = payload.encode("utf-8")
    if len(encoded) > MAX_PERSONAL_STATE_PAYLOAD_BYTES:
        raise ValueError("Personal OrdaX payload exceeds byte limit")
    try:
        state = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError("Personal OrdaX payload is invalid JSON") from exc
    if not isinstance(state, dict) or set(state) != _STATE_KEYS:
        raise ValueError("Personal OrdaX payload shape is invalid")
    if state.get("schema") != STORE_STATE_SCHEMA:
        raise ValueError("Personal OrdaX payload schema is incompatible")
    if state.get("ownerKind") != owner_kind or state.get("ownerId") != owner_id:
        raise ValueError("Personal OrdaX payload owner binding mismatch")
    next_ordinal = state.get("nextOrdinal")
    if isinstance(next_ordinal, bool) or not isinstance(next_ordinal, int) or next_ordinal < 1:
        raise ValueError("Personal OrdaX next ordinal is invalid")

    work_items = _bounded_array(state, "workItems", MAX_WORK_ITEMS)
    _bounded_array(state, "activities", MAX_ACTIVITY_EVENTS)
    _bounded_array(state, "results", MAX_RESULTS)
    _bounded_array(state, "approvals", MAX_APPROVALS)
    _bounded_array(state, "decisions", MAX_DECISIONS)
    _bounded_array(state, "attempts", MAX_ATTEMPTS)

    for work in work_items:
        if not isinstance(work, dict):
            raise ValueError("Personal OrdaX work item is invalid")
        if work.get("ownerKind") != owner_kind or work.get("ownerId") != owner_id:
            raise ValueError("Personal OrdaX work crosses owner partition")
        if work.get("backgroundExecution") is not False:
            raise ValueError("Personal OrdaX public background execution remains disabled")

    _assert_authority_none(state)
    normalized = json.dumps(
        state,
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
    )
    if len(normalized.encode("utf-8")) > MAX_PERSONAL_STATE_PAYLOAD_BYTES:
        raise ValueError("Personal OrdaX normalized payload exceeds byte limit")
    return normalized


def _validate_record(value: object, owner_kind: str, owner_id: str | None) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "$schema", "revision", "ownerKind", "ownerId", "payload"
    }:
        raise ValueError("Personal OrdaX Native record shape is invalid")
    if value.get("$schema") != RECORD_SCHEMA:
        raise ValueError("Personal OrdaX Native record schema is incompatible")
    revision = value.get("revision")
    if (
        isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 1
        or revision > MAX_SAFE_REVISION
    ):
        raise ValueError("Personal OrdaX Native record revision is invalid")
    if value.get("ownerKind") != owner_kind or value.get("ownerId") != owner_id:
        raise ValueError("Personal OrdaX Native record owner binding mismatch")
    payload = validate_personal_payload(value.get("payload"), owner_kind, owner_id)
    return {
        "$schema": RECORD_SCHEMA,
        "revision": revision,
        "ownerKind": owner_kind,
        "ownerId": owner_id,
        "payload": payload,
    }


def _record_validator(owner_kind: str, owner_id: str | None):
    return lambda value: _validate_record(value, owner_kind, owner_id)


def read_personal_ordax_record(
    owner_kind: object,
    owner_id: object = None,
    root: str = DEFAULT_PERSONAL_ORDAX_STATE_ROOT,
) -> dict | None:
    owner_kind, owner_id = normalize_owner(owner_kind, owner_id)
    return read_partitioned_json_record(
        root,
        _owner_stem(owner_kind, owner_id),
        max_record_bytes=MAX_PERSONAL_RECORD_BYTES,
        validate_record=_record_validator(owner_kind, owner_id),
        label="Personal OrdaX Native",
    )


def compare_and_swap_personal_ordax_payload(
    owner_kind: object,
    owner_id: object,
    expected_revision: object,
    payload: object,
    root: str = DEFAULT_PERSONAL_ORDAX_STATE_ROOT,
) -> dict | None:
    owner_kind, owner_id = normalize_owner(owner_kind, owner_id)
    if (
        isinstance(expected_revision, bool)
        or not isinstance(expected_revision, int)
        or expected_revision < 0
        or expected_revision >= MAX_SAFE_REVISION
    ):
        raise ValueError("Personal OrdaX expected revision is invalid")
    payload = validate_personal_payload(payload, owner_kind, owner_id)
    record = {
        "$schema": RECORD_SCHEMA,
        "revision": expected_revision + 1,
        "ownerKind": owner_kind,
        "ownerId": owner_id,
        "payload": payload,
    }
    return compare_and_swap_partitioned_json_record(
        root,
        _owner_stem(owner_kind, owner_id),
        expected_revision,
        record,
        max_record_bytes=MAX_PERSONAL_RECORD_BYTES,
        validate_record=_record_validator(owner_kind, owner_id),
        label="Personal OrdaX Native",
    )
