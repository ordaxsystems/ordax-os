#!/usr/bin/env python3
"""Derive a deterministic generated-IDL-header barrier from Wine's Makefile.

The generated Wine Makefile is the authority. No Wine header name is injected
into the build command by this module. It extracts safe relative `.h` targets
whose prerequisites include `.idl` source, validates the resulting set, and
returns a canonical digest that can be recorded in build provenance.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath
import re

TARGET_RE = re.compile(r"^[A-Za-z0-9_./+@-]+\.h$")
REQUIRED_REGRESSION_ANCHORS = {
    "include/unknwn.h",
    "dlls/jscript/jsdisp.h",
}


class GeneratedIdlHeaderBarrierError(RuntimeError):
    pass


def _logical_lines(text: str) -> list[str]:
    lines: list[str] = []
    current = ""
    for physical in text.splitlines():
        if current:
            current += physical.lstrip()
        else:
            current = physical
        stripped = current.rstrip()
        if stripped.endswith("\\"):
            current = stripped[:-1] + " "
            continue
        lines.append(current)
        current = ""
    if current:
        raise GeneratedIdlHeaderBarrierError("generated Makefile ends in an unterminated continuation")
    return lines


def _safe_target(value: str) -> str:
    if not TARGET_RE.fullmatch(value):
        raise GeneratedIdlHeaderBarrierError(f"unsafe generated header target: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise GeneratedIdlHeaderBarrierError(f"unsafe generated header target path: {value!r}")
    return path.as_posix()


def derive_targets(makefile_text: str) -> list[str]:
    targets: set[str] = set()
    for line in _logical_lines(makefile_text):
        if not line or line[0].isspace() or line.startswith("#") or ":" not in line:
            continue
        lhs, rhs = line.split(":", 1)
        if ".idl" not in rhs:
            continue
        for raw_target in lhs.split():
            if raw_target.endswith(".h"):
                targets.add(_safe_target(raw_target))

    missing = sorted(REQUIRED_REGRESSION_ANCHORS - targets)
    if missing:
        raise GeneratedIdlHeaderBarrierError(
            "Wine generated-header graph lost required IDL targets: " + ", ".join(missing)
        )
    if len(targets) < 20:
        raise GeneratedIdlHeaderBarrierError(
            f"implausibly small Wine IDL generated-header target set: {len(targets)}"
        )
    return sorted(targets)


def canonical_digest(targets: list[str]) -> str:
    encoded = json.dumps(targets, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def plan(makefile: Path) -> dict:
    try:
        text = makefile.read_text(encoding="utf-8")
    except OSError as exc:
        raise GeneratedIdlHeaderBarrierError(f"cannot read generated Wine Makefile: {exc}") from exc
    targets = derive_targets(text)
    return {
        "$schema": "prototype-ordax.windows-compat-generated-idl-header-barrier/1",
        "authority": "wine-generated-makefile",
        "selection": "relative-dot-h-target-with-dot-idl-prerequisite",
        "target_count": len(targets),
        "targets_sha256": canonical_digest(targets),
        "targets": targets,
    }


def write_target_file(plan_value: dict, destination: Path) -> None:
    targets = plan_value.get("targets")
    if not isinstance(targets, list) or targets != sorted(targets) or len(set(targets)) != len(targets):
        raise GeneratedIdlHeaderBarrierError("invalid generated-header barrier plan")
    validated = [_safe_target(value) for value in targets]
    if validated != targets:
        raise GeneratedIdlHeaderBarrierError("generated-header barrier plan drifted")
    if canonical_digest(validated) != plan_value.get("targets_sha256"):
        raise GeneratedIdlHeaderBarrierError("generated-header barrier digest drifted")
    destination.write_text("\n".join(validated) + "\n", encoding="utf-8")


def verify_materialized(output_root: Path, plan_value: dict) -> None:
    targets = plan_value.get("targets")
    if not isinstance(targets, list):
        raise GeneratedIdlHeaderBarrierError("generated-header barrier targets missing")
    missing: list[str] = []
    for value in targets:
        safe = _safe_target(value)
        path = output_root / safe
        try:
            path.relative_to(output_root)
        except ValueError as exc:
            raise GeneratedIdlHeaderBarrierError(f"generated header escaped output root: {safe}") from exc
        if not path.is_file() or path.stat().st_size <= 0:
            missing.append(safe)
    if missing:
        preview = ", ".join(missing[:12])
        suffix = "" if len(missing) <= 12 else f" (+{len(missing) - 12} more)"
        raise GeneratedIdlHeaderBarrierError(
            f"Wine IDL header barrier did not materialize {len(missing)} targets: {preview}{suffix}"
        )
