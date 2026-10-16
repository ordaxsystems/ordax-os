#!/usr/bin/env python3
"""Fail-closed reuse of the verified Independent Surface Buildroot artifact."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ".ordax-independent-surface-cache.json"
SCHEMA = "prototype-ordax.independent-surface-component-cache/1"
REUSE_SCHEMA = "prototype-ordax.independent-surface-component-reuse/1"
FINGERPRINT_VERSION = "independent-surface-inputs-v1"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
CONFIG_RELATIVE = "bootstrap/independent-surface-runtime/configs/ordax_surface_defconfig"
INPUTS = (
    "bootstrap/independent-surface-runtime/build.py",
    "bootstrap/independent-surface-runtime/prepare_config.py",
    "bootstrap/independent-surface-runtime/source.json",
    CONFIG_RELATIVE,
    "bootstrap/independent-base/source.json",
    "bootstrap/kernel/source.json",
)


class CacheError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def exact_commit(value: str, label: str) -> str:
    value = value.strip().lower()
    if SHA40.fullmatch(value) is None:
        raise CacheError(f"{label} must be exact lowercase 40-hex")
    return value


def validated_environment(value: str, label: str = "cache environment") -> str:
    value = value.strip()
    if not value or "\n" in value or "\r" in value or len(value) > 256:
        raise CacheError(f"invalid {label}")
    return value


def environment() -> str:
    value = os.environ.get("ORDAX_COMPONENT_CACHE_ENVIRONMENT", "").strip()
    if not value:
        if os.environ.get("GITHUB_ACTIONS", "").lower() == "true":
            raise CacheError("CI cache environment is required")
        return "local-unpinned"
    return validated_environment(value)


def input_files(root: Path = ROOT) -> list[Path]:
    root = root.resolve()
    files: list[Path] = []
    for relative in INPUTS:
        path = root / relative
        if path.is_symlink() or not path.is_file():
            raise CacheError(f"build input is missing or unsafe: {relative}")
        resolved = path.resolve()
        if root not in resolved.parents:
            raise CacheError(f"build input escapes repository: {relative}")
        files.append(resolved)
    return files


def fingerprint(
    root: Path = ROOT,
    *,
    build_environment: str | None = None,
    overrides: dict[str, bytes] | None = None,
) -> str:
    root = root.resolve()
    build_environment = validated_environment(build_environment, "build environment") if build_environment is not None else environment()
    overrides = overrides or {}
    unknown = set(overrides) - set(INPUTS)
    if unknown:
        raise CacheError(f"unknown fingerprint override: {sorted(unknown)}")
    digest = hashlib.sha256()
    digest.update((FINGERPRINT_VERSION + "\0" + build_environment + "\0").encode())
    for path in input_files(root):
        relative = path.relative_to(root).as_posix()
        payload = overrides.get(relative)
        size = len(payload) if payload is not None else path.stat().st_size
        file_digest = hashlib.sha256(payload).hexdigest() if payload is not None else sha256_file(path)
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(str(size).encode("ascii"))
        digest.update(b"\0")
        digest.update(file_digest.encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


def legacy_materialized_fingerprint(root: Path, *, build_environment: str | None = None) -> str:
    """Reproduce the historical v1 identity created after in-place config materialization."""
    root = root.resolve()
    helper = root / "bootstrap/independent-surface-runtime/prepare_config.py"
    spec = importlib.util.spec_from_file_location("ordax_surface_prepare_config_legacy_v1", helper)
    if spec is None or spec.loader is None:
        raise CacheError("cannot load Surface config renderer for v1 cache verification")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        rendered = module.rendered_config().encode("utf-8")
    except Exception as exc:
        raise CacheError(f"cannot reproduce historical materialized Surface config: {exc}") from exc
    return fingerprint(
        root,
        build_environment=build_environment,
        overrides={CONFIG_RELATIVE: rendered},
    )


def provenance(out_dir: Path) -> dict:
    path = out_dir / "provenance.json"
    if path.is_symlink() or not path.is_file():
        raise CacheError("Surface provenance is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CacheError(f"cannot read Surface provenance: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.independent-surface-runtime-provenance/1":
        raise CacheError("unexpected Surface provenance schema")
    return value


def artifact_entries(out_dir: Path) -> dict[str, dict[str, object]]:
    result: dict[str, dict[str, object]] = {}
    for name in ("provenance.json", "native-surface-runtime-buildroot.erofs"):
        path = out_dir / name
        if path.is_symlink() or not path.is_file():
            raise CacheError(f"Surface artifact is missing or unsafe: {name}")
        result[name] = {"sha256": sha256_file(path), "size": path.stat().st_size}
    return result


def record(out_dir: Path, source_commit: str, root: Path = ROOT) -> dict:
    source_commit = exact_commit(source_commit, "source commit")
    out_dir = out_dir.resolve()
    if out_dir.is_symlink() or not out_dir.is_dir():
        raise CacheError("Surface output directory is missing or unsafe")
    manifest_path = out_dir / MANIFEST
    if manifest_path.exists() or manifest_path.is_symlink():
        raise CacheError("Surface cache manifest already exists")
    prov = provenance(out_dir)
    prov_commit = exact_commit(str(prov.get("source_commit", "")), "provenance source commit")
    if prov_commit != source_commit:
        raise CacheError("fresh Surface provenance is not bound to exact source commit")
    value = {
        "$schema": SCHEMA,
        "fingerprint_version": FINGERPRINT_VERSION,
        "input_fingerprint": fingerprint(root),
        "execution_environment": environment(),
        "build_source_commit": source_commit,
        "artifacts": artifact_entries(out_dir),
    }
    manifest_path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return value


def verify(
    out_dir: Path,
    integration_commit: str,
    receipt: Path,
    *,
    cache_hit: bool,
    consumer: bool = False,
    root: Path = ROOT,
) -> dict:
    integration_commit = exact_commit(integration_commit, "integration commit")
    out_dir = out_dir.resolve()
    manifest_path = out_dir / MANIFEST
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise CacheError("Surface cache manifest is missing or unsafe")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CacheError(f"cannot read Surface cache manifest: {exc}") from exc
    if manifest.get("$schema") != SCHEMA or manifest.get("fingerprint_version") != FINGERPRINT_VERSION:
        raise CacheError("Surface cache manifest schema/version mismatch")
    build_environment = validated_environment(
        str(manifest.get("execution_environment", "")),
        "manifest build environment",
    )
    fingerprint_environment = build_environment if consumer else None
    expected_fingerprint = fingerprint(root, build_environment=fingerprint_environment)
    manifest_fingerprint = str(manifest.get("input_fingerprint", ""))
    legacy_materialized_manifest = False
    if manifest_fingerprint != expected_fingerprint:
        historical_fingerprint = legacy_materialized_fingerprint(
            root,
            build_environment=fingerprint_environment,
        )
        if manifest_fingerprint != historical_fingerprint:
            raise CacheError("cached Surface build inputs changed")
        legacy_materialized_manifest = True
    verification_environment = environment()
    if not consumer and build_environment != verification_environment:
        raise CacheError("cached Surface execution environment changed")
    build_commit = exact_commit(str(manifest.get("build_source_commit", "")), "build source commit")
    prov_commit = exact_commit(str(provenance(out_dir).get("source_commit", "")), "provenance source commit")
    if prov_commit != build_commit:
        raise CacheError("cached Surface provenance disagrees with build commit")
    actual = artifact_entries(out_dir)
    expected = manifest.get("artifacts")
    if not isinstance(expected, dict) or set(expected) != set(actual):
        raise CacheError("cached Surface artifact set mismatch")
    for name, current in actual.items():
        saved = expected[name]
        if not isinstance(saved, dict):
            raise CacheError(f"invalid Surface cache entry: {name}")
        if saved.get("sha256") != current["sha256"] or saved.get("size") != current["size"]:
            raise CacheError(f"cached Surface bytes changed: {name}")
        if SHA256.fullmatch(str(saved.get("sha256", ""))) is None:
            raise CacheError(f"invalid Surface digest: {name}")
    if not cache_hit and build_commit != integration_commit:
        raise CacheError("fresh Surface build is not bound to integration commit")
    result = {
        "$schema": REUSE_SCHEMA,
        "status": "verified",
        "input_fingerprint": expected_fingerprint,
        "manifest_input_fingerprint": manifest_fingerprint,
        "legacy_materialized_manifest": legacy_materialized_manifest,
        "execution_environment": build_environment,
        "verification_environment": verification_environment,
        "consumer_verification": bool(consumer),
        "build_source_commit": build_commit,
        "integration_source_commit": integration_commit,
        "reused": bool(cache_hit),
        "provenance_rewritten": False,
        "artifacts": actual,
    }
    receipt = receipt.resolve()
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    fp = sub.add_parser("fingerprint")
    fp.add_argument("--github-output", type=Path)
    rec = sub.add_parser("record")
    rec.add_argument("--out", required=True, type=Path)
    rec.add_argument("--source-commit", required=True)
    ver = sub.add_parser("verify")
    ver.add_argument("--out", required=True, type=Path)
    ver.add_argument("--integration-commit", required=True)
    ver.add_argument("--receipt", required=True, type=Path)
    ver.add_argument("--cache-hit", required=True, choices=("true", "false"))
    ver.add_argument("--consumer", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "fingerprint":
            value = fingerprint()
            print(value)
            if args.github_output:
                with args.github_output.open("a", encoding="utf-8", newline="\n") as handle:
                    handle.write(f"fingerprint={value}\n")
        elif args.command == "record":
            print(json.dumps(record(args.out, args.source_commit), sort_keys=True))
        else:
            print(json.dumps(verify(
                args.out,
                args.integration_commit,
                args.receipt,
                cache_hit=args.cache_hit == "true",
                consumer=args.consumer,
            ), sort_keys=True))
        return 0
    except (CacheError, OSError) as exc:
        print(f"independent-surface-component-cache: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
