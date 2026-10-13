#!/usr/bin/env python3
"""Opt-in, QEMU-kernel-flagged serial observations of actual Surface execution.

No health state, IPC authority, token, guest disk, or privilege is introduced.
Events are static allowlisted codes only; never print URLs or response bodies.
"""

from __future__ import annotations

from functools import lru_cache
import os
from pathlib import Path

BOOT_STAGES = frozenset({
    "webkit-load-started", "webkit-load-committed", "webkit-load-finished",
    "webkit-load-failed", "gtk-window-created",
    "webkit-uri-expected", "webkit-uri-mismatch", "js-probe-installed",
    "js-resource-load-failed", "js-exception", "js-unhandled-rejection",
    "http-surface-document", "http-surface-index", "http-surface-main",
    "http-surface-bootstrap", "http-static-module-failed",
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


def emit(stage: str, http_status: int | None = None) -> bool:
    if not enabled() or stage not in BOOT_STAGES:
        return False
    if http_status is not None and (
        type(http_status) is not int or not 100 <= http_status <= 599
        or not stage.startswith("http-")
    ):
        return False
    suffix = f":{http_status}" if http_status is not None else ""
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
