#!/usr/bin/env python3
"""Typed request boundary for sandboxed Native App Data.

Identity is supplied by the trusted host binding, never by the request body.
"""

from __future__ import annotations

import base64
import binascii
import json

from native_app_data import (
    AppDataConflictError,
    DEFAULT_APP_DATA_MAX_KEYS,
    DEFAULT_APP_DATA_QUOTA_BYTES,
    DEFAULT_APP_DATA_ROOT,
    delete_app_data,
    list_app_data,
    put_app_data,
    read_app_data,
)

MAX_APP_DATA_REQUEST_BODY_BYTES = 2 * 1024 * 1024


class AppDataEndpointRequestError(ValueError):
    def __init__(self, message: str, *, status_code: int = 400, actual_revision: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.actual_revision = actual_revision


def _parse_body(body: object) -> dict:
    if not isinstance(body, (bytes, bytearray)):
        raise AppDataEndpointRequestError("App Data request body must be bytes")
    if not body:
        raise AppDataEndpointRequestError("App Data request body is empty")
    if len(body) > MAX_APP_DATA_REQUEST_BODY_BYTES:
        raise AppDataEndpointRequestError("App Data request body exceeds byte limit", status_code=413)
    try:
        value = json.loads(bytes(body).decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise AppDataEndpointRequestError("App Data request body is invalid JSON") from exc
    if not isinstance(value, dict):
        raise AppDataEndpointRequestError("App Data request body must be an object")
    forbidden = {"appId", "publisherId", "ownerScope", "identity"}.intersection(value)
    if forbidden:
        raise AppDataEndpointRequestError("App Data request may not self-assert identity")
    return value


def _expected_revision(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 9007199254740991:
        raise AppDataEndpointRequestError("App Data expected revision is invalid")
    return value


def _decode_value(value: object) -> bytes:
    if not isinstance(value, str):
        raise AppDataEndpointRequestError("App Data valueBase64 is invalid")
    try:
        decoded = base64.b64decode(value.encode("ascii"), validate=True)
    except (UnicodeError, binascii.Error) as exc:
        raise AppDataEndpointRequestError("App Data valueBase64 is invalid") from exc
    if base64.b64encode(decoded).decode("ascii") != value:
        raise AppDataEndpointRequestError("App Data valueBase64 is not canonical")
    return decoded


def handle_app_data_request(
    body: bytes,
    *,
    identity: dict,
    root: str = DEFAULT_APP_DATA_ROOT,
    quota_bytes: int = DEFAULT_APP_DATA_QUOTA_BYTES,
    max_keys: int = DEFAULT_APP_DATA_MAX_KEYS,
) -> dict:
    request = _parse_body(body)
    action = request.get("action")
    try:
        if action == "get" and set(request) == {"action", "key"}:
            result = read_app_data(identity, request["key"], root)
            return {
                "revision": result["revision"],
                "found": result["found"],
                "key": result["key"],
                "valueBase64": None if result["value"] is None else base64.b64encode(result["value"]).decode("ascii"),
            }
        if action == "list" and set(request) == {"action"}:
            return list_app_data(identity, root, quota_bytes=quota_bytes, max_keys=max_keys)
        if action == "put" and set(request) == {"action", "key", "valueBase64", "expectedRevision"}:
            return put_app_data(
                identity,
                request["key"],
                _decode_value(request["valueBase64"]),
                _expected_revision(request["expectedRevision"]),
                root,
                quota_bytes=quota_bytes,
                max_keys=max_keys,
            )
        if action == "delete" and set(request) == {"action", "key", "expectedRevision"}:
            return delete_app_data(
                identity,
                request["key"],
                _expected_revision(request["expectedRevision"]),
                root,
                quota_bytes=quota_bytes,
                max_keys=max_keys,
            )
        raise AppDataEndpointRequestError("App Data action or request shape is invalid")
    except AppDataEndpointRequestError:
        raise
    except AppDataConflictError as exc:
        raise AppDataEndpointRequestError(
            str(exc), status_code=409, actual_revision=exc.actual_revision,
        ) from exc
    except (TypeError, ValueError) as exc:
        raise AppDataEndpointRequestError(str(exc)) from exc
