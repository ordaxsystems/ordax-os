#!/usr/bin/env python3
"""Private partitioned Native persistence for Work Coordination state."""

from __future__ import annotations

import hashlib
import json

from native_partitioned_json_state import (
    MAX_SAFE_REVISION,
    compare_and_swap_partitioned_json_record,
    partition_state_path,
    read_partitioned_json_record,
)

RECORD_SCHEMA = "ordax.native-work-coordination-record/1"
STORE_STATE_SCHEMA = "ordax.work-coordination-store-state/1"
STORE_FORMAT_VERSION = 1
DEFAULT_WORK_COORDINATION_STATE_ROOT = "/var/lib/ordax/work-coordination"
MAX_WORK_COORDINATION_PAYLOAD_BYTES = 4 * 1024 * 1024
MAX_WORK_COORDINATION_RECORD_BYTES = 6 * MAX_WORK_COORDINATION_PAYLOAD_BYTES + 8192
MAX_PLANS = 32
MAX_TASKS = 512
MAX_CLAIMS = 128
MAX_CHECKPOINTS = 512
MAX_EVIDENCE = 1024

_OWNER_KINDS = frozenset(("device", "account"))
_STATE_KEYS = frozenset((
    "schema", "formatVersion", "ownerKind", "ownerId", "projectId",
    "plans", "tasks", "claims", "checkpoints", "evidence",
))
_FORBIDDEN_AUTHORITY_FIELDS = frozenset((
    "grantRef", "approvalId", "actionId", "toolId", "authoritySource",
    "effect", "decision", "executionAuthorized",
))
_ENTITY_SCHEMAS = {
    "plans": "ordax.work-plan/1",
    "tasks": "ordax.work-task/1",
    "claims": "ordax.work-claim/1",
    "checkpoints": "ordax.work-checkpoint/1",
    "evidence": "ordax.work-evidence/1",
}


def _text(value: object, label: str, max_chars: int) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError(f"{label} is invalid")
    normalized = value.strip()
    if not normalized or len(normalized) > max_chars:
        raise ValueError(f"{label} is invalid")
    return normalized


def _optional_text(value: object, label: str, max_chars: int) -> str | None:
    if value is None or value == "":
        return None
    return _text(value, label, max_chars)


def _positive_revision(value: object, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > MAX_SAFE_REVISION
    ):
        raise ValueError(f"{label} is invalid")
    return value


def normalize_work_coordination_partition(
    owner_kind: object,
    owner_id: object = None,
    project_id: object = None,
) -> tuple[str, str | None, str | None]:
    if owner_kind not in _OWNER_KINDS:
        raise ValueError("Work Coordination owner kind is invalid")
    if owner_kind == "device":
        if owner_id is not None:
            raise ValueError("Device Work Coordination owner cannot carry account id")
        normalized_owner_id = None
    else:
        normalized_owner_id = _text(owner_id, "Work Coordination owner id", 160)
    normalized_project_id = _optional_text(project_id, "Work Coordination project id", 240)
    return owner_kind, normalized_owner_id, normalized_project_id


def _partition_stem(owner_kind: str, owner_id: str | None, project_id: str | None) -> str:
    canonical = (
        "ordax.work-coordination.partition/1\0"
        + owner_kind + "\0"
        + (owner_id or "") + "\0"
        + (project_id or "")
    ).encode("utf-8")
    return f"coord-{hashlib.sha256(canonical).hexdigest()}"


def _state_path(
    root: str,
    owner_kind: str,
    owner_id: str | None,
    project_id: str | None,
) -> str:
    return partition_state_path(root, _partition_stem(owner_kind, owner_id, project_id))


def _bounded_array(state: dict, key: str, maximum: int) -> list:
    value = state.get(key)
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f"Work Coordination {key} is invalid or unbounded")
    return value


def _assert_no_authority_smuggling(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in _FORBIDDEN_AUTHORITY_FIELDS:
                raise ValueError(f"Work Coordination persisted {key} authority field is forbidden")
            if key == "authority" and child != "none":
                raise ValueError("Work Coordination persisted authority must remain none")
            _assert_no_authority_smuggling(child)
    elif isinstance(value, list):
        for child in value:
            _assert_no_authority_smuggling(child)


def _validate_entity_collection(
    values: list,
    key: str,
    expected_schema: str,
) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for item in values:
        if not isinstance(item, dict):
            raise ValueError(f"Work Coordination {key} entry is invalid")
        if item.get("schema") != expected_schema:
            raise ValueError(f"Work Coordination {key} entry schema is incompatible")
        item_id = _text(item.get("id"), f"Work Coordination {key} id", 240)
        if item_id in result:
            raise ValueError(f"Work Coordination {key} ids must be unique")
        _positive_revision(item.get("revision"), f"Work Coordination {key} revision")
        if item.get("authority") != "none":
            raise ValueError(f"Work Coordination {key} authority must remain none")
        result[item_id] = item
    return result


def _validate_checkpoint_collection(values: list) -> None:
    seen: set[tuple[str, int, int]] = set()
    for item in values:
        if not isinstance(item, dict) or item.get("schema") != _ENTITY_SCHEMAS["checkpoints"]:
            raise ValueError("Work Coordination checkpoint entry is invalid")
        task_id = _text(item.get("taskId"), "Work Coordination checkpoint task id", 160)
        task_revision = _positive_revision(
            item.get("taskRevision"), "Work Coordination checkpoint task revision"
        )
        sequence = item.get("sequence")
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise ValueError("Work Coordination checkpoint sequence is invalid")
        identity = (task_id, task_revision, sequence)
        if identity in seen:
            raise ValueError("Work Coordination checkpoint identity must be unique")
        seen.add(identity)
        if item.get("authority") != "none":
            raise ValueError("Work Coordination checkpoint authority must remain none")


def validate_work_coordination_payload(
    payload: object,
    owner_kind: object,
    owner_id: object = None,
    project_id: object = None,
) -> str:
    owner_kind, owner_id, project_id = normalize_work_coordination_partition(
        owner_kind, owner_id, project_id
    )
    if not isinstance(payload, str):
        raise ValueError("Work Coordination payload must be UTF-8 JSON text")
    encoded = payload.encode("utf-8")
    if len(encoded) > MAX_WORK_COORDINATION_PAYLOAD_BYTES:
        raise ValueError("Work Coordination payload exceeds byte limit")
    try:
        state = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError("Work Coordination payload is invalid JSON") from exc
    if not isinstance(state, dict) or set(state) != _STATE_KEYS:
        raise ValueError("Work Coordination payload shape is invalid")
    if state.get("schema") != STORE_STATE_SCHEMA:
        raise ValueError("Work Coordination payload schema is incompatible")
    if state.get("formatVersion") != STORE_FORMAT_VERSION:
        raise ValueError("Work Coordination payload format version is incompatible")
    if (
        state.get("ownerKind") != owner_kind
        or state.get("ownerId") != owner_id
        or state.get("projectId") != project_id
    ):
        raise ValueError("Work Coordination payload partition binding mismatch")

    plans = _bounded_array(state, "plans", MAX_PLANS)
    tasks = _bounded_array(state, "tasks", MAX_TASKS)
    claims = _bounded_array(state, "claims", MAX_CLAIMS)
    checkpoints = _bounded_array(state, "checkpoints", MAX_CHECKPOINTS)
    evidence = _bounded_array(state, "evidence", MAX_EVIDENCE)

    plan_by_id = _validate_entity_collection(plans, "plans", _ENTITY_SCHEMAS["plans"])
    task_by_id = _validate_entity_collection(tasks, "tasks", _ENTITY_SCHEMAS["tasks"])
    claim_by_id = _validate_entity_collection(claims, "claims", _ENTITY_SCHEMAS["claims"])
    evidence_by_id = _validate_entity_collection(evidence, "evidence", _ENTITY_SCHEMAS["evidence"])
    _validate_checkpoint_collection(checkpoints)

    retained_task_ids: set[str] = set()
    for plan_id, plan in plan_by_id.items():
        if (
            plan.get("ownerKind") != owner_kind
            or plan.get("ownerId") != owner_id
            or plan.get("projectId") != project_id
        ):
            raise ValueError("Work Coordination plan crosses persisted partition")
        task_ids = plan.get("taskIds")
        if not isinstance(task_ids, list) or len(task_ids) > MAX_TASKS:
            raise ValueError("Work Coordination plan task ids are invalid or unbounded")
        local: set[str] = set()
        for raw_task_id in task_ids:
            task_id = _text(raw_task_id, "Work Coordination plan task id", 160)
            if task_id in local:
                raise ValueError("Work Coordination plan task ids must be unique")
            task = task_by_id.get(task_id)
            if task is None or task.get("planId") != plan_id:
                raise ValueError("Work Coordination plan task binding is invalid")
            local.add(task_id)
            retained_task_ids.add(task_id)

    for task_id, task in task_by_id.items():
        plan_id = _text(task.get("planId"), "Work Coordination task plan id", 160)
        if plan_id not in plan_by_id:
            raise ValueError("Work Coordination task references missing plan")
        if task_id not in retained_task_ids:
            raise ValueError("Work Coordination task is not retained by its plan")
        dependencies = task.get("dependsOnTaskIds")
        if not isinstance(dependencies, list) or len(dependencies) > MAX_TASKS:
            raise ValueError("Work Coordination task dependencies are invalid or unbounded")
        local_dependencies: set[str] = set()
        for raw_dependency_id in dependencies:
            dependency_id = _text(
                raw_dependency_id, "Work Coordination dependency id", 160
            )
            if dependency_id == task_id or dependency_id in local_dependencies:
                raise ValueError("Work Coordination task dependency is invalid or duplicated")
            dependency = task_by_id.get(dependency_id)
            if dependency is None or dependency.get("planId") != plan_id:
                raise ValueError("Work Coordination task dependency binding is invalid")
            local_dependencies.add(dependency_id)

    active_claim_tasks: set[str] = set()
    for claim in claim_by_id.values():
        plan_id = _text(claim.get("planId"), "Work Coordination claim plan id", 160)
        task_id = _text(claim.get("taskId"), "Work Coordination claim task id", 160)
        plan = plan_by_id.get(plan_id)
        task = task_by_id.get(task_id)
        if plan is None or task is None or task.get("planId") != plan_id:
            raise ValueError("Work Coordination claim binding is invalid")
        if task_id in active_claim_tasks:
            raise ValueError("Work Coordination task may retain only one active claim")
        if claim.get("planRevision") != plan.get("revision") or claim.get("taskRevision") != task.get("revision"):
            raise ValueError("Work Coordination claim revision binding is stale")
        if plan.get("state") != "active" or task.get("state") != "in-progress":
            raise ValueError("Work Coordination active claim state binding is invalid")
        active_claim_tasks.add(task_id)

    for item in checkpoints:
        plan_id = _text(item.get("planId"), "Work Coordination checkpoint plan id", 160)
        task_id = _text(item.get("taskId"), "Work Coordination checkpoint task id", 160)
        task = task_by_id.get(task_id)
        if task is None or task.get("planId") != plan_id or plan_id not in plan_by_id:
            raise ValueError("Work Coordination checkpoint binding is invalid")
        if item.get("taskRevision") > task.get("revision"):
            raise ValueError("Work Coordination checkpoint references future task revision")

    for item in evidence_by_id.values():
        plan_id = _text(item.get("planId"), "Work Coordination evidence plan id", 160)
        task_id = _text(item.get("taskId"), "Work Coordination evidence task id", 160)
        task = task_by_id.get(task_id)
        if task is None or task.get("planId") != plan_id or plan_id not in plan_by_id:
            raise ValueError("Work Coordination evidence binding is invalid")
        task_revision = _positive_revision(
            item.get("taskRevision"), "Work Coordination evidence task revision"
        )
        if task_revision > task.get("revision"):
            raise ValueError("Work Coordination evidence references future task revision")

    _assert_no_authority_smuggling(state)
    normalized = json.dumps(
        state,
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
    )
    if len(normalized.encode("utf-8")) > MAX_WORK_COORDINATION_PAYLOAD_BYTES:
        raise ValueError("Work Coordination normalized payload exceeds byte limit")
    return normalized


def _validate_record(
    value: object,
    owner_kind: str,
    owner_id: str | None,
    project_id: str | None,
) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "$schema", "revision", "ownerKind", "ownerId", "projectId", "payload"
    }:
        raise ValueError("Work Coordination Native record shape is invalid")
    if value.get("$schema") != RECORD_SCHEMA:
        raise ValueError("Work Coordination Native record schema is incompatible")
    revision = _positive_revision(value.get("revision"), "Work Coordination Native record revision")
    if (
        value.get("ownerKind") != owner_kind
        or value.get("ownerId") != owner_id
        or value.get("projectId") != project_id
    ):
        raise ValueError("Work Coordination Native record partition binding mismatch")
    payload = validate_work_coordination_payload(
        value.get("payload"), owner_kind, owner_id, project_id
    )
    return {
        "$schema": RECORD_SCHEMA,
        "revision": revision,
        "ownerKind": owner_kind,
        "ownerId": owner_id,
        "projectId": project_id,
        "payload": payload,
    }


def _record_validator(owner_kind: str, owner_id: str | None, project_id: str | None):
    return lambda value: _validate_record(value, owner_kind, owner_id, project_id)


def read_work_coordination_record(
    owner_kind: object,
    owner_id: object = None,
    project_id: object = None,
    root: str = DEFAULT_WORK_COORDINATION_STATE_ROOT,
) -> dict | None:
    owner_kind, owner_id, project_id = normalize_work_coordination_partition(
        owner_kind, owner_id, project_id
    )
    return read_partitioned_json_record(
        root,
        _partition_stem(owner_kind, owner_id, project_id),
        max_record_bytes=MAX_WORK_COORDINATION_RECORD_BYTES,
        validate_record=_record_validator(owner_kind, owner_id, project_id),
        label="Work Coordination Native",
    )


def compare_and_swap_work_coordination_payload(
    owner_kind: object,
    owner_id: object,
    project_id: object,
    expected_revision: object,
    payload: object,
    root: str = DEFAULT_WORK_COORDINATION_STATE_ROOT,
) -> dict | None:
    owner_kind, owner_id, project_id = normalize_work_coordination_partition(
        owner_kind, owner_id, project_id
    )
    if (
        isinstance(expected_revision, bool)
        or not isinstance(expected_revision, int)
        or expected_revision < 0
        or expected_revision >= MAX_SAFE_REVISION
    ):
        raise ValueError("Work Coordination expected revision is invalid")
    payload = validate_work_coordination_payload(payload, owner_kind, owner_id, project_id)
    record = {
        "$schema": RECORD_SCHEMA,
        "revision": expected_revision + 1,
        "ownerKind": owner_kind,
        "ownerId": owner_id,
        "projectId": project_id,
        "payload": payload,
    }
    return compare_and_swap_partitioned_json_record(
        root,
        _partition_stem(owner_kind, owner_id, project_id),
        expected_revision,
        record,
        max_record_bytes=MAX_WORK_COORDINATION_RECORD_BYTES,
        validate_record=_record_validator(owner_kind, owner_id, project_id),
        label="Work Coordination Native",
    )
