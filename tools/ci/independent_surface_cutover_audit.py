#!/usr/bin/env python3
"""Machine-checkable guard for the Alpine -> Buildroot Surface cutover.

`pre` validates the migration state that is allowed before promotion: the new
Independent Surface owner is Buildroot/musl and package-manager-free while the
current canonical Alpine Surface and Stable Base remain intact.

`post` is intentionally red before cutover. It becomes green only after the
canonical Surface owner has been replaced atomically by Buildroot/musl and all
Surface-only Alpine/APK provisioning is gone. Stable Base Alpine ownership is
explicitly preserved until its later migration gate.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]

INDEPENDENT_OWNER = Path("bootstrap/independent-surface-runtime")
CANONICAL_OWNER = Path("bootstrap/surface-runtime")
SURFACE_LAUNCHER = Path("system/surface/bin/ordax-surface")
LEGACY_SURFACE_FILES = (
    Path("bootstrap/surface-runtime/discover_lock.py"),
    Path(".github/workflows/surface-runtime-lock-discovery.yml"),
)
STABLE_BASE_GUARDS = (
    Path("bootstrap/base/alpine_core.py"),
    Path("bootstrap/stable-base/build.py"),
    Path("bootstrap/stable-base/source.json"),
)
SURFACE_CACHE_OWNER = Path("tools/ci/portable_component_cache.py")

# These markers indicate an operational Alpine/APK dependency. Merely naming
# /etc/apk or /lib/apk in a negative runtime assertion is intentionally allowed:
# the independent builder must be able to prove those paths are absent.
FORBIDDEN_OPERATIONAL_MARKERS = (
    "apk add",
    "dl-cdn.alpinelinux.org",
    "alpine-minirootfs",
    "apk_package_lock",
    "bootstrap/base/alpine_core.py",
)
FORBIDDEN_LAUNCHER_MARKERS = (
    "RUNTIME_ID=alpine-",
    "LEGACY_RUNTIME_ID=alpine-",
    "run_bounded_apk()",
    "/sbin/apk",
    "/etc/apk/keys",
)
IGNORED_GENERATED_SUFFIXES = {".pyc", ".pyo"}


class AuditError(RuntimeError):
    pass


@dataclass(frozen=True)
class AuditResult:
    mode: str
    status: str
    checks: dict[str, bool]

    def as_dict(self) -> dict[str, object]:
        return {
            "$schema": "prototype-ordax.independent-surface-cutover-audit/1",
            "mode": self.mode,
            "status": self.status,
            "checks": self.checks,
        }


def _text(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise AuditError(f"required regular file missing: {path}")
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise AuditError(f"cannot read {path}: {exc}") from exc


def _json(path: Path) -> dict:
    try:
        value = json.loads(_text(path))
    except json.JSONDecodeError as exc:
        raise AuditError(f"invalid JSON contract {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise AuditError(f"JSON contract must be an object: {path}")
    return value


def _operational_files(owner: Path) -> list[Path]:
    if owner.is_symlink() or not owner.is_dir():
        raise AuditError(f"Surface owner directory missing or unsafe: {owner}")
    files: list[Path] = []
    for path in sorted(owner.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_symlink():
            raise AuditError(f"Surface owner contains symlink: {path}")
        if "__pycache__" in path.parts or path.suffix.lower() in IGNORED_GENERATED_SUFFIXES:
            continue
        if not path.is_file() or path.suffix.lower() == ".md":
            continue
        files.append(path)
    return files


def _forbidden_hits(owner: Path) -> dict[str, list[str]]:
    hits: dict[str, list[str]] = {}
    for path in _operational_files(owner):
        text = _text(path).lower()
        relative = path.as_posix()
        for marker in FORBIDDEN_OPERATIONAL_MARKERS:
            if marker.lower() in text:
                hits.setdefault(marker, []).append(relative)
    return hits


def _surface_contract(owner: Path) -> dict[str, bool]:
    source = _json(owner / "source.json")
    return {
        "surface_contract_uses_musl": source.get("libc") == "musl",
        "surface_contract_forbids_runtime_package_manager": (
            source.get("package_manager_in_runtime_allowed") is False
        ),
    }


def _stable_base_preserved(root: Path) -> bool:
    return all((root / relative).is_file() for relative in STABLE_BASE_GUARDS)


def _launcher_alpine_provisioning_absent(root: Path) -> bool:
    text = _text(root / SURFACE_LAUNCHER)
    return not any(marker in text for marker in FORBIDDEN_LAUNCHER_MARKERS)


def audit_pre(root: Path = ROOT) -> AuditResult:
    root = root.resolve()
    independent = root / INDEPENDENT_OWNER
    canonical = root / CANONICAL_OWNER
    hits = _forbidden_hits(independent)
    checks = {
        "independent_owner_present": independent.is_dir(),
        "independent_owner_no_operational_alpine_apk_dependency": not hits,
        **_surface_contract(independent),
        "canonical_surface_owner_still_present": canonical.is_dir(),
        "legacy_surface_builder_still_present": (canonical / "build.py").is_file(),
        "legacy_surface_source_still_present": (canonical / "source.json").is_file(),
        "legacy_surface_launcher_still_present": (root / SURFACE_LAUNCHER).is_file(),
        "stable_base_alpine_owner_preserved": _stable_base_preserved(root),
    }
    if not all(checks.values()):
        detail = f" checks={checks} forbidden_hits={hits}"
        raise AuditError("pre-cutover Surface migration contract failed:" + detail)
    return AuditResult("pre", "pass", checks)


def audit_post(root: Path = ROOT) -> AuditResult:
    root = root.resolve()
    canonical = root / CANONICAL_OWNER
    hits = _forbidden_hits(canonical)
    cache_text = _text(root / SURFACE_CACHE_OWNER)
    legacy_absent = all(not (root / relative).exists() for relative in LEGACY_SURFACE_FILES)
    independent_bridge_absent = not (root / INDEPENDENT_OWNER).exists()
    checks = {
        "canonical_surface_owner_present": canonical.is_dir(),
        "canonical_surface_no_operational_alpine_apk_dependency": not hits,
        **_surface_contract(canonical),
        "legacy_surface_apk_discovery_removed": legacy_absent,
        "surface_launcher_alpine_provisioning_removed": _launcher_alpine_provisioning_absent(root),
        "surface_cache_no_longer_depends_on_alpine_core": (
            '"bootstrap/base/alpine_core.py"' not in cache_text
            and "'bootstrap/base/alpine_core.py'" not in cache_text
        ),
        "independent_surface_bridge_removed": independent_bridge_absent,
        "stable_base_alpine_owner_preserved_for_later_gate": _stable_base_preserved(root),
    }
    if not all(checks.values()):
        detail = f" checks={checks} forbidden_hits={hits}"
        raise AuditError("post-cutover Surface contract is not yet satisfied:" + detail)
    return AuditResult("post", "pass", checks)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("pre", "post"))
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    try:
        result = audit_pre(args.root) if args.mode == "pre" else audit_post(args.root)
        payload = json.dumps(result.as_dict(), indent=2, sort_keys=True) + "\n"
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(payload, encoding="utf-8")
        print(payload, end="")
        return 0
    except AuditError as exc:
        print(f"independent-surface-cutover-audit: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
