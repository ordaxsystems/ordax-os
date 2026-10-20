#!/usr/bin/env python3
"""Read-only inventory of an Independent Base rootfs TAR; not a release gate."""
from __future__ import annotations
import argparse
import json
import posixpath
import struct
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



def elf_interpreter(stream, size: int) -> str | None:
    """Parse PT_INTERP read-only; this does not resolve DT_NEEDED libraries."""
    head = stream.read(min(size, 64))
    if not head.startswith(b"\x7fELF"):
        return None
    if len(head) < 52 or head[4] not in (1, 2) or head[5] not in (1, 2):
        raise ValueError("malformed ELF header")
    order = "<" if head[5] == 1 else ">"
    is64 = head[4] == 2
    if is64:
        if len(head) < 64:
            raise ValueError("truncated ELF64 header")
        offset = struct.unpack_from(order + "Q", head, 32)[0]
        entsize, count = struct.unpack_from(order + "HH", head, 54)
        minimum, offset_field, size_field = 56, 8, 32
    else:
        offset = struct.unpack_from(order + "I", head, 28)[0]
        entsize, count = struct.unpack_from(order + "HH", head, 42)
        minimum, offset_field, size_field = 32, 4, 16
    if count == 65535 or count > 1024 or (count and (entsize < minimum or offset + entsize * count > size)):
        raise ValueError("invalid ELF program headers")
    for i in range(count):
        stream.seek(offset + i * entsize)
        header = stream.read(minimum)
        if len(header) != minimum:
            raise ValueError("truncated ELF program header")
        if struct.unpack_from(order + "I", header)[0] != 3:
            continue
        pos = struct.unpack_from(order + ("Q" if is64 else "I"), header, offset_field)[0]
        length = struct.unpack_from(order + ("Q" if is64 else "I"), header, size_field)[0]
        if length < 2 or length > 4096 or pos + length > size:
            raise ValueError("invalid ELF interpreter size")
        stream.seek(pos)
        value = stream.read(length)
        if value[-1:] != b"\0" or b"\0" in value[:-1]:
            raise ValueError("invalid ELF interpreter terminator")
        name = value[:-1].decode("utf-8")
        if not name.startswith("/") or ".." in name.split("/"):
            raise ValueError("unsafe ELF interpreter")
        return name
    return None

def audit(path: str) -> dict:
    seen = set()
    entries = {}
    alpine, elf, interpreters = [], [], {}
    total, regular, links = 0, 0, 0
    with tarfile.open(path, "r:*") as archive:
        for member in archive:
            if member.isdir() and member.name in (".", "./"):
                continue
            name = normalized(member.name)
            if name in seen:
                raise ValueError(f"duplicate tar entry: {name}")
            seen.add(name)
            entries[name] = (member.type, member.linkname)
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
                    stream.seek(0)
                    interpreter = elf_interpreter(stream, member.size)
                    if interpreter:
                        interpreters[name] = interpreter
            elif not (member.isdir() or member.isdev() or member.isfifo()):
                raise ValueError(f"unsupported tar entry: {name}")
    def resolved_interpreter(interpreter: str) -> bool:
        path = interpreter.lstrip("/")
        visited = set()
        for _ in range(40):
            if path in visited or path not in entries:
                return False
            visited.add(path)
            kind, target = entries[path]
            if kind == tarfile.REGTYPE or kind == tarfile.AREGTYPE:
                return True
            if kind != tarfile.SYMTYPE:
                return False
            if not target:
                return False
            base = target.lstrip("/") if target.startswith("/") else posixpath.join(posixpath.dirname(path), target)
            path = posixpath.normpath(base)
            if path == ".." or path.startswith("../"):
                return False
        return False

    missing = {name: interp for name, interp in interpreters.items() if not resolved_interpreter(interp)}
    return {"status": "fail" if alpine or missing else "pass",
            "alpine_paths": sorted(alpine), "elf_files": sorted(elf),
            "elf_interpreters": dict(sorted(interpreters.items())),
            "missing_interpreters": dict(sorted(missing.items())),
            "regular_files": regular, "symlinks": links,
            "uncompressed_file_bytes": total,
            "scope": "tar-path-and-PT_INTERP-presence-inventory-only",
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
