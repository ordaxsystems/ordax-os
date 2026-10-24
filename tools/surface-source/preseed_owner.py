#!/usr/bin/env python3
"""Preseed exact pinned visual Surface in an OFFLINE Owner/Development USB image.

This runs on the Creator build host against the disposable, file-backed
out/dev-base/rootfs, never on a physical device or at runtime. The result is
the same Supervisor-owned immutable release slot used after Git updates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile

SHA = re.compile(r"[0-9a-f]{40}\Z")
VISUALS = ("system/surface/ui", "system/surface/workspace")


class PreseedError(ValueError):
    pass


def git_head(path: Path) -> str:
    got = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=False,
    )
    if got.returncode or not SHA.fullmatch(got.stdout.strip()):
        raise PreseedError(f"not an exact Git checkout: {path}")
    return got.stdout.strip()


def regular_tree(path: Path) -> None:
    if path.is_symlink() or not path.is_dir():
        raise PreseedError(f"missing real source directory: {path}")
    for directory, folders, files in os.walk(path, followlinks=False):
        for name in [*folders, *files]:
            item = Path(directory) / name
            mode = item.lstat().st_mode
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise PreseedError("linked/special file forbidden in Owner source: " + str(item))


def preseed(repo: Path, assembled: Path, rootfs: Path, sha: str) -> dict:
    repo = repo.absolute()
    assembled = assembled.absolute()
    rootfs = rootfs.absolute()
    if not SHA.fullmatch(sha):
        raise PreseedError("Owner OS SHA must be a lowercase 40-hex commit")
    if repo.is_symlink() or not repo.is_dir() or git_head(repo) != sha:
        raise PreseedError("Owner OS checkout not at exact candidate commit")
    expected_rootfs = repo / "out/dev-base/rootfs"
    if rootfs != expected_rootfs or rootfs.is_symlink() or not rootfs.is_dir():
        raise PreseedError("only the Creator's disposable out/dev-base/rootfs is writable")
    if assembled == rootfs or assembled == repo or assembled.is_symlink():
        raise PreseedError("assembled source and target must be separate regular trees")
    source = assembled / "system"
    regular_tree(source)
    lock = json.loads((repo / "docs/contracts/surface-source.json").read_text())
    receipt = json.loads((source / "surface/source-provenance.json").read_text())
    if lock.get("status") != "canonical":
        raise PreseedError("offline Owner preload is only valid after canonical visual cutover")
    if (receipt.get("os_commit") != sha
            or receipt.get("surface_source_commit") != lock.get("source_commit")
            or receipt.get("surface_source_repository") != lock.get("source_repository")
            or receipt.get("old_os_visual_source_packaged") is not False):
        raise PreseedError("assembled Surface source receipt does not match exact OS lock")
    checkout = rootfs / "workspace/ordax"
    if not checkout.is_dir() or git_head(checkout) != sha:
        raise PreseedError("Creator preloaded Git checkout differs from release owner")
    status = subprocess.run(
        ["git", "-C", str(checkout), "status", "--porcelain"],
        capture_output=True, text=True, check=True,
    )
    if status.stdout.strip():
        raise PreseedError("Owner Git checkout is dirty")
    current = rootfs / "state/ordax/current-commit"
    if not current.is_file() or current.read_text().strip() != sha:
        raise PreseedError("Owner durable current-commit is missing/mismatched")
    for rel in VISUALS:
        visual = assembled / rel
        regular_tree(visual)
    releases = rootfs / "state/ordax/releases"
    if releases.is_symlink() or not releases.parent.is_dir():
        raise PreseedError("Owner release destination is unsafe")
    releases.mkdir(mode=0o755, exist_ok=True)
    slot = releases / sha
    if slot.exists() or slot.is_symlink():
        raise PreseedError("a prepared Owner release cannot be overwritten")
    stage = Path(tempfile.mkdtemp(prefix=".owner-pinned-stage-", dir=releases))
    try:
        shutil.copytree(source, stage / "system", symlinks=False)
        lines = []
        fingerprint = hashlib.sha256()
        count = 0
        for visual in VISUALS:
            folder = stage / visual
            regular_tree(folder)
            for item in sorted(folder.rglob("*"), key=lambda x: os.fsencode(x.relative_to(stage).as_posix())):
                if not item.is_file():
                    continue
                if item.is_symlink():
                    raise PreseedError("unsafe visual symlink")
                name = item.relative_to(stage).as_posix()
                if "\n" in name or "\r" in name or "\\" in name:
                    raise PreseedError("unsupported visual filename")
                payload_digest = hashlib.sha256(item.read_bytes()).digest()
                fingerprint.update(name.encode("utf-8") + b"\0")
                fingerprint.update(payload_digest)
                lines.append(f"{payload_digest.hex()}  {name}\n")
                count += 1
        if count != receipt.get("visual_file_count"):
            raise PreseedError("visual file count differs from verified pinned source")
        if fingerprint.hexdigest() != receipt.get("visual_source_sha256"):
            raise PreseedError("visual bytes differ from the verified pinned source fingerprint")
        (stage / ".surface-file-hashes").write_text("".join(lines), encoding="utf-8")
        (stage / ".sha").write_text(sha + "\n", encoding="ascii")
        (stage / ".surface-source-sha").write_text(lock["source_commit"] + "\n", encoding="ascii")
        (stage / ".ready").write_text("ready\n", encoding="ascii")
        regular_tree(stage)
        os.rename(stage, slot)
        return {"os_commit": sha, "surface_commit": lock["source_commit"], "visual_files": count, "target": str(slot), "physical_device_written": False}
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo-root", type=Path, required=True)
    ap.add_argument("--assembled-root", type=Path, required=True)
    ap.add_argument("--rootfs", type=Path, required=True)
    ap.add_argument("--os-commit", required=True)
    args = ap.parse_args()
    print(json.dumps(preseed(args.repo_root, args.assembled_root, args.rootfs, args.os_commit), sort_keys=True))


if __name__ == "__main__":
    main()
