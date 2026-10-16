#!/usr/bin/env python3
"""Build/verify a Development Base candidate from authenticated component bytes."""

from __future__ import annotations

import argparse
import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import re
import shutil
import sys


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ROOTFS_POLICY = HERE / "independent_rootfs.py"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class CandidateError(RuntimeError):
    pass


def _load_rootfs_policy():
    spec = spec_from_file_location("ordax_dev_base_independent_rootfs", ROOTFS_POLICY)
    if spec is None or spec.loader is None:
        raise CandidateError("Independent rootfs policy cannot be loaded")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rootfs_policy = _load_rootfs_policy()
consumer = rootfs_policy.consumer


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular_file(path: Path, label: str, max_bytes: int) -> Path:
    if path.is_symlink() or not path.is_file():
        raise CandidateError(f"{label} is missing or unsafe")
    size = path.stat().st_size
    if size <= 0 or size > max_bytes:
        raise CandidateError(f"{label} size is outside allowed range")
    return path


def read_json(path: Path, label: str) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise CandidateError(f"{label} is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CandidateError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise CandidateError(f"{label} must be an object")
    return value


def artifact_from_provenance(
    provenance: dict,
    directory: Path,
    *,
    source_commit: str,
    artifact_name: str | None = None,
    artifact_prefix: str | None = None,
    max_bytes: int,
) -> Path:
    if provenance.get("source_commit") != source_commit:
        raise CandidateError("build provenance source commit does not match candidate")
    artifacts = provenance.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        raise CandidateError("build provenance artifact map is invalid")
    if artifact_name is not None:
        names = [artifact_name] if artifact_name in artifacts else []
    else:
        names = [name for name in artifacts if name.startswith(artifact_prefix or "")]
    if len(names) != 1:
        raise CandidateError("build provenance does not bind exactly one requested artifact")
    name = names[0]
    expected = artifacts.get(name)
    if not isinstance(expected, str) or SHA256_RE.fullmatch(expected) is None:
        raise CandidateError("build provenance artifact hash is invalid")
    path = regular_file(directory / name, f"candidate artifact {name}", max_bytes)
    if sha256_file(path) != expected:
        raise CandidateError(f"candidate artifact {name} differs from provenance")
    return path


def validate_independent_rootfs(rootfs_dir: Path, source_commit: str) -> Path:
    rootfs = rootfs_dir / "rootfs.tar"
    provenance = rootfs_dir / "provenance.json"
    try:
        rootfs_policy.validate(
            rootfs=rootfs,
            provenance_path=provenance,
            expected_commit=source_commit,
        )
    except rootfs_policy.IndependentRootfsError as exc:
        raise CandidateError(str(exc)) from exc
    return rootfs


def binding(name: str, path: Path, source_commit: str) -> dict:
    tag = consumer.candidate_tag(source_commit)
    return {
        "name": name,
        "url": (
            f"https://github.com/{consumer.REPOSITORY}/releases/download/"
            f"{tag}/{name}"
        ),
        "sha256": sha256_file(path),
        "size": path.stat().st_size,
    }


def build(
    *,
    source_commit: str,
    kernel_dir: Path,
    initramfs_dir: Path,
    rootfs_dir: Path,
    out_dir: Path,
) -> dict:
    if SHA40_RE.fullmatch(source_commit) is None:
        raise CandidateError("source commit must be lowercase 40-hex")

    kernel_provenance = read_json(
        kernel_dir / "kernel-provenance.json",
        "kernel provenance",
    )
    initramfs_provenance = read_json(
        initramfs_dir / "initramfs-provenance.json",
        "initramfs provenance",
    )
    kernel = artifact_from_provenance(
        kernel_provenance,
        kernel_dir,
        source_commit=source_commit,
        artifact_prefix="vmlinuz-",
        max_bytes=consumer.MAX_KERNEL_BYTES,
    )
    initramfs = artifact_from_provenance(
        initramfs_provenance,
        initramfs_dir,
        source_commit=source_commit,
        artifact_name="initramfs.cpio.gz",
        max_bytes=consumer.MAX_INITRAMFS_BYTES,
    )
    rootfs = validate_independent_rootfs(rootfs_dir, source_commit)

    out_dir.mkdir(parents=True, exist_ok=True)
    for child in out_dir.iterdir():
        raise CandidateError(f"output directory must be empty: {child.name}")

    kernel_out = out_dir / "vmlinuz"
    initramfs_out = out_dir / "initrd.gz"
    rootfs_out = out_dir / "rootfs.tar"
    shutil.copyfile(kernel, kernel_out)
    shutil.copyfile(initramfs, initramfs_out)
    shutil.copyfile(rootfs, rootfs_out)
    if sha256_file(rootfs_out) != sha256_file(rootfs):
        raise CandidateError("Development Base rootfs copy differs from Independent Base")

    descriptor = {
        "$schema": consumer.SCHEMA,
        "status": "development-candidate",
        "source_repository": consumer.REPOSITORY,
        "source_commit": source_commit,
        "tag": consumer.candidate_tag(source_commit),
        "activation": "inactive-slot-next-boot",
        "rootfs_activation": "slot-coupled-one-shot-health-gated",
        "manual_usb_rewrite_required": False,
        "kernel": binding("vmlinuz", kernel_out, source_commit),
        "initramfs": binding("initrd.gz", initramfs_out, source_commit),
        "rootfs": binding("rootfs.tar", rootfs_out, source_commit),
    }
    (out_dir / "dev-base.json").write_text(
        json.dumps(descriptor, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    verify(out_dir)
    return descriptor


def verify(out_dir: Path) -> dict:
    descriptor = read_json(out_dir / "dev-base.json", "development Base descriptor")
    source_commit = descriptor.get("source_commit")
    if not isinstance(source_commit, str) or SHA40_RE.fullmatch(source_commit) is None:
        raise CandidateError("development Base source commit is invalid")
    try:
        canonical = consumer.validate_manifest(descriptor, source_commit)
        consumer.verify_materialized(out_dir, source_commit)
        consumer._validate_rootfs_archive(out_dir / "rootfs.tar")
    except consumer.DevBaseChannelError as exc:
        raise CandidateError(str(exc)) from exc
    return canonical


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--source-commit", required=True)
    build_parser.add_argument("--kernel-dir", type=Path, default=Path("out/kernel"))
    build_parser.add_argument("--initramfs-dir", type=Path, default=Path("out/initramfs"))
    build_parser.add_argument(
        "--rootfs-dir",
        type=Path,
        default=Path("out/independent-base"),
        help="Independent Base artifact directory containing rootfs.tar and provenance.json",
    )
    build_parser.add_argument("--out-dir", type=Path, default=Path("out/dev-base"))
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, default=Path("out/dev-base"))
    args = parser.parse_args()
    try:
        if args.command == "check":
            if consumer.SCHEMA != "prototype-ordax.dev-base-candidate/3":
                raise CandidateError("Dev Channel manifest schema drift")
            print("DEV_BASE_CHANNEL_CONTRACT=PASS")
            return 0
        if args.command == "build":
            result = build(
                source_commit=args.source_commit,
                kernel_dir=args.kernel_dir,
                initramfs_dir=args.initramfs_dir,
                rootfs_dir=args.rootfs_dir,
                out_dir=args.out_dir,
            )
        else:
            result = verify(args.out_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (CandidateError, OSError) as exc:
        print(f"dev-base-candidate: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
