#!/usr/bin/env python3
"""Typed request boundary for durable Native Personal OrdaX state."""

from __future__ import annotations

import json

from native_personal_ordax_state import (
    DEFAULT_PERSONAL_ORDAX_STATE_ROOT,
    MAX_PERSONAL_STATE_PAYLOAD_BYTES,
    compare_and_swap_personal_ordax_payload,
    normalize_owner,
    read_personal_ordax_record,
)

MAX_PERSONAL_ORDAX_REQUEST_BODY_BYTES = 6 * MAX_PERSONAL_STATE_PAYLOAD_BYTES + 8192


class PersonalOrdaxEndpointRequestError(ValueError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _parse_body(body: object) -> dict:
    if not isinstance(body, (bytes, bytearray)):
        raise PersonalOrdaxEndpointRequestError("Personal OrdaX request body must be bytes")
    if not body:
        raise PersonalOrdaxEndpointRequestError("Personal OrdaX request body is empty")
    if len(body) > MAX_PERSONAL_ORDAX_REQUEST_BODY_BYTES:
        raise PersonalOrdaxEndpointRequestError(
            "Personal OrdaX request body exceeds byte limit",
            status_code=413,
        )
    try:
        value = json.loads(bytes(body).decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise PersonalOrdaxEndpointRequestError("Personal OrdaX request body is invalid JSON") from exc
    if not isinstance(value, dict):
        raise PersonalOrdaxEndpointRequestError("Personal OrdaX request body must be an object")
    return value


def _revision(value: object) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 0
        or value > 9007199254740990
    ):
        raise PersonalOrdaxEndpointRequestError("Personal OrdaX expected revision is invalid")
    return value


def _authoritative_owner(owner_kind: object, owner_id: object = None) -> tuple[str, str | None]:
    try:
        return normalize_owner(owner_kind, owner_id)
    except (TypeError, ValueError) as exc:
        raise PersonalOrdaxEndpointRequestError(
            "Personal OrdaX authoritative owner is invalid",
            status_code=403,
        ) from exc


def _require_requested_owner_matches_authority(
    request: dict,
    authoritative_owner_kind: str,
    authoritative_owner_id: str | None,
) -> None:
    try:
        requested_owner_kind, requested_owner_id = normalize_owner(
            request.get("ownerKind"),
            request.get("ownerId"),
        )
    except (TypeError, ValueError) as exc:
        raise PersonalOrdaxEndpointRequestError(str(exc)) from exc
    if (
        requested_owner_kind != authoritative_owner_kind
        or requested_owner_id != authoritative_owner_id
    ):
        raise PersonalOrdaxEndpointRequestError(
            "Personal OrdaX requested owner does not match authoritative owner",
            status_code=403,
        )


def read_personal_ordax_endpoint(
    authoritative_owner_kind: object,
    authoritative_owner_id: object = None,
    root: str = DEFAULT_PERSONAL_ORDAX_STATE_ROOT,
) -> dict:
    owner_kind, owner_id = _authoritative_owner(
        authoritative_owner_kind,
        authoritative_owner_id,
    )
    try:
        record = read_personal_ordax_record(owner_kind, owner_id, root)
    except (TypeError, ValueError) as exc:
        raise PersonalOrdaxEndpointRequestError(str(exc)) from exc
    return {"record": record}


def mutate_personal_ordax_endpoint(
    body: bytes,
    authoritative_owner_kind: object,
    authoritative_owner_id: object = None,
    root: str = DEFAULT_PERSONAL_ORDAX_STATE_ROOT,
) -> dict:
    request = _parse_body(body)
    if set(request) != {"action", "ownerKind", "ownerId", "expectedRevision", "payload"}:
        raise PersonalOrdaxEndpointRequestError("Personal OrdaX request shape is invalid")
    if request.get("action") != "compare-and-swap":
        raise PersonalOrdaxEndpointRequestError("Personal OrdaX mutation action is invalid")

    owner_kind, owner_id = _authoritative_owner(
        authoritative_owner_kind,
        authoritative_owner_id,
    )
    _require_requested_owner_matches_authority(request, owner_kind, owner_id)

    try:
        record = compare_and_swap_personal_ordax_payload(
            owner_kind,
            owner_id,
            _revision(request.get("expectedRevision")),
            request.get("payload"),
            root,
        )
    except PersonalOrdaxEndpointRequestError:
        raise
    except (TypeError, ValueError) as exc:
        raise PersonalOrdaxEndpointRequestError(str(exc)) from exc
    if record is None:
        raise PersonalOrdaxEndpointRequestError(
            "Personal OrdaX state revision conflict",
            status_code=409,
        )
    return {"ok": True, "revision": record["revision"]}
