#!/usr/bin/env python3
"""Typed request boundary for durable Native Work Coordination state.

The HTTP/router layer must supply the authoritative owner and selected Project.
Request fields are assertions only and never create owner/project authority.
"""

from __future__ import annotations

import json

from native_work_coordination_state import (
    DEFAULT_WORK_COORDINATION_STATE_ROOT,
    MAX_WORK_COORDINATION_STATE_PAYLOAD_BYTES,
    compare_and_swap_work_coordination_payload,
    normalize_partition,
    read_work_coordination_record,
)

MAX_WORK_COORDINATION_REQUEST_BODY_BYTES = 6 * MAX_WORK_COORDINATION_STATE_PAYLOAD_BYTES + 8192


class WorkCoordinationEndpointRequestError(ValueError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _parse_body(body: object) -> dict:
    if not isinstance(body, (bytes, bytearray)):
        raise WorkCoordinationEndpointRequestError("Work coordination request body must be bytes")
    if not body:
        raise WorkCoordinationEndpointRequestError("Work coordination request body is empty")
    if len(body) > MAX_WORK_COORDINATION_REQUEST_BODY_BYTES:
        raise WorkCoordinationEndpointRequestError(
            "Work coordination request body exceeds byte limit",
            status_code=413,
        )
    try:
        value = json.loads(bytes(body).decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise WorkCoordinationEndpointRequestError(
            "Work coordination request body is invalid JSON"
        ) from exc
    if not isinstance(value, dict):
        raise WorkCoordinationEndpointRequestError("Work coordination request body must be an object")
    return value


def _revision(value: object) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > 9007199254740990
    ):
        raise WorkCoordinationEndpointRequestError(
            "Work coordination expected revision is invalid"
        )
    return value


def _authoritative_partition(
    owner_kind: object,
    owner_id: object = None,
    project_id: object = None,
) -> tuple[str, str | None, str]:
    try:
        partition = normalize_partition(owner_kind, owner_id, project_id)
    except (TypeError, ValueError) as exc:
        raise WorkCoordinationEndpointRequestError(
            "Work coordination authoritative partition is invalid",
            status_code=403,
        ) from exc
    if partition[2] is None:
        raise WorkCoordinationEndpointRequestError(
            "Work coordination authoritative Project context is required",
            status_code=403,
        )
    return partition


def _require_requested_partition_matches_authority(
    request: dict,
    authoritative_owner_kind: str,
    authoritative_owner_id: str | None,
    authoritative_project_id: str,
) -> None:
    try:
        requested = normalize_partition(
            request.get("ownerKind"),
            request.get("ownerId"),
            request.get("projectId"),
        )
    except (TypeError, ValueError) as exc:
        raise WorkCoordinationEndpointRequestError(str(exc)) from exc
    authoritative = (
        authoritative_owner_kind,
        authoritative_owner_id,
        authoritative_project_id,
    )
    if requested != authoritative:
        raise WorkCoordinationEndpointRequestError(
            "Work coordination requested partition does not match authoritative context",
            status_code=403,
        )


def read_work_coordination_endpoint(
    authoritative_owner_kind: object,
    authoritative_owner_id: object = None,
    authoritative_project_id: object = None,
    root: str = DEFAULT_WORK_COORDINATION_STATE_ROOT,
) -> dict:
    owner_kind, owner_id, project_id = _authoritative_partition(
        authoritative_owner_kind,
        authoritative_owner_id,
        authoritative_project_id,
    )
    try:
        record = read_work_coordination_record(owner_kind, owner_id, project_id, root)
    except (TypeError, ValueError) as exc:
        raise WorkCoordinationEndpointRequestError(str(exc)) from exc
    return {"record": record}


def mutate_work_coordination_endpoint(
    body: bytes,
    authoritative_owner_kind: object,
    authoritative_owner_id: object = None,
    authoritative_project_id: object = None,
    root: str = DEFAULT_WORK_COORDINATION_STATE_ROOT,
) -> dict:
    request = _parse_body(body)
    expected_keys = {
        "action",
        "ownerKind",
        "ownerId",
        "projectId",
        "expectedRevision",
        "payload",
    }
    if set(request) != expected_keys:
        raise WorkCoordinationEndpointRequestError(
            "Work coordination request shape is invalid"
        )
    if request.get("action") != "compare-and-swap":
        raise WorkCoordinationEndpointRequestError(
            "Work coordination mutation action is invalid"
        )

    owner_kind, owner_id, project_id = _authoritative_partition(
        authoritative_owner_kind,
        authoritative_owner_id,
        authoritative_project_id,
    )
    _require_requested_partition_matches_authority(
        request,
        owner_kind,
        owner_id,
        project_id,
    )

    try:
        record = compare_and_swap_work_coordination_payload(
            owner_kind,
            owner_id,
            project_id,
            _revision(request.get("expectedRevision")),
            request.get("payload"),
            root,
        )
    except WorkCoordinationEndpointRequestError:
        raise
    except (TypeError, ValueError) as exc:
        raise WorkCoordinationEndpointRequestError(str(exc)) from exc
    if record is None:
        raise WorkCoordinationEndpointRequestError(
            "Work coordination state revision conflict",
            status_code=409,
        )
    return {"ok": True, "revision": record["revision"]}
