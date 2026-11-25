#!/usr/bin/env python3
"""Build/verify an immutable development Base descriptor from CI-built bytes."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

SCHEMA = "prototype-ordax.dev-base-candidate/4"
REPOSITORY = "ordaxsystems/ordax-os"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_KERNEL_BYTES = 64 * 1024 * 1024
MAX_INITRAMFS_BYTES = 128 * 1024 * 1024
MAX_ROOTFS_BYTES = 384 * 1024 * 1024
REQUIRED_ROOTFS_PATHS = (
    "bin/busybox",
    "bin/sh",
    "usr/bin/git",
    "sbin/ordax-dev-init",
    "usr/local/bin/ordax-network",
    "usr/local/bin/ordax-pull",
    "usr/local/bin/ordax-checkout-exchange",
    "usr/local/bin/ordax-usb-mountattr",
    "usr/local/bin/ordax-rollback",
    "usr/local/bin/ordax-run",
)
REQUIRED_ROOTFS_DIRS = (
    "state",
    "workspace",
    "home",
    "proc",
    "sys",
    "dev",
    "run",
)


class CandidateError(RuntimeError):
    pass


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


def validate_rootfs_source(
    rootfs_dir: Path, source_commit: str, owner_reuse_receipt: Path | None = None
) -> Path:
    """Accept only the canonical authenticated Independent Owner rootfs archive."""
    provenance = read_json(rootfs_dir / "provenance.json", "development rootfs provenance")
    if provenance.get("$schema") != "prototype-ordax.independent-base-provenance/1":
        raise CandidateError(
            "development rootfs must use canonical Independent Base provenance"
        )

    policy_file = Path(__file__).resolve().parent / "independent_rootfs.py"
    spec = importlib.util.spec_from_file_location(
        "ordax_channel_independent_rootfs", policy_file
    )
    if spec is None or spec.loader is None:
        raise CandidateError("canonical Independent rootfs verifier is unavailable")
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    try:
        policy.validate(
            rootfs=rootfs_dir / "rootfs.tar",
            provenance_path=rootfs_dir / "provenance.json",
            expected_commit=source_commit,
            reuse_receipt=owner_reuse_receipt,
        )
    except (policy.IndependentRootfsError, OSError) as exc:
        raise CandidateError(f"Independent Owner rootfs failed verification: {exc}") from exc
    return regular_file(
        rootfs_dir / "rootfs.tar",
        "authenticated Independent Owner rootfs",
        MAX_ROOTFS_BYTES,
    )

def verify_rootfs_transport(path: Path, content_binding: dict) -> None:
    """Verify the compressed transport and its exact Buildroot tar contents."""
    regular_file(path, "development rootfs transport", MAX_ROOTFS_BYTES)
    consumer_path = (
        Path(__file__).resolve().parents[2]
        / "system/services/base-update/dev_channel.py"
    )
    spec = importlib.util.spec_from_file_location(
        "ordax_channel_candidate_consumer", consumer_path
    )
    if spec is None or spec.loader is None:
        raise CandidateError("canonical Dev Channel consumer is unavailable")
    consumer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(consumer)
    try:
        consumer._validate_rootfs_archive(path, compressed=True)
        consumer.verify_rootfs_content(
            path, {"$schema": consumer.SCHEMA, "rootfs": content_binding},
        )
    except consumer.DevBaseChannelError as exc:
        raise CandidateError(f"Dev Channel rejected compressed rootfs: {exc}") from exc


def compress_rootfs_transport(rootfs: Path, destination: Path) -> None:
    """Write the deterministic gzip transport used by published Base candidates."""
    with rootfs.open("rb") as source, destination.open("xb") as output:
        with gzip.GzipFile(
            filename="", mode="wb", fileobj=output, compresslevel=6, mtime=0,
        ) as compressed:
            shutil.copyfileobj(source, compressed, length=1024 * 1024)


def _consumer_module():
    consumer_path = (
        Path(__file__).resolve().parents[2]
        / "system/services/base-update/dev_channel.py"
    )
    spec = importlib.util.spec_from_file_location(
        "ordax_dev_base_measurement_consumer", consumer_path
    )
    if spec is None or spec.loader is None:
        raise CandidateError("canonical Dev Channel consumer is unavailable")
    consumer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(consumer)
    return consumer


def _installed_tree_sizes(root: Path) -> tuple[int, int]:
    """Return logical payload and allocated bytes for an extracted rootfs tree."""
    logical = 0
    allocated = 0
    seen: set[tuple[int, int]] = set()
    for path in (root, *root.rglob("*")):
        metadata = path.lstat()
        identity = (metadata.st_dev, metadata.st_ino)
        if identity in seen:
            continue
        seen.add(identity)
        if stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            logical += metadata.st_size
        blocks = getattr(metadata, "st_blocks", None)
        allocated += blocks * 512 if blocks is not None else metadata.st_size
    return logical, allocated


def measure_rootfs_transport(
    *,
    rootfs_dir: Path,
    source_commit: str,
    owner_reuse_receipt: Path | None = None,
    receipt_path: Path | None = None,
) -> dict:
    """Measure real download and staged-install bytes through the canonical consumer."""
    rootfs = validate_rootfs_source(rootfs_dir, source_commit, owner_reuse_receipt)
    raw_bytes = rootfs.stat().st_size
    raw_sha256 = sha256_file(rootfs)
    consumer = _consumer_module()
    with tempfile.TemporaryDirectory(prefix="ordax-dev-base-measure-") as temporary:
        temporary_root = Path(temporary)
        transport = temporary_root / "rootfs.tar.gz"
        installed = temporary_root / "installed"
        installed.mkdir()
        compress_rootfs_transport(rootfs, transport)
        expected = {"size": raw_bytes, "sha256": raw_sha256}
        consumer._validate_rootfs_archive(transport, compressed=True)
        consumer._extract_compressed_rootfs(transport, installed, expected)
        consumer._verify_materialized_tree(installed)
        installed_logical_bytes, installed_allocated_bytes = _installed_tree_sizes(installed)
        download_bytes = transport.stat().st_size

    measurement = {
        "$schema": "prototype-ordax.dev-base-storage-measurement/1",
        "status": "verified-canonical-consumer-materialization",
        "source_commit": source_commit,
        "raw_archive_bytes": raw_bytes,
        "download_bytes": download_bytes,
        "download_saved_bytes": raw_bytes - download_bytes,
        "download_saved_percent": round((raw_bytes - download_bytes) * 100 / raw_bytes, 2),
        "installed_logical_bytes": installed_logical_bytes,
        "installed_allocated_bytes": installed_allocated_bytes,
        # The old version remains available for rollback while the download
        # and unpublished extraction coexist; this is the new-candidate peak.
        "peak_candidate_bytes_with_rollback_preserved": download_bytes + installed_allocated_bytes,
        "previous_rollback_slot_included": False,
    }
    if receipt_path is not None:
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        receipt_path.write_text(
            json.dumps(measurement, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return measurement


def binding(name: str, path: Path, source_commit: str) -> dict:
    tag = f"ordax-dev-base-{source_commit}"
    return {
        "name": name,
        "url": (
            f"https://github.com/{REPOSITORY}/releases/download/"
            f"{tag}/{name}"
        ),
        "sha256": sha256_file(path),
        "size": path.stat().st_size,
    }


def verified_kernel_provenance_commit(
    kernel_provenance: dict,
    kernel_dir: Path,
    integration_commit: str,
    kernel_reuse_receipt: Path | None,
) -> str:
    """Bind cached kernel bytes to the current commit without rewriting origin."""
    built_at = kernel_provenance.get("source_commit")
    if not isinstance(built_at, str) or SHA40_RE.fullmatch(built_at) is None:
        raise CandidateError("kernel provenance source commit is invalid")
    if kernel_reuse_receipt is None:
        if built_at != integration_commit:
            raise CandidateError("reused kernel requires an exact integration receipt")
        return built_at

    receipt = read_json(kernel_reuse_receipt, "kernel integration receipt")
    if (receipt.get("$schema") != "prototype-ordax.portable-component-reuse/1"
            or receipt.get("status") != "verified"
            or receipt.get("component") != "kernel"
            or receipt.get("build_source_commit") != built_at
            or receipt.get("integration_source_commit") != integration_commit
            or receipt.get("provenance_rewritten") is not False
            or type(receipt.get("reused")) is not bool):
        raise CandidateError("kernel integration receipt identity is invalid")

    # The canonical verifier recalculates every cached artifact hash, the
    # source-input fingerprint and runner environment. A receipt alone is
    # never sufficient to authorize an old kernel for a newer commit.
    verifier_path = Path(__file__).resolve().parents[2] / "tools/ci/portable_component_cache.py"
    spec = importlib.util.spec_from_file_location("ordax_dev_base_kernel_cache", verifier_path)
    if spec is None or spec.loader is None:
        raise CandidateError("canonical kernel cache verifier is unavailable")
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    try:
        verified = verifier.verify_component(
            "kernel",
            kernel_dir,
            integration_commit,
            kernel_reuse_receipt,
            cache_hit=receipt["reused"],
        )
    except verifier.CacheError as exc:
        raise CandidateError("kernel integration receipt validation failed: " + str(exc)) from exc
    if (verified.get("build_source_commit") != built_at
            or verified.get("integration_source_commit") != integration_commit
            or verified.get("provenance_rewritten") is not False):
        raise CandidateError("verified kernel reuse identity changed")
    return built_at


def build(
    *,
    source_commit: str,
    kernel_dir: Path,
    initramfs_dir: Path,
    rootfs_dir: Path,
    out_dir: Path,
    kernel_reuse_receipt: Path | None = None,
    owner_reuse_receipt: Path | None = None,
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
    kernel_origin = verified_kernel_provenance_commit(
        kernel_provenance,
        kernel_dir,
        source_commit,
        kernel_reuse_receipt,
    )
    kernel = artifact_from_provenance(
        kernel_provenance,
        kernel_dir,
        source_commit=kernel_origin,
        artifact_prefix="vmlinuz-",
        max_bytes=MAX_KERNEL_BYTES,
    )
    initramfs = artifact_from_provenance(
        initramfs_provenance,
        initramfs_dir,
        source_commit=source_commit,
        artifact_name="initramfs.cpio.gz",
        max_bytes=MAX_INITRAMFS_BYTES,
    )
    if owner_reuse_receipt is not None:
        # Receipt presence never overrides the canonical fingerprint and
        # all-artifact SHA-256 verification on the current checkout.
        verifier_path = Path(__file__).resolve().parents[2] / "tools/ci/portable_component_cache.py"
        spec = importlib.util.spec_from_file_location("ordax_dev_base_owner_cache", verifier_path)
        if spec is None or spec.loader is None:
            raise CandidateError("canonical Owner cache verifier unavailable")
        verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verifier)
        claimed = read_json(owner_reuse_receipt, "Owner integration receipt")
        reused = claimed.get("reused")
        if type(reused) is not bool:
            raise CandidateError("Owner integration receipt lacks reuse identity")
        try:
            verified = verifier.verify_component(
                "independent-base-owner", rootfs_dir,
                source_commit, owner_reuse_receipt,
                cache_hit=reused,
            )
        except verifier.CacheError as exc:
            raise CandidateError("Owner integration receipt verification failed: " + str(exc)) from exc
        if verified.get("provenance_rewritten") is not False:
            raise CandidateError("Owner origin must not be rewritten")
    rootfs = validate_rootfs_source(rootfs_dir, source_commit, owner_reuse_receipt)

    out_dir.mkdir(parents=True, exist_ok=True)
    for child in out_dir.iterdir():
        raise CandidateError(f"output directory must be empty: {child.name}")

    kernel_out = out_dir / "vmlinuz"
    initramfs_out = out_dir / "initrd.gz"
    rootfs_out = out_dir / "rootfs.tar.gz"
    shutil.copyfile(kernel, kernel_out)
    shutil.copyfile(initramfs, initramfs_out)
    # Keep the Buildroot tar as the content identity, but publish only its
    # deterministic gzip transport. No second rootfs or tar producer exists.
    compress_rootfs_transport(rootfs, rootfs_out)

    tag = f"ordax-dev-base-{source_commit}"
    descriptor = {
        "$schema": SCHEMA,
        "status": "development-candidate",
        "source_repository": REPOSITORY,
        "source_commit": source_commit,
        "tag": tag,
        "activation": "inactive-slot-next-boot",
        "rootfs_activation": "slot-coupled-one-shot-health-gated",
        "manual_usb_rewrite_required": False,
        "kernel": binding("vmlinuz", kernel_out, source_commit),
        "initramfs": binding("initrd.gz", initramfs_out, source_commit),
        "rootfs": {
            "name": "rootfs.tar",
            "sha256": sha256_file(rootfs),
            "size": rootfs.stat().st_size,
        },
        "rootfs_transport": binding("rootfs.tar.gz", rootfs_out, source_commit),
    }
    (out_dir / "dev-base.json").write_text(
        json.dumps(descriptor, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    verify(out_dir)
    return descriptor


def validate_binding(value: object, expected_name: str, source_commit: str) -> dict:
    if not isinstance(value, dict) or set(value) != {"name", "url", "sha256", "size"}:
        raise CandidateError(f"{expected_name} binding is malformed")
    if value["name"] != expected_name:
        raise CandidateError(f"{expected_name} binding name is invalid")
    tag = f"ordax-dev-base-{source_commit}"
    expected_url = (
        f"https://github.com/{REPOSITORY}/releases/download/{tag}/{expected_name}"
    )
    if value["url"] != expected_url:
        raise CandidateError(f"{expected_name} binding URL is not canonical")
    if not isinstance(value["sha256"], str) or SHA256_RE.fullmatch(value["sha256"]) is None:
        raise CandidateError(f"{expected_name} binding hash is invalid")
    if not isinstance(value["size"], int) or isinstance(value["size"], bool) or value["size"] <= 0:
        raise CandidateError(f"{expected_name} binding size is invalid")
    return value


def validate_descriptor(value: object) -> dict:
    expected = {
        "$schema",
        "status",
        "source_repository",
        "source_commit",
        "tag",
        "activation",
        "rootfs_activation",
        "manual_usb_rewrite_required",
        "kernel",
        "initramfs",
        "rootfs",
        "rootfs_transport",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise CandidateError("development Base descriptor fields are not canonical")
    if value["$schema"] != SCHEMA or value["status"] != "development-candidate":
        raise CandidateError("unsupported development Base descriptor")
    if value["source_repository"] != REPOSITORY:
        raise CandidateError("development Base source repository is invalid")
    source_commit = value["source_commit"]
    if not isinstance(source_commit, str) or SHA40_RE.fullmatch(source_commit) is None:
        raise CandidateError("development Base source commit is invalid")
    if value["tag"] != f"ordax-dev-base-{source_commit}":
        raise CandidateError("development Base tag is invalid")
    if value["activation"] != "inactive-slot-next-boot":
        raise CandidateError("development Base activation policy is invalid")
    if value["rootfs_activation"] != "slot-coupled-one-shot-health-gated":
        raise CandidateError("development Base rootfs activation policy is invalid")
    if value["manual_usb_rewrite_required"] is not False:
        raise CandidateError("development Base unexpectedly requires USB rewrite")
    validate_binding(value["kernel"], "vmlinuz", source_commit)
    validate_binding(value["initramfs"], "initrd.gz", source_commit)
    content = value["rootfs"]
    if not isinstance(content, dict) or set(content) != {"name", "sha256", "size"}:
        raise CandidateError("development Base rootfs content binding is malformed")
    if content["name"] != "rootfs.tar":
        raise CandidateError("development Base rootfs content name is invalid")
    if not isinstance(content["sha256"], str) or SHA256_RE.fullmatch(content["sha256"]) is None:
        raise CandidateError("development Base rootfs content hash is invalid")
    if (not isinstance(content["size"], int) or isinstance(content["size"], bool)
            or content["size"] <= 0 or content["size"] > MAX_ROOTFS_BYTES):
        raise CandidateError("development Base rootfs content size is invalid")
    validate_binding(value["rootfs_transport"], "rootfs.tar.gz", source_commit)
    return value


def verify(out_dir: Path) -> dict:
    descriptor = validate_descriptor(
        read_json(out_dir / "dev-base.json", "development Base descriptor")
    )
    for key, max_bytes in (
        ("kernel", MAX_KERNEL_BYTES),
        ("initramfs", MAX_INITRAMFS_BYTES),
    ):
        item = descriptor[key]
        path = regular_file(
            out_dir / item["name"],
            f"development Base {key}",
            max_bytes,
        )
        if path.stat().st_size != item["size"] or sha256_file(path) != item["sha256"]:
            raise CandidateError(f"development Base {key} differs from descriptor")
    transport = descriptor["rootfs_transport"]
    path = regular_file(
        out_dir / transport["name"], "development Base rootfs transport", MAX_ROOTFS_BYTES,
    )
    if path.stat().st_size != transport["size"] or sha256_file(path) != transport["sha256"]:
        raise CandidateError("development Base rootfs transport differs from descriptor")
    verify_rootfs_transport(path, descriptor["rootfs"])
    return descriptor


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--source-commit", required=True)
    build_parser.add_argument("--kernel-dir", type=Path, default=Path("out/kernel"))
    build_parser.add_argument("--kernel-reuse-receipt", type=Path)
    build_parser.add_argument("--owner-reuse-receipt", type=Path)
    build_parser.add_argument("--initramfs-dir", type=Path, default=Path("out/initramfs"))
    build_parser.add_argument("--rootfs-dir", type=Path, default=Path("out/dev-rootfs"))
    build_parser.add_argument("--out-dir", type=Path, default=Path("out/dev-base"))
    measure_parser = sub.add_parser("measure-rootfs")
    measure_parser.add_argument("--source-commit", required=True)
    measure_parser.add_argument("--rootfs-dir", type=Path, required=True)
    measure_parser.add_argument("--owner-reuse-receipt", type=Path)
    measure_parser.add_argument("--receipt", type=Path, required=True)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, default=Path("out/dev-base"))
    args = parser.parse_args()
    try:
        if args.command == "check":
            print("DEV_BASE_CHANNEL_CONTRACT=PASS")
            return 0
        if args.command == "build":
            result = build(
                source_commit=args.source_commit,
                kernel_dir=args.kernel_dir,
                kernel_reuse_receipt=args.kernel_reuse_receipt,
                owner_reuse_receipt=args.owner_reuse_receipt,
                initramfs_dir=args.initramfs_dir,
                rootfs_dir=args.rootfs_dir,
                out_dir=args.out_dir,
            )
            raw_bytes = result["rootfs"]["size"]
            transport_bytes = result["rootfs_transport"]["size"]
            saved_bytes = raw_bytes - transport_bytes
            print(
                "DEV_BASE_ROOTFS_TRANSPORT="
                f"raw_bytes:{raw_bytes} compressed_bytes:{transport_bytes} "
                f"saved_bytes:{saved_bytes} "
                f"saved_percent:{saved_bytes * 100 / raw_bytes:.2f}",
                flush=True,
            )
        elif args.command == "measure-rootfs":
            result = measure_rootfs_transport(
                rootfs_dir=args.rootfs_dir,
                source_commit=args.source_commit,
                owner_reuse_receipt=args.owner_reuse_receipt,
                receipt_path=args.receipt,
            )
            print("DEV_BASE_STORAGE_MEASUREMENT=" + json.dumps(result, sort_keys=True), flush=True)
        else:
            result = verify(args.out_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (CandidateError, OSError) as exc:
        print(f"dev-base-candidate: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
