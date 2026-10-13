#!/usr/bin/env python3
"""Opt-in, QEMU-kernel-flagged serial observations of actual Surface execution.

No health state, IPC authority, token, guest disk, or privilege is introduced.
Events are static allowlisted codes only; never print URLs or response bodies.
"""

from __future__ import annotations

from functools import lru_cache
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

BOOT_STAGES = frozenset({
    "webkit-load-started", "webkit-load-committed", "webkit-load-finished",
    "webkit-load-failed", "gtk-window-created",
    "webkit-uri-expected", "webkit-uri-mismatch", "js-probe-installed",
    "js-resource-load-failed", "js-exception", "js-unhandled-rejection",
    "http-surface-document", "http-surface-index", "http-surface-main",
    "http-surface-bootstrap", "http-static-module-failed",
    "http-static-resource-failed", "webkit-resource-failed",
    "composition-started", "semantics-wait", "semantics-complete",
    "store-wait", "store-complete", "composition-mounted",
    "health-requested", "composition-failed",
    "http-get-update", "http-post-health", "http-post-heartbeat",
    "http-health-token-denied", "http-health-sha-invalid",
    "http-health-state-mismatch", "http-heartbeat-payload-invalid",
    "http-heartbeat-write-failed", "http-health-write-failed",
})


@lru_cache(maxsize=1)
def enabled() -> bool:
    try:
        options = Path("/proc/cmdline").read_text(
            encoding="ascii", errors="replace"
        ).split()
        return "ordax.qemu_health_diag=1" in options
    except OSError:
        return False


# Diagnostics describe only public bundled assets, never user files or URLs.
_STATIC_PATH = re.compile(
    r"^/(?:composition|adapters|services|surface|apps|contracts|profile-packs)/"
    r"[A-Za-z0-9_./-]{1,180}\.(?:mjs|js|css)$"
)
_RESOURCE_STAGES = frozenset({
    "js-resource-load-failed", "webkit-resource-failed",
    "http-static-module-failed", "http-static-resource-failed",
})


def static_resource_path(path: object) -> str | None:
    if not isinstance(path, str) or not _STATIC_PATH.fullmatch(path):
        return None
    if ".." in path.split("/") or "//" in path:
        return None
    return path[1:]


def same_origin_static_resource(uri: object, start_uri: str) -> str | None:
    if not isinstance(uri, str) or len(uri) > 512:
        return None
    try:
        actual, expected = urlsplit(uri), urlsplit(start_uri)
    except ValueError:
        return None
    if (actual.scheme, actual.netloc) != (expected.scheme, expected.netloc):
        return None
    if actual.username is not None or actual.password is not None or actual.fragment:
        return None
    return static_resource_path(actual.path)


def emit(stage: str, http_status: int | None = None, *,
         resource_path: str | None = None) -> bool:
    if not enabled() or stage not in BOOT_STAGES:
        return False
    if http_status is not None and (
        type(http_status) is not int or not 100 <= http_status <= 599
        or not stage.startswith("http-")
    ):
        return False
    if resource_path is not None and (
        stage not in _RESOURCE_STAGES
        or static_resource_path("/" + resource_path) != resource_path
    ):
        return False
    suffix = f":{http_status}" if http_status is not None else ""
    if resource_path is not None:
        suffix += f":{resource_path}"
    payload = f"ORDAX_SURFACE_QEMU_DIAG={stage}{suffix}\n".encode("ascii")
    try:
        fd = os.open(
            "/dev/console", os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK
        )
        try:
            os.write(fd, payload)
        finally:
            os.close(fd)
        return True
    except OSError:
        return False
