#!/usr/bin/env python3
"""Stable rootfs directory layout, sourced solely from stable-base/source.json.

Shared by the existing Alpine candidate and the Independent Base Stable profile.
It neither builds a rootfs nor grants activation or physical-media authority.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import stat
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "bootstrap/stable-base/source.json"
SAFE_NAME = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
VOLATILE = {"dev", "proc", "sys", "run", "tmp"}


class StableRuntimeLayoutError(RuntimeError):
    pass


def load_contract() -> dict:
    if SOURCE.is_symlink() or not SOURCE.is_file():
        raise StableRuntimeLayoutError("canonical Stable layout contract is missing or unsafe")
    try:
        contract = json.loads(SOURCE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StableRuntimeLayoutError(f"cannot read canonical Stable layout contract: {exc}") from exc
    if not isinstance(contract, dict) or contract.get("$schema") != "prototype-ordax.stable-base-source/1":
        raise StableRuntimeLayoutError("unexpected Stable layout contract schema")
    return contract


def runtime_directories(contract: dict) -> tuple[str, ...]:
    rootfs = contract.get("rootfs")
    declared = rootfs.get("runtime_directories") if isinstance(rootfs, dict) else None
    if not isinstance(declared, list) or not 5 <= len(declared) <= 32:
        raise StableRuntimeLayoutError("Stable runtime directories are absent or unbounded")
    if any(not isinstance(name, str) or SAFE_NAME.fullmatch(name) is None for name in declared):
        raise StableRuntimeLayoutError("Stable runtime directory name is unsafe")
    if len(declared) != len(set(declared)):
        raise StableRuntimeLayoutError("Stable runtime directory names are duplicated")
    if not VOLATILE.issubset(declared) or "workspace" in declared:
        raise StableRuntimeLayoutError("Stable runtime layout lost volatile mounts or includes Dev workspace")
    if rootfs.get("read_only") is not True or rootfs.get("format") != "erofs":
        raise StableRuntimeLayoutError("Stable runtime layout requires immutable EROFS")
    return tuple(declared)


def ensure_runtime_directories(target: Path, contract: dict, *, create: bool) -> tuple[str, ...]:
    directories = runtime_directories(contract)
    if target.is_symlink() or not target.is_dir():
        raise StableRuntimeLayoutError("target rootfs must be a real directory")
    target = target.resolve()
    if target == ROOT or ROOT in target.parents:
        raise StableRuntimeLayoutError("Stable runtime layout may not mutate the source repository")
    for relative in directories:
        path = target / relative
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise StableRuntimeLayoutError(f"unsafe Stable directory object: /{relative}")
        if not path.exists():
            if not create:
                raise StableRuntimeLayoutError(f"missing Stable runtime directory: /{relative}")
            path.mkdir(mode=0o755)
        if relative == "tmp":
            if create:
                path.chmod(0o1777)
            if stat.S_IMODE(path.stat().st_mode) != 0o1777:
                raise StableRuntimeLayoutError("Stable /tmp must have mode 1777")
    return directories


def unique_regular_bytes(target: Path) -> int:
    """Count each regular inode once, matching the Stable Base size contract."""
    seen: set[tuple[int, int]] = set()
    total = 0
    for path in target.rglob("*"):
        info = path.lstat()
        if stat.S_ISREG(info.st_mode):
            identity = (info.st_dev, info.st_ino)
            if identity not in seen:
                seen.add(identity)
                total += info.st_size
    return total


def verify_stable_size(target: Path, contract: dict) -> int:
    rootfs = contract.get("rootfs")
    limit = rootfs.get("maximum_unique_regular_bytes") if isinstance(rootfs, dict) else None
    if type(limit) is not int or not 0 < limit <= 4 * 1024 * 1024 * 1024:
        raise StableRuntimeLayoutError("invalid canonical Stable rootfs size limit")
    used = unique_regular_bytes(target)
    if used > limit:
        raise StableRuntimeLayoutError(f"Stable Base too large: {used} > {limit}")
    return used


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("install", "check"))
    parser.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    try:
        contract = load_contract()
        directories = ensure_runtime_directories(
            args.target, contract, create=args.action == "install"
        )
        if args.action == "check":
            verify_stable_size(args.target, contract)
    except (StableRuntimeLayoutError, OSError) as exc:
        print(f"stable-runtime-layout: {exc}", file=sys.stderr)
        return 2
    print(f"stable-runtime-layout: PASS ({len(directories)} canonical directories)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
