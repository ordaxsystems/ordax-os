#!/usr/bin/env python3
"""Private Unix-socket transport for the Native Intelligence host bridge."""

from __future__ import annotations

import json
import os
import socket
import stat

DEFAULT_SOCKET_PATH = "/run/ordax-surface/intelligence.sock"
MAX_MESSAGE_BYTES = 1024 * 1024
REQUEST_SCHEMA = "ordax.native-intelligence-ipc-request/1"
RESPONSE_SCHEMA = "ordax.native-intelligence-ipc-response/1"


def _encode(value: dict) -> bytes:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")
    if not payload or len(payload) > MAX_MESSAGE_BYTES:
        raise ValueError("Native Intelligence IPC payload size is invalid")
    return payload + b"\n"


def _recv_line(connection: socket.socket) -> bytes:
    chunks = bytearray()
    while True:
        part = connection.recv(min(4096, MAX_MESSAGE_BYTES + 1 - len(chunks)))
        if not part:
            raise ConnectionError(
                "Native Intelligence IPC peer closed before a complete message"
            )
        chunks.extend(part)
        if len(chunks) > MAX_MESSAGE_BYTES:
            raise ValueError("Native Intelligence IPC payload exceeds bounded size")
        newline = chunks.find(b"\n")
        if newline >= 0:
            if newline != len(chunks) - 1:
                raise ValueError("Native Intelligence IPC allows exactly one message")
            return bytes(chunks[:newline])


def _decode(raw: bytes) -> dict:
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Native Intelligence IPC message is invalid JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("Native Intelligence IPC message must be an object")
    return value


def _request_id(value: object) -> str:
    if not isinstance(value, str) or "\0" in value:
        raise ValueError("Native Intelligence IPC request id is invalid")
    normalized = value.strip()
    if not normalized or len(normalized) > 160:
        raise ValueError("Native Intelligence IPC request id is invalid")
    return normalized


def validate_request(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {"schema", "request"}:
        raise ValueError("Native Intelligence IPC request fields are invalid")
    if value.get("schema") != REQUEST_SCHEMA:
        raise ValueError("Native Intelligence IPC request schema is invalid")
    request = value.get("request")
    if not isinstance(request, dict):
        raise ValueError("Native Intelligence IPC service request is invalid")
    _request_id(request.get("requestId"))
    return value


def validate_response(value: object, *, expected_request_id: str) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "schema", "requestId", "outcome", "response", "error"
    }:
        raise ValueError("Native Intelligence IPC response fields are invalid")
    if value.get("schema") != RESPONSE_SCHEMA:
        raise ValueError("Native Intelligence IPC response schema is invalid")
    if value.get("requestId") != expected_request_id:
        raise PermissionError("Native Intelligence IPC response request id does not match")
    outcome = value.get("outcome")
    if outcome == "completed":
        if not isinstance(value.get("response"), dict) or value.get("error") is not None:
            raise ValueError("Native Intelligence IPC completed response is invalid")
    elif outcome == "unknown":
        if value.get("response") is not None or value.get("error") != "unavailable":
            raise ValueError("Native Intelligence IPC unknown response is invalid")
    else:
        raise ValueError("Native Intelligence IPC outcome is invalid")
    return value


def completed_response(request_id: str, response: dict) -> dict:
    request_id = _request_id(request_id)
    if not isinstance(response, dict) or response.get("requestId") != request_id:
        raise ValueError("Native Intelligence host response is not correlated")
    return {
        "schema": RESPONSE_SCHEMA,
        "requestId": request_id,
        "outcome": "completed",
        "response": response,
        "error": None,
    }


def unknown_response(request_id: str) -> dict:
    return {
        "schema": RESPONSE_SCHEMA,
        "requestId": _request_id(request_id),
        "outcome": "unknown",
        "response": None,
        "error": "unavailable",
    }


def request_native_intelligence(
    request: dict,
    *,
    socket_path: str = DEFAULT_SOCKET_PATH,
    timeout_seconds: float = 120.0,
) -> dict:
    request = validate_request(request)
    if (
        not isinstance(timeout_seconds, (int, float))
        or isinstance(timeout_seconds, bool)
        or timeout_seconds <= 0
        or timeout_seconds > 180
    ):
        raise ValueError("Native Intelligence IPC timeout is invalid")
    request_id = _request_id(request["request"].get("requestId"))
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(float(timeout_seconds))
        client.connect(socket_path)
        client.sendall(_encode(request))
        return validate_response(
            _decode(_recv_line(client)),
            expected_request_id=request_id,
        )


class NativeIntelligenceIpcServer:
    def __init__(self, *, socket_path: str = DEFAULT_SOCKET_PATH):
        self.socket_path = socket_path
        self._socket: socket.socket | None = None

    def open(self) -> socket.socket:
        parent = os.path.dirname(self.socket_path)
        os.makedirs(parent, mode=0o700, exist_ok=True)
        try:
            current = os.lstat(self.socket_path)
        except FileNotFoundError:
            current = None
        if current is not None:
            if not stat.S_ISSOCK(current.st_mode):
                raise RuntimeError(
                    "Native Intelligence IPC path exists and is not a socket"
                )
            os.unlink(self.socket_path)
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            server.bind(self.socket_path)
            os.chmod(self.socket_path, 0o600)
            server.listen(1)
        except Exception:
            server.close()
            try:
                os.unlink(self.socket_path)
            except FileNotFoundError:
                pass
            raise
        self._socket = server
        return server

    def receive_request(self, connection: socket.socket) -> dict:
        return validate_request(_decode(_recv_line(connection)))

    def send_response(
        self,
        connection: socket.socket,
        response: dict,
        *,
        expected_request_id: str,
    ) -> None:
        validate_response(response, expected_request_id=expected_request_id)
        connection.sendall(_encode(response))

    def close(self) -> None:
        if self._socket is not None:
            self._socket.close()
            self._socket = None
        try:
            os.unlink(self.socket_path)
        except FileNotFoundError:
            pass
