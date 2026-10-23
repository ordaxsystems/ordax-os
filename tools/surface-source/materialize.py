#!/usr/bin/env python3
"""Verify and stage a pinned Surface source tree without changing a live OS checkout.

This OS-owned build utility intentionally does NOT fetch a branch, update a device,
overwrite an active Surface, or implement a second UI. The caller supplies an
immutable checkout and consumes its verified, disposable staging directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
LOCK_PATH = ROOT / "docs/contracts/surface-source.json"
VISUAL_PATHS = ("system/surface/ui", "system/surface/workspace")
SHA40 = re.compile(r"^[a-f0-9]{40}$")


class SurfaceSourceError(ValueError):
    pass


def git(source: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(source), *args],
        check=False, capture_output=True,
    )
    if result.returncode:
        raise SurfaceSourceError("pinned Surface Git source unavailable or invalid")
    return result.stdout


def load_lock(path: Path = LOCK_PATH) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("$schema") != "ordax.surface-source/1":
        raise SurfaceSourceError("unrecognized Surface source lock schema")
    if raw.get("status") not in {"integration-candidate", "canonical"}:
        raise SurfaceSourceError("invalid source lock status")
    if raw.get("source_repository") != "ordaxsystems/ordax-surface":
        raise SurfaceSourceError("untrusted Surface source repository")
    if not isinstance(raw.get("source_commit"), str) or not SHA40.fullmatch(raw["source_commit"]):
        raise SurfaceSourceError("Surface source commit must be an exact Git SHA")
    if raw.get("visual_source_paths") != list(VISUAL_PATHS):
        raise SurfaceSourceError("Surface source paths do not match the public mount boundary")
    return raw


def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\\0" + content).hexdigest()


def verify_source(source: Path, lock: dict) -> tuple[list[tuple[str, bytes]], dict]:
    source = source.resolve(strict=True)
    if not source.is_dir() or source.is_symlink():
        raise SurfaceSourceError("Surface checkout must be a directory")
    head = git(source, "rev-parse", "HEAD").decode("ascii").strip()
    if head != lock["source_commit"]:
        raise SurfaceSourceError("Surface checkout revision is not pinned source_commit")
    dirty = git(source, "status", "--porcelain", "--untracked-files=all", "--", *VISUAL_PATHS)
    if dirty:
        raise SurfaceSourceError("Surface source checkout is modified")
    raw = git(source, "ls-tree", "-rz", "HEAD", "--", *VISUAL_PATHS)
    records = []
    fingerprint = hashlib.sha256()
    for entry in raw.split(b"\\0"):
        if not entry:
            continue
        try:
            meta, name = entry.split(b"\\t", 1)
            mode, kind, expected = meta.decode("ascii").split()
            relative = name.decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise SurfaceSourceError("malformed source Git tree") from exc
        normalized = PurePosixPath(relative)
        if (mode not in {"100644", "100755"} or kind != "blob" or
            str(normalized) != relative or normalized.is_absolute() or
            not any(relative.startswith(prefix + "/") for prefix in VISUAL_PATHS) or
            ".." in normalized.parts):
            raise SurfaceSourceError("unsafe source mode or path: " + relative)
        path = source.joinpath(*normalized.parts)
        if path.is_symlink() or not path.is_file():
            raise SurfaceSourceError("source file is absent or linked: " + relative)
        payload = path.read_bytes()
        if git_blob_sha(payload) != expected:
            raise SurfaceSourceError("source bytes differ from pinned Git blob: " + relative)
        fingerprint.update(relative.encode("utf-8") + b"\\0")
        fingerprint.update(hashlib.sha256(payload).digest())
        records.append((relative, payload))
    if not records:
        raise SurfaceSourceError("pinned Surface contains no visual sources")
    for prefix in VISUAL_PATHS:
        if not any(p.startswith(prefix + "/") for p, _ in records):
            raise SurfaceSourceError("missing visual source subtree: " + prefix)
    receipt = {
        "$schema": "ordax.surface-source-materialization/1",
        "source_repository": lock["source_repository"],
        "source_commit": head,
        "paths": list(VISUAL_PATHS),
        "file_count": len(records),
        "visual_source_sha256": fingerprint.hexdigest(),
        "source_only": True,
        "live_os_mutated": False,
    }
    return records, receipt


def stage_source(records: list[tuple[str, bytes]], receipt: dict, output: Path) -> None:
    output = output.absolute()
    if output.exists() or output.is_symlink():
        raise SurfaceSourceError("staging output already exists; refusing replacement")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".surface-source-stage-", dir=output.parent))
    try:
        for relative, payload in records:
            destination = staging.joinpath(*PurePosixPath(relative).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(payload)
        (staging / "surface-source-receipt.json").write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8"
        )
        if output.exists() or output.is_symlink():
            raise SurfaceSourceError("staging output appeared concurrently")
        os.rename(staging, output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify", "stage"))
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=LOCK_PATH)
    parser.add_argument("--out-dir", type=Path)
    args = parser.parse_args()
    if args.command == "stage" and args.out_dir is None:
        parser.error("stage requires --out-dir")
    if args.command == "verify" and args.out_dir is not None:
        parser.error("verify does not accept --out-dir")
    lock = load_lock(args.lock)
    records, receipt = verify_source(args.source_dir, lock)
    if args.command == "stage":
        stage_source(records, receipt, args.out_dir)
    print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    main()
