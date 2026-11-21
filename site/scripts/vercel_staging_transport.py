"""Byte-preserving Vercel CLI transport for protected Site Dev staging.

The canonical schema, identity and bundle checks remain in staging_preflight.py.
This transport performs authenticated GET via Vercel CLI using the caller's
existing login; it never deploys, modifies protection or publishes access links.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from email.parser import BytesHeaderParser
from pathlib import Path

MAX_CONTENT_BYTES = 64 * 1024 * 1024
MAX_HEADER_BYTES = 64 * 1024


class VercelTransportError(ValueError):
    pass


def get_raw(origin: str, path: str, limit: int) -> tuple[int, dict[str, str], bytes]:
    """Read exact HTTP response bytes with strict origin-path, size and redirect gates."""
    if not isinstance(path, str) or not path.startswith("/") or path.startswith("//"):
        raise VercelTransportError("vercel-cli-path-invalid")
    if (path != "/" and (any(p in ("", ".", "..") for p in
            path[1:].rstrip("/").split("/")) or "//" in path)):
        raise VercelTransportError("vercel-cli-path-invalid")
    if any(char in path for char in ("\r", "\n", "\\", "?", "#")):
        raise VercelTransportError("vercel-cli-path-invalid")
    if not isinstance(limit, int) or not 0 <= limit <= MAX_CONTENT_BYTES:
        raise VercelTransportError("vercel-cli-limit-invalid")
    executable = shutil.which("vercel")
    if not executable:
        raise VercelTransportError("vercel-cli-not-installed")
    with tempfile.TemporaryDirectory(prefix="ordax-vercel-readonly-") as directory:
        headers_path = Path(directory) / "headers"
        response_path = Path(directory) / "response"
        command = [
            executable, "curl", origin + path,
            "--request", "GET", "--silent", "--show-error",
            "--header", "Accept-Encoding: identity",
            "--max-time", "30", "--max-filesize", str(limit),
            "--dump-header", str(headers_path), "--output", str(response_path),
        ]
        try:
            finished = subprocess.run(
                command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=45, check=False
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise VercelTransportError("vercel-cli-network-or-auth-unavailable") from error
        if finished.returncode != 0 or not headers_path.is_file() or not response_path.is_file():
            raise VercelTransportError("vercel-cli-network-or-auth-unavailable")
        if headers_path.stat().st_size > MAX_HEADER_BYTES:
            raise VercelTransportError("vercel-cli-headers-too-large")
        header_bytes = headers_path.read_bytes().replace(b"\r\n", b"\n")
        blocks = [part for part in header_bytes.split(b"\n\n") if part.strip()]
        if not blocks or any(not block.startswith(b"HTTP/") for block in blocks):
            raise VercelTransportError("vercel-cli-http-headers-invalid")
        # A CONNECT proxy may prepend one informational handshake. Do not follow
        # redirects or accept any other chained response.
        for block in blocks[:-1]:
            first = block.split(b"\n", 1)[0]
            if first not in (b"HTTP/1.1 200 Connection established",
                             b"HTTP/1.1 100 Continue", b"HTTP/2 100"):
                raise VercelTransportError("vercel-cli-chained-response-forbidden")
        lines = blocks[-1].split(b"\n", 1)
        match = re.fullmatch(rb"HTTP/(?:1\.0|1\.1|2|3) ([0-9]{3})(?: [^\r\n]*)?",
                             lines[0])
        if match is None:
            raise VercelTransportError("vercel-cli-http-status-invalid")
        status = int(match.group(1))
        if 300 <= status < 400:
            raise VercelTransportError("vercel-cli-redirect-forbidden")
        if status in (401, 403):
            raise VercelTransportError("vercel-cli-auth-required")
        headers = BytesHeaderParser().parsebytes(
            (lines[1] if len(lines) > 1 else b"") + b"\n\n")
        if headers.get("Content-Encoding", "identity").lower() not in ("", "identity"):
            raise VercelTransportError("vercel-cli-unexpected-content-encoding")
        length = headers.get("Content-Length")
        if length is not None and (not length.isdigit() or int(length) > limit):
            raise VercelTransportError("vercel-cli-response-too-large")
        with response_path.open("rb") as stream:
            body = stream.read(limit + 1)
        if len(body) > limit:
            raise VercelTransportError("vercel-cli-response-too-large")
        if length is not None and int(length) != len(body):
            raise VercelTransportError("vercel-cli-content-length-mismatch")
        return status, {key.lower(): val for key, val in headers.items()}, body
