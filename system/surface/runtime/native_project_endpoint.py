#!/usr/bin/env python3
"""Typed request boundary for durable Native Project catalog state.

This module deliberately does not register an HTTP route. The Native host may
mount it only after the Project runtime cutover/migration plan is proven.
"""

from __future__ import annotations

import json

from native_project_state import (
    DEFAULT_PROJECT_STATE_ROOT,
    MAX_PROJECT_RECORD_BYTES,
    compare_and_swap_project_state,
    read_project_record,
)

MAX_PROJECT_REQUEST_BODY_BYTES = MAX_PROJECT_RECORD_BYTES + 8192


class ProjectEndpointRequestError(ValueError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _parse_body(body: object) -> dict:
    if not isinstance(body, (bytes, bytearray)):
        raise ProjectEndpointRequestError("Project request body must be bytes")
    if not body:
        raise ProjectEndpointRequestError("Project request body is empty")
    if len(body) > MAX_PROJECT_REQUEST_BODY_BYTES:
        raise ProjectEndpointRequestError(
            "Project request body exceeds byte limit",
            status_code=413,
        )
    try:
        value = json.loads(bytes(body).decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ProjectEndpointRequestError("Project request body is invalid JSON") from exc
    if not isinstance(value, dict):
        raise ProjectEndpointRequestError("Project request body must be an object")
    return value


def _expected_revision(value: object) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > 9007199254740990
    ):
        raise ProjectEndpointRequestError("Project expected revision is invalid")
    return value


def read_project_endpoint(root: str = DEFAULT_PROJECT_STATE_ROOT) -> dict:
    try:
        record = read_project_record(root)
    except (TypeError, ValueError) as exc:
        raise ProjectEndpointRequestError(str(exc)) from exc
    return {"record": record}


def mutate_project_endpoint(
    body: bytes,
    root: str = DEFAULT_PROJECT_STATE_ROOT,
) -> dict:
    request = _parse_body(body)
    if set(request) != {"action", "expectedRevision", "state"}:
        raise ProjectEndpointRequestError("Project request shape is invalid")
    if request.get("action") != "compare-and-swap":
        raise ProjectEndpointRequestError("Project mutation action is invalid")

    try:
        record = compare_and_swap_project_state(
            _expected_revision(request.get("expectedRevision")),
            request.get("state"),
            root,
        )
    except ProjectEndpointRequestError:
        raise
    except (TypeError, ValueError) as exc:
        raise ProjectEndpointRequestError(str(exc)) from exc
    if record is None:
        raise ProjectEndpointRequestError(
            "Project state revision conflict",
            status_code=409,
        )
    return {"ok": True, "revision": record["revision"]}
