#!/usr/bin/env python3
"""Private Unix-socket transport for Native Profile consent presentation."""

from __future__ import annotations

import json
import os
import socket
import stat

DEFAULT_SOCKET_PATH = "/run/ordax-surface/profile-consent.sock"
MAX_MESSAGE_BYTES = 64 * 1024
REQUEST_SCHEMA = "ordax.profile-human-consent-request/1"
DECISION_SCHEMA = "ordax.profile-human-consent-decision/1"


def _encode(value: dict) -> bytes:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")
    if not payload or len(payload) > MAX_MESSAGE_BYTES:
        raise ValueError("Profile consent IPC payload size is invalid")
    return payload + b"\n"


def _recv_line(connection: socket.socket) -> bytes:
    chunks = bytearray()
    while True:
        part = connection.recv(min(4096, MAX_MESSAGE_BYTES + 1 - len(chunks)))
        if not part:
            raise ConnectionError("Profile consent IPC peer closed before a complete message")
        chunks.extend(part)
        if len(chunks) > MAX_MESSAGE_BYTES:
            raise ValueError("Profile consent IPC payload exceeds bounded size")
        newline = chunks.find(b"\n")
        if newline >= 0:
            if newline != len(chunks) - 1:
                raise ValueError("Profile consent IPC allows exactly one message")
            return bytes(chunks[:newline])


def _decode(raw: bytes) -> dict:
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Profile consent IPC message is invalid JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("Profile consent IPC message must be an object")
    return value


def validate_request(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "schema", "requestId", "permissionDiff", "permissionDiffSha256",
        "expectedRevision", "spaceId", "spaceKind", "profile", "issuedAt", "expiresAt",
    }:
        raise ValueError("Profile consent IPC request fields are invalid")
    if value.get("schema") != REQUEST_SCHEMA:
        raise ValueError("Profile consent IPC request schema is invalid")
    if not isinstance(value.get("requestId"), str) or len(value["requestId"]) != 32:
        raise ValueError("Profile consent IPC request id is invalid")
    if not isinstance(value.get("permissionDiff"), dict):
        raise ValueError("Profile consent IPC permission diff is invalid")
    digest = value.get("permissionDiffSha256")
    if (
        not isinstance(digest, str)
        or len(digest) != 64
        or any(ch not in "0123456789abcdef" for ch in digest)
    ):
        raise ValueError("Profile consent IPC permission diff hash is invalid")
    return value


def validate_decision(value: object, *, expected_request_id: str) -> dict:
    if not isinstance(value, dict) or set(value) != {"schema", "requestId", "approved"}:
        raise ValueError("Profile consent IPC decision fields are invalid")
    if value.get("schema") != DECISION_SCHEMA:
        raise ValueError("Profile consent IPC decision schema is invalid")
    if value.get("requestId") != expected_request_id:
        raise PermissionError("Profile consent IPC decision request id does not match")
    if not isinstance(value.get("approved"), bool):
        raise ValueError("Profile consent IPC decision approval is invalid")
    return value


def request_native_decision(
    request: dict,
    *,
    socket_path: str = DEFAULT_SOCKET_PATH,
    timeout_seconds: float = 30.0,
) -> dict:
    request = validate_request(request)
    if not isinstance(timeout_seconds, (int, float)) or timeout_seconds <= 0 or timeout_seconds > 120:
        raise ValueError("Profile consent IPC timeout is invalid")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(float(timeout_seconds))
        client.connect(socket_path)
        client.sendall(_encode(request))
        return validate_decision(
            _decode(_recv_line(client)),
            expected_request_id=request["requestId"],
        )


class ProfileConsentIpcServer:
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
                raise RuntimeError("Profile consent IPC path exists and is not a socket")
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

    def send_decision(
        self,
        connection: socket.socket,
        decision: dict,
        *,
        expected_request_id: str,
    ) -> None:
        validate_decision(decision, expected_request_id=expected_request_id)
        connection.sendall(_encode(decision))

    def close(self) -> None:
        if self._socket is not None:
            self._socket.close()
            self._socket = None
        try:
            os.unlink(self.socket_path)
        except FileNotFoundError:
            pass
