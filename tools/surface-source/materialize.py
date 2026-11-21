#!/usr/bin/env python3
"""Verify Surface Git blobs from this same OS commit without changing a live checkout.

The single canonical source lives in system/surface/{ui,workspace}.
Only committed OS Git blobs may be materialized into disposable staging.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import tarfile
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
        raise SurfaceSourceError("OS Git source unavailable or invalid")
    return result.stdout


def load_lock(path: Path = LOCK_PATH) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("$schema") != "prototype-ordax.surface-source/2":
        raise SurfaceSourceError("unrecognized Surface source lock schema")
    if raw.get("status") != "canonical":
        raise SurfaceSourceError("Surface source lock is not canonical")
    if raw.get("source_repository") != "ordaxsystems/ordax-os":
        raise SurfaceSourceError("untrusted Surface source repository")
    if raw.get("source_ref") != "same-commit" or raw.get("source_policy") != "tracked-git-blobs-only":
        raise SurfaceSourceError("Surface must derive from the same committed OS source")
    if raw.get("visual_source_paths") != list(VISUAL_PATHS):
        raise SurfaceSourceError("Surface source paths do not match the public mount boundary")
    return raw


def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\0" + content).hexdigest()


def verify_source(source: Path, lock: dict) -> tuple[list[tuple[str, bytes]], dict]:
    """Verify committed visual tree once, using batched Git operations."""
    source = source.resolve(strict=True)
    if not source.is_dir() or source.is_symlink():
        raise SurfaceSourceError("OS checkout must be a directory")
    head = git(source, "rev-parse", "HEAD").decode("ascii").strip()
    if not SHA40.fullmatch(head) or lock.get("source_ref") != "same-commit":
        raise SurfaceSourceError("Surface identity must equal the OS SHA")
    if git(source, "status", "--porcelain", "--untracked-files=all", "--", *VISUAL_PATHS):
        raise SurfaceSourceError("Surface worktree differs from the committed OS tree")
    listing = git(source, "ls-tree", "-rz", head, "--", *VISUAL_PATHS)
    expected: dict[str, str] = {}
    for record in listing.split(b"\0"):
        if not record:
            continue
        try:
            meta, name = record.split(b"\t", 1)
            mode, kind, sha = meta.decode("ascii").split()
            relative = name.decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise SurfaceSourceError("malformed Git visual inventory") from exc
        parsed = PurePosixPath(relative)
        if (mode not in {"100644", "100755"} or kind != "blob"
                or str(parsed) != relative or parsed.is_absolute()
                or ".." in parsed.parts or relative in expected
                or not any(relative.startswith(prefix + "/") for prefix in VISUAL_PATHS)):
            raise SurfaceSourceError("unsafe visual Git entry: " + relative)
        path = source.joinpath(*parsed.parts)
        if path.is_symlink() or not path.is_file():
            raise SurfaceSourceError("missing or linked visual source: " + relative)
        expected[relative] = sha
    if not expected or not all(any(p.startswith(prefix + "/") for p in expected) for prefix in VISUAL_PATHS):
        raise SurfaceSourceError("missing committed Surface subtree")
    archive = git(source, "-c", "core.autocrlf=false", "archive", "--format=tar", head, *VISUAL_PATHS)
    recovered: dict[str, bytes] = {}
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as bundle:
            for item in bundle:
                if item.isdir():
                    continue
                name = item.name
                if not item.isfile() or name not in expected or name in recovered:
                    raise SurfaceSourceError("unsafe or untracked entry in Surface Git archive")
                stream = bundle.extractfile(item)
                if stream is None:
                    raise SurfaceSourceError("unreadable Git Surface blob")
                content = stream.read()
                if len(content) != item.size or git_blob_sha(content) != expected[name]:
                    raise SurfaceSourceError("Git Surface archive differs from committed blob: " + name)
                recovered[name] = content
    except (OSError, tarfile.TarError) as exc:
        raise SurfaceSourceError("unreadable canonical Surface archive") from exc
    if set(recovered) != set(expected):
        raise SurfaceSourceError("Surface archive missing committed source")
    records = sorted(recovered.items())
    fingerprint = hashlib.sha256()
    for name, payload in records:
        fingerprint.update(name.encode("utf-8") + b"\0")
        fingerprint.update(hashlib.sha256(payload).digest())
    return records, {
        "$schema": "ordax.surface-source-materialization/2",
        "source_repository": lock["source_repository"],
        "source_commit": head,
        "paths": list(VISUAL_PATHS),
        "file_count": len(records),
        "visual_source_sha256": fingerprint.hexdigest(),
        "source_only": True,
        "live_os_mutated": False,
    }


def verify_staged_visuals(os_root: Path, staged_system: Path, receipt: dict) -> dict:
    """Bind staged visual bytes to the actual committed OS Git tree."""
    lock = load_lock(os_root / "docs/contracts/surface-source.json")
    records, proof = verify_source(os_root, lock)
    if (receipt.get("os_commit") != proof["source_commit"]
            or receipt.get("surface_source_commit") != proof["source_commit"]
            or receipt.get("surface_source_repository") != "ordaxsystems/ordax-os"
            or receipt.get("visual_file_count") != proof["file_count"]
            or receipt.get("visual_source_sha256") != proof["visual_source_sha256"]):
        raise SurfaceSourceError("staged visual receipt is not bound to OS Git")
    stage = staged_system.parent
    actual = {}
    for prefix in VISUAL_PATHS:
        base = stage / prefix
        if base.is_symlink() or not base.is_dir():
            raise SurfaceSourceError("missing or linked staged visual source: " + prefix)
        for entry in base.rglob("*"):
            if entry.is_dir() and not entry.is_symlink():
                continue
            if not entry.is_file() or entry.is_symlink():
                raise SurfaceSourceError("unsafe staged visual entry: " + str(entry))
            relative = entry.relative_to(stage).as_posix()
            if relative in actual:
                raise SurfaceSourceError("duplicate staged visual entry")
            actual[relative] = entry
    if set(actual) != {name for name, _ in records}:
        raise SurfaceSourceError("staged visual file inventory differs from OS Git")
    for relative, content in records:
        if actual[relative].read_bytes() != content:
            raise SurfaceSourceError("staged visual bytes differ from OS Git: " + relative)
    return proof


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
            json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
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
    parser.add_argument("--os-root", type=Path, default=ROOT)
    parser.add_argument("--out-dir", type=Path)
    args = parser.parse_args()
    if args.command == "stage" and args.out_dir is None:
        parser.error("stage requires --out-dir")
    if args.command == "verify" and args.out_dir is not None:
        parser.error("verify does not accept --out-dir")
    lock = load_lock(args.os_root / "docs/contracts/surface-source.json")
    records, receipt = verify_source(args.os_root, lock)
    if args.command == "stage":
        stage_source(records, receipt, args.out_dir)
    print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    main()
