#!/usr/bin/env python3
"""Fixed-route Native bridge to the verified local inference server.

The browser uses the existing Native Host authority and same-origin policy.
This bridge never accepts an upstream URL, redirects, arbitrary paths or tools.
It does not itself authenticate other local processes that may reach llama.cpp.
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import stat

NATIVE_LOCAL_AI_PREFIX = "/__ordax/native/local-ai"
UPSTREAM_PORT = 17865
AUTH_FILE = "/run/ordax/local-ai-auth/key"
MAX_REQUEST_BYTES = 256 * 1024
MAX_DISCOVERY_BYTES = 256 * 1024
MAX_COMPLETION_BYTES = 1024 * 1024
PATHS = {
    ("GET", "/health"): 0,
    ("GET", "/v1/models"): MAX_DISCOVERY_BYTES,
    ("POST", "/v1/chat/completions"): MAX_COMPLETION_BYTES,
}


class NativeLocalAiError(ValueError):
    pass


class NativeLocalAiUpstreamError(NativeLocalAiError):
    pass


def _private_inference_key() -> str:
    """Read one boot-scoped secret from a regular, process-owner-only file."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    if not hasattr(os, "O_NOFOLLOW"):
        raise NativeLocalAiUpstreamError("secure file open is unsupported")
    try:
        fd = os.open(AUTH_FILE, flags)
        try:
            info = os.fstat(fd)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o600
                or info.st_nlink != 1
                or info.st_size != 65
            ):
                raise NativeLocalAiUpstreamError("inference authorization file is unsafe")
            raw = os.read(fd, 66)
        finally:
            os.close(fd)
    except OSError as exc:
        raise NativeLocalAiUpstreamError("inference authorization is unavailable") from exc
    if (
        len(raw) != 65
        or raw[-1:] != b"\n"
        or any(byte not in b"0123456789abcdef" for byte in raw[:64])
    ):
        raise NativeLocalAiUpstreamError("inference authorization is invalid")
    return raw[:64].decode("ascii")


def _bounded_text(value: object, maximum: int) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and "\x00" not in value
        and len(value.strip()) <= maximum
    )


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise NativeLocalAiError("duplicate key")
        result[key] = value
    return result


def validate_completion_request(body: bytes) -> None:
    if not isinstance(body, bytes) or not 0 < len(body) <= MAX_REQUEST_BYTES:
        raise NativeLocalAiError("local AI request is outside byte limit")
    try:
        parsed = json.loads(
            body.decode("utf-8", errors="strict"),
            object_pairs_hook=_unique_object,
        )
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise NativeLocalAiError("invalid UTF-8 JSON request") from exc
    if not isinstance(parsed, dict) or set(parsed) != {"model", "messages", "max_tokens", "stream"}:
        raise NativeLocalAiError("unsupported local AI request schema")
    if not _bounded_text(parsed["model"], 160) or parsed["stream"] is not False:
        raise NativeLocalAiError("invalid model or stream mode")
    tokens = parsed["max_tokens"]
    if isinstance(tokens, bool) or not isinstance(tokens, int) or not 1 <= tokens <= 2048:
        raise NativeLocalAiError("invalid completion token budget")
    messages = parsed["messages"]
    if not isinstance(messages, list) or len(messages) not in (1, 2):
        raise NativeLocalAiError("invalid chat messages")
    roles = ["user"] if len(messages) == 1 else ["system", "user"]
    for item, role in zip(messages, roles):
        cap = 8192 if role == "system" else 32768
        if (
            not isinstance(item, dict)
            or set(item) != {"role", "content"}
            or item["role"] != role
            or not _bounded_text(item["content"], cap)
        ):
            raise NativeLocalAiError("unsupported local AI message")


def forward_local_ai(method: str, suffix: str, body: bytes = b"") -> tuple[int, bytes]:
    """Return a bounded HTTP result, fixed to 127.0.0.1 and an allowlisted path."""
    max_response = PATHS.get((method, suffix))
    if max_response is None:
        raise NativeLocalAiError("unsupported local AI endpoint")
    if method == "POST":
        validate_completion_request(body)
    elif body:
        raise NativeLocalAiError("GET request body is not allowed")

    # Native Host alone owns this credential; the browser never receives it.
    key = _private_inference_key()
    connection = http.client.HTTPConnection(
        "127.0.0.1",
        UPSTREAM_PORT,
        timeout=120 if method == "POST" else 3,
    )
    try:
        connection.request(
            method,
            suffix,
            body=body if method == "POST" else None,
            headers={
                "Accept": "application/json",
                "Authorization": "Bearer " + key,
                **({"Content-Type": "application/json"} if method == "POST" else {}),
            },
        )
        reply = connection.getresponse()
        # Never forward redirects or upstream cookies/headers to the Surface.
        if not 200 <= reply.status < 300:
            return reply.status if reply.status in (400, 404, 409, 429, 503) else 503, b""
        if method == "GET" and suffix == "/health":
            return 200, b""
        if reply.getheader("Content-Encoding", "identity").lower() != "identity":
            raise NativeLocalAiUpstreamError("compressed upstream response is not allowed")
        declared = reply.getheader("Content-Length")
        if declared is not None:
            if not declared.isascii() or not declared.isdecimal() or int(declared) > max_response:
                raise NativeLocalAiUpstreamError("invalid upstream response length")
        payload = reply.read(max_response + 1)
        if len(payload) > max_response:
            raise NativeLocalAiUpstreamError("local AI response exceeded byte budget")
        try:
            json.loads(payload.decode("utf-8", errors="strict"))
        except (ValueError, UnicodeDecodeError, RecursionError) as exc:
            raise NativeLocalAiUpstreamError("invalid upstream JSON") from exc
        return 200, payload
    except (OSError, socket.timeout, TimeoutError, http.client.HTTPException) as exc:
        raise NativeLocalAiUpstreamError("local AI backend unavailable") from exc
    finally:
        connection.close()
