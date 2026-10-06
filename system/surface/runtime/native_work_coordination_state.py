#!/usr/bin/env python3
"""Private Native owner for Work Coordination owner/project CAS state.

This module owns the domain binding and persisted-state trust boundary.
Filesystem safety, locking and atomic revision CAS remain owned by
native_partitioned_json_state. The browser is not trusted to pre-validate the
coordination graph: host persistence re-checks partition, authority, bounds and
cross-record integrity before any record is committed.
"""

from __future__ import annotations

import hashlib
import json

from native_partitioned_json_state import (
    MAX_SAFE_REVISION,
    compare_and_swap_partitioned_json_record,
    read_partitioned_json_record,
)

RECORD_SCHEMA = "ordax.native-work-coordination-record/1"
STORE_STATE_SCHEMA = "ordax.work-coordination-store-state/1"
STORE_FORMAT_VERSION = 1
DEFAULT_WORK_COORDINATION_STATE_ROOT = "/var/lib/ordax/work-coordination"
MAX_WORK_COORDINATION_STATE_PAYLOAD_BYTES = 4 * 1024 * 1024
MAX_WORK_COORDINATION_RECORD_BYTES = 6 * MAX_WORK_COORDINATION_STATE_PAYLOAD_BYTES + 8192
MAX_PLANS = 32
MAX_TASKS = 512
MAX_CLAIMS = 128
MAX_CHECKPOINTS = 512
MAX_EVIDENCE = 1024
MAX_TASK_DEPENDENCIES = 64
MAX_TASK_EVIDENCE_REQUIREMENTS = 8

_OWNER_KINDS = frozenset(("device", "account"))
_PLAN_STATES = frozenset(("active", "paused", "completed", "archived"))
_TASK_STATES = frozenset((
    "planned", "ready", "blocked", "in-progress", "review", "completed", "cancelled",
))
_TERMINAL_TASK_STATES = frozenset(("completed", "cancelled"))
_CLOSED_PLAN_STATES = frozenset(("completed", "archived"))
_EVIDENCE_KINDS = frozenset((
    "pull-request", "commit", "ci-run", "artifact", "action-receipt", "document",
    "physical-proof", "manual-verification",
))
_STATE_KEYS = frozenset((
    "schema", "formatVersion", "ownerKind", "ownerId", "projectId",
    "plans", "tasks", "claims", "checkpoints", "evidence",
))
_FORBIDDEN_AUTHORITY_FIELDS = frozenset((
    "grantRef",
    "approvalId",
    "actionId",
    "toolId",
    "authoritySource",
    "effect",
    "decision",
    "executionAuthorized",
))


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


def _positive_int(value: object, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > MAX_SAFE_REVISION
    ):
        raise ValueError(f"{label} is invalid")
    return value


def _object(value: object, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} is invalid")
    return value


def _bounded_unique_text_array(
    value: object,
    label: str,
    maximum: int,
    max_chars: int = 160,
) -> list[str]:
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f"{label} is invalid or unbounded")
    normalized = [_text(item, label, max_chars) for item in value]
    if len(set(normalized)) != len(normalized):
        raise ValueError(f"{label} must be unique")
    return normalized


def normalize_partition(
    owner_kind: object,
    owner_id: object = None,
    project_id: object = None,
) -> tuple[str, str | None, str | None]:
    if owner_kind not in _OWNER_KINDS:
        raise ValueError("Work coordination owner kind is invalid")
    if owner_kind == "device":
        if owner_id is not None and owner_id != "":
            raise ValueError("Device Work coordination partition cannot carry account id")
        normalized_owner_id = None
    else:
        normalized_owner_id = _text(owner_id, "Work coordination owner id", 160)
    normalized_project_id = _optional_text(project_id, "Work coordination project id", 240)
    return owner_kind, normalized_owner_id, normalized_project_id


def _partition_stem(owner_kind: str, owner_id: str | None, project_id: str | None) -> str:
    identity = json.dumps(
        [owner_kind, owner_id, project_id],
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return f"partition-{hashlib.sha256(identity).hexdigest()}"


def _bounded_array(state: dict, key: str, maximum: int) -> list:
    value = state.get(key)
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f"Work coordination {key} is invalid or unbounded")
    return value


def _assert_authority_none(value: object) -> None:
    if isinstance(value, dict):
        if "authority" in value and value["authority"] != "none":
            raise ValueError("Work coordination persisted authority must remain none")
        for field in _FORBIDDEN_AUTHORITY_FIELDS:
            if field in value:
                raise ValueError(
                    f"Work coordination persisted authority field {field} is forbidden"
                )
        for child in value.values():
            _assert_authority_none(child)
    elif isinstance(value, list):
        for child in value:
            _assert_authority_none(child)


def _validate_graph(
    state: dict,
    owner_kind: str,
    owner_id: str | None,
    project_id: str | None,
) -> None:
    plans = _bounded_array(state, "plans", MAX_PLANS)
    tasks = _bounded_array(state, "tasks", MAX_TASKS)
    claims = _bounded_array(state, "claims", MAX_CLAIMS)
    checkpoints = _bounded_array(state, "checkpoints", MAX_CHECKPOINTS)
    evidence = _bounded_array(state, "evidence", MAX_EVIDENCE)

    plan_by_id: dict[str, dict] = {}
    plan_task_ids: dict[str, list[str]] = {}
    retained_task_ids: set[str] = set()
    for raw_plan in plans:
        plan = _object(raw_plan, "Work coordination plan")
        plan_id = _text(plan.get("id"), "Work coordination plan id", 160)
        if plan_id in plan_by_id:
            raise ValueError("Work coordination plan ids must be unique")
        if plan.get("state") not in _PLAN_STATES:
            raise ValueError("Work coordination plan state is invalid")
        _positive_int(plan.get("revision"), "Work coordination plan revision")
        if (
            plan.get("ownerKind") != owner_kind
            or plan.get("ownerId") != owner_id
            or plan.get("projectId") != project_id
        ):
            raise ValueError("Work coordination plan crosses persisted partition")
        task_ids = _bounded_unique_text_array(
            plan.get("taskIds"), "Work coordination plan task ids", MAX_TASKS,
        )
        plan_by_id[plan_id] = plan
        plan_task_ids[plan_id] = task_ids
        retained_task_ids.update(task_ids)

    task_by_id: dict[str, dict] = {}
    dependency_ids: dict[str, list[str]] = {}
    for raw_task in tasks:
        task = _object(raw_task, "Work coordination task")
        task_id = _text(task.get("id"), "Work coordination task id", 160)
        if task_id in task_by_id:
            raise ValueError("Work coordination task ids must be unique")
        plan_id = _text(task.get("planId"), "Work coordination task plan id", 160)
        if plan_id not in plan_by_id:
            raise ValueError("Work coordination task cannot reference a missing plan")
        if task_id not in retained_task_ids or task_id not in plan_task_ids[plan_id]:
            raise ValueError("Work coordination task must be retained by its own plan")
        if task.get("state") not in _TASK_STATES:
            raise ValueError("Work coordination task state is invalid")
        _positive_int(task.get("revision"), "Work coordination task revision")
        dependencies = _bounded_unique_text_array(
            task.get("dependsOnTaskIds"),
            "Work coordination task dependencies",
            MAX_TASK_DEPENDENCIES,
        )
        if task_id in dependencies:
            raise ValueError("Work coordination task cannot depend on itself")
        requirements = _bounded_unique_text_array(
            task.get("evidenceRequirements"),
            "Work coordination task evidence requirements",
            MAX_TASK_EVIDENCE_REQUIREMENTS,
            64,
        )
        if any(requirement not in _EVIDENCE_KINDS for requirement in requirements):
            raise ValueError("Work coordination task evidence requirement is invalid")
        task_by_id[task_id] = task
        dependency_ids[task_id] = dependencies

    for plan_id, task_ids in plan_task_ids.items():
        for task_id in task_ids:
            task = task_by_id.get(task_id)
            if task is None or task.get("planId") != plan_id:
                raise ValueError("Work coordination plan task ids cross plan boundaries")

    for task_id, dependencies in dependency_ids.items():
        plan_id = task_by_id[task_id].get("planId")
        for dependency_id in dependencies:
            dependency = task_by_id.get(dependency_id)
            if dependency is None:
                raise ValueError("Work coordination task dependency references missing task")
            if dependency.get("planId") != plan_id:
                raise ValueError("Work coordination task dependency cannot cross plans")

    marks: dict[str, int] = {}

    def visit(task_id: str) -> None:
        mark = marks.get(task_id, 0)
        if mark == 1:
            raise ValueError("Work coordination task dependency graph contains a cycle")
        if mark == 2:
            return
        marks[task_id] = 1
        for dependency_id in dependency_ids[task_id]:
            visit(dependency_id)
        marks[task_id] = 2

    for task_id in task_by_id:
        visit(task_id)

    claim_ids: set[str] = set()
    claimed_task_ids: set[str] = set()
    for raw_claim in claims:
        claim = _object(raw_claim, "Work coordination claim")
        claim_id = _text(claim.get("id"), "Work coordination claim id", 160)
        if claim_id in claim_ids:
            raise ValueError("Work coordination claim ids must be unique")
        claim_ids.add(claim_id)
        plan_id = _text(claim.get("planId"), "Work coordination claim plan id", 160)
        task_id = _text(claim.get("taskId"), "Work coordination claim task id", 160)
        plan = plan_by_id.get(plan_id)
        task = task_by_id.get(task_id)
        if plan is None or task is None or task.get("planId") != plan_id:
            raise ValueError("Work coordination claim cannot reference missing or foreign work")
        if task_id in claimed_task_ids:
            raise ValueError("Work coordination task cannot retain multiple active claims")
        claimed_task_ids.add(task_id)
        if _positive_int(claim.get("planRevision"), "Work coordination claim plan revision") != plan.get("revision"):
            raise ValueError("Work coordination claim plan revision is stale")
        if _positive_int(claim.get("taskRevision"), "Work coordination claim task revision") != task.get("revision"):
            raise ValueError("Work coordination claim task revision is stale")
        if plan.get("state") != "active" or task.get("state") != "in-progress":
            raise ValueError("Work coordination active claim requires active in-progress work")

    checkpoint_keys: set[tuple[str, int, int]] = set()
    previous_checkpoint: dict[str, tuple[int, int]] = {}
    for raw_checkpoint in checkpoints:
        checkpoint = _object(raw_checkpoint, "Work coordination checkpoint")
        plan_id = _text(checkpoint.get("planId"), "Work coordination checkpoint plan id", 160)
        task_id = _text(checkpoint.get("taskId"), "Work coordination checkpoint task id", 160)
        task = task_by_id.get(task_id)
        if task is None or task.get("planId") != plan_id:
            raise ValueError("Work coordination checkpoint cannot reference missing or foreign work")
        task_revision = _positive_int(
            checkpoint.get("taskRevision"), "Work coordination checkpoint task revision",
        )
        if task_revision > task.get("revision"):
            raise ValueError("Work coordination checkpoint cannot reference a future task revision")
        sequence = _positive_int(checkpoint.get("sequence"), "Work coordination checkpoint sequence")
        key = (task_id, task_revision, sequence)
        if key in checkpoint_keys:
            raise ValueError("Work coordination checkpoint identity must be unique")
        checkpoint_keys.add(key)
        previous = previous_checkpoint.get(task_id)
        if previous is not None:
            previous_revision, previous_sequence = previous
            if task_revision < previous_revision:
                raise ValueError("Work coordination checkpoint task revision must not regress")
            if task_revision == previous_revision and sequence <= previous_sequence:
                raise ValueError("Work coordination checkpoint sequence must increase")
        previous_checkpoint[task_id] = (task_revision, sequence)

    evidence_ids: set[str] = set()
    evidence_by_task: dict[str, list[dict]] = {}
    for raw_evidence in evidence:
        item = _object(raw_evidence, "Work coordination evidence")
        evidence_id = _text(item.get("id"), "Work coordination evidence id", 160)
        if evidence_id in evidence_ids:
            raise ValueError("Work coordination evidence ids must be unique")
        evidence_ids.add(evidence_id)
        plan_id = _text(item.get("planId"), "Work coordination evidence plan id", 160)
        task_id = _text(item.get("taskId"), "Work coordination evidence task id", 160)
        task = task_by_id.get(task_id)
        if task is None or task.get("planId") != plan_id:
            raise ValueError("Work coordination evidence cannot reference missing or foreign work")
        task_revision = _positive_int(
            item.get("taskRevision"), "Work coordination evidence task revision",
        )
        if task_revision > task.get("revision"):
            raise ValueError("Work coordination evidence cannot reference a future task revision")
        if item.get("kind") not in _EVIDENCE_KINDS:
            raise ValueError("Work coordination evidence kind is invalid")
        if item.get("verification") not in ("unverified", "verified", "rejected"):
            raise ValueError("Work coordination evidence verification state is invalid")
        evidence_by_task.setdefault(task_id, []).append(item)

    for task_id, task in task_by_id.items():
        if task.get("state") != "completed":
            continue
        for requirement in task.get("evidenceRequirements"):
            if not any(
                item.get("taskRevision") == task.get("revision")
                and item.get("kind") == requirement
                and item.get("verification") == "verified"
                for item in evidence_by_task.get(task_id, [])
            ):
                raise ValueError("Completed Work coordination task is missing required verified evidence")

    for plan_id, plan in plan_by_id.items():
        if plan.get("state") not in _CLOSED_PLAN_STATES:
            continue
        if any(
            task_by_id[task_id].get("state") not in _TERMINAL_TASK_STATES
            for task_id in plan_task_ids[plan_id]
        ):
            raise ValueError("Closed Work coordination plan requires terminal tasks")


def validate_work_coordination_payload(
    payload: object,
    owner_kind: object,
    owner_id: object = None,
    project_id: object = None,
) -> str:
    owner_kind, owner_id, project_id = normalize_partition(owner_kind, owner_id, project_id)
    if not isinstance(payload, str):
        raise ValueError("Work coordination payload must be UTF-8 JSON text")
    encoded = payload.encode("utf-8")
    if len(encoded) > MAX_WORK_COORDINATION_STATE_PAYLOAD_BYTES:
        raise ValueError("Work coordination payload exceeds byte limit")
    try:
        state = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError("Work coordination payload is invalid JSON") from exc
    if not isinstance(state, dict) or set(state) != _STATE_KEYS:
        raise ValueError("Work coordination payload shape is invalid")
    if state.get("schema") != STORE_STATE_SCHEMA:
        raise ValueError("Work coordination payload schema is incompatible")
    if state.get("formatVersion") != STORE_FORMAT_VERSION:
        raise ValueError("Work coordination payload format version is incompatible")
    if (
        state.get("ownerKind") != owner_kind
        or state.get("ownerId") != owner_id
        or state.get("projectId") != project_id
    ):
        raise ValueError("Work coordination payload partition binding mismatch")

    _assert_authority_none(state)
    _validate_graph(state, owner_kind, owner_id, project_id)

    normalized = json.dumps(
        state,
        separators=(",", ":"),
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
    )
    if len(normalized.encode("utf-8")) > MAX_WORK_COORDINATION_STATE_PAYLOAD_BYTES:
        raise ValueError("Work coordination normalized payload exceeds byte limit")
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
        raise ValueError("Work coordination Native record shape is invalid")
    if value.get("$schema") != RECORD_SCHEMA:
        raise ValueError("Work coordination Native record schema is incompatible")
    revision = value.get("revision")
    if (
        isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 1
        or revision > MAX_SAFE_REVISION
    ):
        raise ValueError("Work coordination Native record revision is invalid")
    if (
        value.get("ownerKind") != owner_kind
        or value.get("ownerId") != owner_id
        or value.get("projectId") != project_id
    ):
        raise ValueError("Work coordination Native record partition binding mismatch")
    payload = validate_work_coordination_payload(
        value.get("payload"), owner_kind, owner_id, project_id,
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
    owner_kind, owner_id, project_id = normalize_partition(owner_kind, owner_id, project_id)
    return read_partitioned_json_record(
        root,
        _partition_stem(owner_kind, owner_id, project_id),
        max_record_bytes=MAX_WORK_COORDINATION_RECORD_BYTES,
        validate_record=_record_validator(owner_kind, owner_id, project_id),
        label="Work coordination Native",
    )


def compare_and_swap_work_coordination_payload(
    owner_kind: object,
    owner_id: object,
    project_id: object,
    expected_revision: object,
    payload: object,
    root: str = DEFAULT_WORK_COORDINATION_STATE_ROOT,
) -> dict | None:
    owner_kind, owner_id, project_id = normalize_partition(owner_kind, owner_id, project_id)
    if (
        isinstance(expected_revision, bool)
        or not isinstance(expected_revision, int)
        or expected_revision < 0
        or expected_revision >= MAX_SAFE_REVISION
    ):
        raise ValueError("Work coordination expected revision is invalid")
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
        label="Work coordination Native",
    )
