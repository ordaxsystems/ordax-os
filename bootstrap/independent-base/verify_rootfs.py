#!/usr/bin/env python3
"""Read-only inventory of an Independent Base rootfs TAR; not a release gate."""
from __future__ import annotations
import argparse
import json
import tarfile

ALPINE = ("etc/alpine-release", "sbin/apk", "usr/bin/apk")
ALPINE_DIRS = ("etc/apk/", "lib/apk/", "var/lib/apk/")


def normalized(path: str) -> str:
    if path.startswith("/") or "\\" in path:
        raise ValueError("absolute or non-POSIX tar path")
    parts = [p for p in path.split("/") if p not in ("", ".")]
    if not parts or ".." in parts:
        raise ValueError("unsafe tar path")
    return "/".join(parts)


def audit(path: str) -> dict:
    seen = set()
    alpine, elf = [], []
    total, regular, links = 0, 0, 0
    with tarfile.open(path, "r:*") as archive:
        for member in archive:
            if member.isdir() and member.name in (".", "./"):
                continue
            name = normalized(member.name)
            if name in seen:
                raise ValueError(f"duplicate tar entry: {name}")
            seen.add(name)
            if name in ALPINE or any(name.startswith(prefix) for prefix in ALPINE_DIRS):
                alpine.append(name)
            if member.issym() or member.islnk():
                links += 1
            elif member.isfile():
                regular += 1
                total += member.size
                if member.size > 512 * 1024 * 1024 or total > 2 * 1024 * 1024 * 1024:
                    raise ValueError("rootfs exceeds audit limits")
                stream = archive.extractfile(member)
                if stream and stream.read(4) == b"\x7fELF":
                    elf.append(name)
            elif not (member.isdir() or member.isdev() or member.isfifo()):
                raise ValueError(f"unsupported tar entry: {name}")
    return {"status": "fail" if alpine else "pass",
            "alpine_paths": sorted(alpine), "elf_files": sorted(elf),
            "regular_files": regular, "symlinks": links,
            "uncompressed_file_bytes": total,
            "scope": "tar-path-and-ELF-magic-inventory-only",
            "elf_linkage_verified": False, "boot_verified": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rootfs_tar")
    args = parser.parse_args()
    try:
        result = audit(args.rootfs_tar)
        print(json.dumps(result, sort_keys=True))
        return 0 if result["status"] == "pass" else 1
    except (OSError, ValueError, tarfile.TarError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
