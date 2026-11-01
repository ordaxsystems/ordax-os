#!/usr/bin/env python3
"""Verify an immutable Intelligence checkout and stage source without touching the OS."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
LOCK_PATH = ROOT / "docs/contracts/intelligence-source.json"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SCHEMA = "prototype-ordax.intelligence-source/1"
REPO = "ordaxsystems/ordax-intelligence"
TARGET = "system/intelligence-source/src"
SOURCE_ROOT = "src"
BUILDER_PATH = "tools/inference-builder/build.py"
REQUIRED_SOURCE_PATHS = frozenset((
    "src/index.mjs",
    "src/contract-bindings.mjs",
    BUILDER_PATH,
))
MAX_SOURCE_FILES = 64
MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_BYTES = 1024 * 1024

class IntelligenceSourceError(ValueError):
    pass

def git(root: Path, *args: str) -> bytes:
    p = subprocess.run(["git", "-C", str(root), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if p.returncode:
        raise IntelligenceSourceError("immutable Intelligence Git checkout cannot be verified")
    return p.stdout

def _portable_source_path(value: object) -> bool:
    if not isinstance(value, str):
        return False
    path = PurePosixPath(value)
    return (
        str(path) == value
        and not path.is_absolute()
        and ".." not in path.parts
        and (
            value == BUILDER_PATH
            or (value.startswith(SOURCE_ROOT + "/") and path.suffix == ".mjs")
        )
    )

def source_tree_blobs(root: Path, revision: str = "HEAD") -> dict[str, str]:
    """Return the complete portable source graph at one immutable Git tree.

    Every tracked module below ``src/`` is product source and must be pinned.
    The technical inference builder is the only consumed file below its tools
    directory; optional platform-specific builders remain independently owned.
    """
    raw = git(
        root, "ls-tree", "-rz", "-r", revision, "--", SOURCE_ROOT, BUILDER_PATH,
    )
    result: dict[str, str] = {}
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        try:
            meta, relative = entry.split(b"\t", 1)
            mode, kind, blob = meta.decode("ascii").split()
            filename = relative.decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise IntelligenceSourceError("malformed portable Intelligence Git tree") from exc
        if (
            not _portable_source_path(filename)
            or filename in result
            or mode != "100644"
            or kind != "blob"
            or not SHA40.fullmatch(blob)
        ):
            raise IntelligenceSourceError(
                "unexpected, linked or executable portable Intelligence source: " + filename
            )
        result[filename] = blob
    if (
        not REQUIRED_SOURCE_PATHS.issubset(result)
        or len(result) > MAX_SOURCE_FILES
    ):
        raise IntelligenceSourceError("portable Intelligence source graph is incomplete or unbounded")
    return result

def load_lock(path: Path = LOCK_PATH) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise IntelligenceSourceError("Intelligence source lock missing or unreadable") from exc
    if value.get("$schema") != SCHEMA or value.get("source_repository") != REPO:
        raise IntelligenceSourceError("untrusted Intelligence source identity")
    if value.get("status") not in ("integration-candidate", "canonical"):
        raise IntelligenceSourceError("unrecognized Intelligence source status")
    if not isinstance(value.get("source_commit"), str) or not SHA40.fullmatch(value["source_commit"]):
        raise IntelligenceSourceError("Intelligence revision must be a lowercase full Git SHA")
    if value.get("materialization_target") != TARGET or value.get("source_only") is not True or value.get("change_live_os") is not False or value.get("activation_authorized") is not False:
        raise IntelligenceSourceError("source-only, inactive staging policy is not valid")
    if value.get("public_ports") != ["ordax.intelligence/1", "ordax.model-router/1", "ordax.local-ai/1"]:
        raise IntelligenceSourceError("public port contract changed without versioning")
    expected = value.get("source_paths")
    if (
        not isinstance(expected, dict)
        or not REQUIRED_SOURCE_PATHS.issubset(expected)
        or not expected
        or len(expected) > MAX_SOURCE_FILES
        or not all(_portable_source_path(path) for path in expected)
    ):
        raise IntelligenceSourceError("Intelligence source pin has an invalid portable graph")
    if not all(isinstance(v, str) and SHA40.fullmatch(v) for v in expected.values()):
        raise IntelligenceSourceError("unverified Git blob in source pin")
    return value

def git_blob_sha(blob: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(blob)).encode("ascii") + b"\0" + blob).hexdigest()

def verify_source(root: Path, lock: dict) -> tuple[list[tuple[str, bytes]], dict]:
    if root.is_symlink() or not root.is_dir():
        raise IntelligenceSourceError("Intelligence source must be a real Git directory")
    root = root.resolve(strict=True)
    revision = git(root, "rev-parse", "HEAD").decode("ascii").strip()
    if revision != lock["source_commit"]:
        raise IntelligenceSourceError("checkout revision does not match immutable OS source lock")
    if git(root, "status", "--porcelain", "--untracked-files=all", "--", "src", "tools/inference-builder"):
        raise IntelligenceSourceError("tracked/untracked Intelligence source is modified")
    # Pin every portable module in the immutable commit. Files outside the
    # portable graph (for example a Windows-only builder) never enter the OS
    # release slot, while a newly imported src module cannot be omitted.
    tree = source_tree_blobs(root)
    expected = set(lock["source_paths"])
    if tree != lock["source_paths"]:
        raise IntelligenceSourceError("portable source graph differs from immutable OS pin")
    result = []
    total = 0
    fingerprint = hashlib.sha256()
    for filename in sorted(expected):
        expected_sha = tree[filename]
        path = root / filename
        file_stat = path.lstat()
        # The Git tree mode above is the executable-bit authority. Windows
        # represents writable/read-only regular files as 0666/0444 instead of
        # POSIX 0644/0444, so accept those native modes while preserving the
        # exact 100644 Git mode and normalizing every staged file to 0644.
        allowed_modes = (0o644, 0o664, 0o600)
        if os.name == "nt":
            allowed_modes += (0o666, 0o444)
        if (path.is_symlink() or not stat.S_ISREG(file_stat.st_mode)
                or stat.S_IMODE(file_stat.st_mode) not in allowed_modes):
            raise IntelligenceSourceError("source file must be a regular readable Git blob")
        payload = path.read_bytes()
        total += len(payload)
        if len(payload) > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
            raise IntelligenceSourceError("source exceeds configured size bounds")
        actual = git_blob_sha(payload)
        if actual != expected_sha or actual != lock["source_paths"][filename]:
            raise IntelligenceSourceError("Git content does not match pinned source blob: " + filename)
        fingerprint.update(filename.encode("utf-8") + b"\0" + hashlib.sha256(payload).digest())
        result.append((filename, payload))
    if len(result) != len(expected):
        raise IntelligenceSourceError("missing Intelligence source files")
    receipt = {
        "$schema":"ordax.intelligence-source-materialization/1",
        "source_repository":REPO,
        "source_commit":revision,
        "public_ports":lock["public_ports"],
        "source_file_count":len(result),
        "source_sha256":fingerprint.hexdigest(),
        "target":TARGET,
        "source_only":True,
        "model_included":False,
        "engine_included":False,
        "activation_authorized":False,
        "live_os_mutated":False,
    }
    return result, receipt

def stage_source(records: list[tuple[str,bytes]], receipt: dict, output: Path, source_root: Path) -> None:
    output = output.absolute()
    parent = output.parent.resolve(strict=True)
    if source_root.is_symlink():
        raise IntelligenceSourceError("source checkout must not be linked")
    src = source_root.resolve(strict=True)
    destination = output.resolve(strict=False)
    # Resolve every ancestor, not only the final path: an intermediate symlink
    # must never redirect staging into a source checkout.
    if os.path.commonpath((str(destination), str(src))) == str(src):
        raise IntelligenceSourceError("staging must not alter source checkout")
    if output.exists() or output.is_symlink():
        raise IntelligenceSourceError("stage cannot overwrite an existing path")
    if output.parent.is_symlink() or not output.parent.is_dir():
        raise IntelligenceSourceError("stage parent must be real")
    stage = Path(tempfile.mkdtemp(prefix=".intelligence-verified-", dir=parent))
    try:
        for name, payload in records:
            destination = stage / "system/intelligence-source" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(payload)
            destination.chmod(0o644)
        (stage / "intelligence-source-receipt.json").write_text(json.dumps(receipt,sort_keys=True,indent=2)+"\n", encoding="utf-8")
        if output.exists() or output.is_symlink():
            raise IntelligenceSourceError("concurrent staging destination appeared")
        os.rename(stage, output)
    finally:
        if stage.exists():
            shutil.rmtree(stage)

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=("verify","stage"))
    parser.add_argument("--source-dir",type=Path,required=True)
    parser.add_argument("--lock",type=Path,default=LOCK_PATH)
    parser.add_argument("--out-dir",type=Path)
    args=parser.parse_args()
    if (args.command=="stage") != (args.out_dir is not None):
        parser.error("stage requires --out-dir; verify forbids it")
    pinned=load_lock(args.lock)
    records,receipt=verify_source(args.source_dir,pinned)
    if args.command=="stage":
        stage_source(records,receipt,args.out_dir,args.source_dir)
    print(json.dumps(receipt,sort_keys=True))
if __name__=="__main__":
    main()
