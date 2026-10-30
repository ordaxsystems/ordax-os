#!/usr/bin/env python3
"""Read-only CI probe for a *running* pinned local llama.cpp engine.

The OS owns backend startup, authentication and source-lock policy. This script
creates no daemon, writes no credentials and accesses literal IPv4 loopback.
It proves live SSE and client disconnect only, NOT server-side compute abort.
"""
from __future__ import annotations

import argparse
from http.client import HTTPConnection
import io
import json
import os
from pathlib import Path
import stat
from urllib.parse import urlsplit

MAX_FRAME_BYTES = 1024 * 1024
MAX_EVENTS = 16384
MAX_OUTPUT_CHARS = 131072


class ProbeError(ValueError):
    pass


def local_port(endpoint: str) -> int:
    try:
        url = urlsplit(endpoint)
        port = url.port
    except ValueError as exc:
        raise ProbeError("invalid local endpoint") from exc
    if (url.scheme != "http" or url.hostname != "127.0.0.1"
            or url.netloc != f"127.0.0.1:{port}" or port is None
            or not 1 <= port <= 65535 or url.path not in ("", "/")
            or url.query or url.fragment):
        raise ProbeError("endpoint must be literal http://127.0.0.1:PORT")
    return port


def private_key(path: Path) -> str:
    # Descriptor inspection makes the symlink and permission checks atomic.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as file:
        mode = os.fstat(file.fileno())
        if not stat.S_ISREG(mode.st_mode) or (mode.st_mode & 0o077):
            raise ProbeError("API key must be a private regular file")
        raw = file.read(2050)
    if len(raw) > 2049:
        raise ProbeError("API key length exceeds bound")
    try:
        key = raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise ProbeError("API key is not ASCII") from exc
    if not 1 <= len(key) <= 2048 or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise ProbeError("API key is not printable ASCII")
    return key


def request(port: int, method: str, path: str, key: str | None = None,
            body: dict | None = None, timeout: int = 90):
    conn = HTTPConnection("127.0.0.1", port, timeout=timeout)
    headers = {"Accept": "application/json"}
    if key is not None:
        headers["Authorization"] = "Bearer " + key
    data = None
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    try:
        conn.request(method, path, body=data, headers=headers)
        return conn, conn.getresponse()
    except BaseException:
        conn.close()
        raise


def bounded_json(response) -> dict:
    raw = response.read(MAX_FRAME_BYTES + 1)
    if len(raw) > MAX_FRAME_BYTES:
        raise ProbeError("JSON response exceeds limit")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, ValueError) as exc:
        raise ProbeError("invalid JSON response") from exc
    if not isinstance(payload, dict):
        raise ProbeError("JSON response must be an object")
    return payload


def discovered_model(port: int, key: str) -> str:
    conn, response = request(port, "GET", "/v1/models", key)
    try:
        if response.status != 200:
            raise ProbeError("model discovery failed")
        models = bounded_json(response).get("data")
        if (not isinstance(models, list) or len(models) != 1
                or not isinstance(models[0], dict)):
            raise ProbeError("backend must expose exactly one model")
        model = models[0].get("id")
        if not isinstance(model, str) or not 1 <= len(model) <= 160:
            raise ProbeError("model ID is unavailable")
        return model
    finally:
        response.close()
        conn.close()


def chat(model: str, *, tokens: int = 48, prompt: str = "Reply with a short greeting") -> dict:
    return {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": tokens,
        "stream": True,
    }


def verified_stream(response, model: str) -> dict:
    if response.status != 200:
        raise ProbeError("streaming endpoint rejected authenticated request")
    content_type = response.getheader("content-type") or ""
    if not content_type.lower().split(";", 1)[0].strip() == "text/event-stream":
        raise ProbeError("backend did not return SSE")
    total_bytes = 0
    events = 0
    finished = False
    done = False
    content = ""
    frame = []
    while True:
        line = response.readline(MAX_FRAME_BYTES + 1)
        if not line:
            break
        total_bytes += len(line)
        if total_bytes > MAX_FRAME_BYTES:
            raise ProbeError("SSE exceeds response byte bound")
        if len(line) > MAX_FRAME_BYTES:
            raise ProbeError("SSE event line exceeds bound")
        try:
            text = line.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ProbeError("SSE contains invalid UTF-8") from exc
        line = text.rstrip("\r\n")
        if line.startswith(":"):
            continue
        if line == "":
            if not frame:
                continue
            raw = "\n".join(frame)
            frame = []
            if done:
                raise ProbeError("stream contains data after DONE")
            if raw == "[DONE]":
                if not finished:
                    raise ProbeError("DONE without successful finish_reason")
                done = True
                continue
            events += 1
            if events > MAX_EVENTS:
                raise ProbeError("SSE event limit exceeded")
            try:
                data = json.loads(raw)
            except ValueError as exc:
                raise ProbeError("SSE event is not JSON") from exc
            if not isinstance(data, dict) or (data.get("model") is not None
                                              and data["model"] != model):
                raise ProbeError("SSE model identity mismatch")
            choices = data.get("choices")
            if not isinstance(choices, list) or len(choices) != 1:
                raise ProbeError("SSE must provide one choice")
            choice = choices[0]
            if not isinstance(choice, dict) or choice.get("index", 0) != 0:
                raise ProbeError("invalid SSE choice")
            delta = choice.get("delta")
            if not isinstance(delta, dict) or (delta.get("role", "assistant")
                                                != "assistant"):
                raise ProbeError("SSE is not assistant text")
            for field in ("tool_calls", "function_call", "tool_call_id", "refusal"):
                if field in choice or field in delta:
                    raise ProbeError("SSE contains forbidden tool authority")
            if "message" in choice or finished:
                raise ProbeError("SSE contains an unexpected completion envelope")
            reason = choice.get("finish_reason")
            if reason is not None:
                if reason != "stop":
                    raise ProbeError("SSE completion was truncated or invalid")
                finished = True
            part = delta.get("content")
            if part is not None:
                if not isinstance(part, str) or "\0" in part:
                    raise ProbeError("invalid SSE content")
                content += part
                if len(content) > MAX_OUTPUT_CHARS:
                    raise ProbeError("SSE text exceeds bound")
            continue
        if not line.startswith("data:"):
            raise ProbeError("unexpected SSE metadata field")
        if done:
            raise ProbeError("SSE contains data after DONE")
        frame.append(line[5:].removeprefix(" "))
    if frame or not done or not finished or not content.strip() or events < 1:
        raise ProbeError("stream lacks a complete text response and DONE marker")
    return {"events": events, "text_chars": len(content)}


def run_live(endpoint: str, key_path: Path) -> None:
    port = local_port(endpoint)
    key = private_key(key_path)
    model = discovered_model(port, key)

    # Streaming endpoints, like buffered endpoints, must require the OS key.
    conn, denied = request(port, "POST", "/v1/chat/completions",
                           body=chat(model), timeout=90)
    try:
        if denied.status != 401:
            raise ProbeError("streaming endpoint did not reject an unauthenticated caller")
    finally:
        denied.close()
        conn.close()

    conn, result = request(port, "POST", "/v1/chat/completions",
                           key=key, body=chat(model), timeout=120)
    try:
        evidence = verified_stream(result, model)
    finally:
        result.close()
        conn.close()

    # Disconnect an in-flight request without waiting for a full completion.
    # The client returning does NOT prove the backend stopped computing.
    conn, pending = request(port, "POST", "/v1/chat/completions", key=key,
                            body=chat(model, tokens=128,
                                      prompt="Count in words from one to one hundred."),
                            timeout=120)
    try:
        if pending.status != 200:
            raise ProbeError("disconnect fixture did not start streaming")
        if "text/event-stream" not in (pending.getheader("content-type") or "").lower():
            raise ProbeError("disconnect fixture does not expose SSE")
        first_line = pending.readline(16384)
        if not first_line or not first_line.startswith((b"data:", b":")):
            raise ProbeError("disconnect fixture has no SSE frame")
    finally:
        pending.close()
        conn.close()

    check, health = request(port, "GET", "/health", timeout=90)
    try:
        if health.status not in (200, 503):
            raise ProbeError("backend unhealthy or inaccessible after disconnect")
        if health.status != 200:
            raise ProbeError("backend did not recover ready state after client disconnect")
    finally:
        health.close()
        check.close()

    print("LOCAL_AI_REAL_ENGINE_AUTHENTICATED_SSE=PASS")
    print("LOCAL_AI_REAL_ENGINE_SSE_EVENTS=" + str(evidence["events"]))
    print("LOCAL_AI_REAL_ENGINE_SSE_TEXT_CHARS=" + str(evidence["text_chars"]))
    print("LOCAL_AI_REAL_ENGINE_CLIENT_DISCONNECT=PASS")
    print("LOCAL_AI_ENGINE_SERVER_SIDE_ABORT_PROVEN=NO")
    print("LOCAL_AI_BUILDROOT_ABI_PROVEN=NO")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://127.0.0.1:17865")
    parser.add_argument("--api-key-file", type=Path, required=True)
    args = parser.parse_args()
    try:
        run_live(args.endpoint, args.api_key_file)
    except (OSError, ProbeError, TimeoutError) as exc:
        parser.exit(2, "live SSE probe failed: " + str(exc) + "\n")


if __name__ == "__main__":
    main()
