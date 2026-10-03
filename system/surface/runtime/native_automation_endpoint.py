#!/usr/bin/env python3
"""Typed request boundary for Native background/scheduler durable metadata."""

from __future__ import annotations

import json

from native_automation_state import (
    DEFAULT_AUTOMATION_STATE_FILE,
    ack_schedule_occurrence,
    commit_schedule_occurrence,
    compare_and_swap_background_run,
    compare_and_swap_schedule,
    create_background_run,
    create_schedule,
    read_automation_state,
)

MAX_AUTOMATION_REQUEST_BODY_BYTES = 512 * 1024


class AutomationEndpointRequestError(ValueError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _parse_body(body: object) -> dict:
    if not isinstance(body, (bytes, bytearray)):
        raise AutomationEndpointRequestError("automation request body must be bytes")
    if not body:
        raise AutomationEndpointRequestError("automation request body is empty")
    if len(body) > MAX_AUTOMATION_REQUEST_BODY_BYTES:
        raise AutomationEndpointRequestError("automation request body exceeds byte limit", status_code=413)
    try:
        value = json.loads(bytes(body).decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AutomationEndpointRequestError("automation request body is invalid JSON") from exc
    if not isinstance(value, dict):
        raise AutomationEndpointRequestError("automation request body must be an object")
    return value


def _revision(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 9007199254740991:
        raise AutomationEndpointRequestError("automation expected revision is invalid")
    return value


def read_automation_endpoint(path: str = DEFAULT_AUTOMATION_STATE_FILE) -> dict:
    return read_automation_state(path)


def mutate_automation_endpoint(body: bytes, path: str = DEFAULT_AUTOMATION_STATE_FILE) -> dict:
    request = _parse_body(body)
    action = request.get("action")
    try:
        if action == "background-create" and set(request) == {"action", "run"}:
            accepted = create_background_run(request["run"], path)
        elif action == "background-cas" and set(request) == {"action", "runId", "expectedRevision", "run"}:
            accepted = compare_and_swap_background_run(
                request["runId"], _revision(request["expectedRevision"]), request["run"], path,
            )
        elif action == "schedule-create" and set(request) == {"action", "schedule"}:
            accepted = create_schedule(request["schedule"], path)
        elif action == "schedule-cas" and set(request) == {"action", "scheduleId", "expectedRevision", "schedule"}:
            accepted = compare_and_swap_schedule(
                request["scheduleId"], _revision(request["expectedRevision"]), request["schedule"], path,
            )
        elif action == "schedule-commit-occurrence" and set(request) == {"action", "scheduleId", "expectedRevision", "schedule", "occurrence"}:
            accepted = commit_schedule_occurrence(
                request["scheduleId"], _revision(request["expectedRevision"]), request["schedule"], request["occurrence"], path,
            )
        elif action == "occurrence-ack" and set(request) == {"action", "occurrenceId"}:
            accepted = ack_schedule_occurrence(request["occurrenceId"], path)
        else:
            raise AutomationEndpointRequestError("automation action or request shape is invalid")
    except AutomationEndpointRequestError:
        raise
    except (TypeError, ValueError) as exc:
        raise AutomationEndpointRequestError(str(exc)) from exc
    if accepted is not True:
        raise AutomationEndpointRequestError("automation state revision or identity conflict", status_code=409)
    return {"ok": True}
