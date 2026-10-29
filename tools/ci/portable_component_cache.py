#!/usr/bin/env python3
"""Fail-closed, content-addressed reuse for expensive Portable CI components.

Cached artifacts keep the provenance emitted by their original verified build.
A cache hit never rewrites that provenance. Instead this helper emits a separate
integration receipt proving that the current exact source resolves to the same
build-affecting inputs and execution environment, and that every restored byte
matches the immutable cache manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
CACHE_MANIFEST = ".ordax-component-cache.json"
SCHEMA = "prototype-ordax.portable-component-cache/1"
REUSE_SCHEMA = "prototype-ordax.portable-component-reuse/1"
FINGERPRINT_VERSION = "portable-component-inputs-v2"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class CacheError(RuntimeError):
    pass


# Only build-affecting repository inputs belong here. Verification code is
# intentionally excluded when it can be rerun against cached bytes. That keeps
# verification changes fail-closed without forcing an unrelated recompilation.
PROVENANCE_FILES = {
    "kernel": "kernel-provenance.json",
    "independent-base": "provenance.json",
    "independent-base-owner": "provenance.json",
    "local-ai": "local-ai-runtime-provenance.json",
}


COMPONENTS = {
    "kernel": {
        "inputs": (
            "bootstrap/kernel/build.py",
            "bootstrap/kernel/verify_upstream_signature.py",
            "bootstrap/kernel/source.json",
            "docs/contracts/kernel-build-environment.json",
        ),
    },
    "independent-base": {
        "inputs": (
            "bootstrap/independent-base/build.py",
            "bootstrap/independent-base/source.json",
            "bootstrap/independent-base/Config.in",
            "bootstrap/independent-base/external.desc",
            "bootstrap/independent-base/external.mk",
            "bootstrap/independent-base/configs",
            "bootstrap/independent-base/overlay",
            "bootstrap/independent-base/patches",
            "bootstrap/independent-base/post-build.sh",
            "bootstrap/independent-base/post-image.sh",
            "bootstrap/kernel/source.json",
            "bootstrap/stable-base/source.json",
            "bootstrap/network/source.json",
            "bootstrap/network/bring-up",
            "bootstrap/network/udhcpc.script",
            "docs/contracts/portable-boot-handoff.json",
        ),
    },
    "local-ai": {
        "inputs": (
            # The external builder is immutable by its OS-owned exact commit
            # and eight Git blob locks. This lock MUST invalidate any cached
            # EROFS when the external builder source changes.
            "docs/contracts/intelligence-source.json",
            "tools/intelligence-source/materialize.py",
            ".github/actions/resolve-intelligence-builder/action.yml",
            # Retained only for cross-verification until signed v4 cutover.
            "bootstrap/local-ai-runtime/build.py",
            "system/services/local-ai/source-lock.json",
            "docs/contracts/local-ai.json",
        ),
    },
    "release-agent": {
        "inputs": ("bootstrap/release-acquisition",),
    },
}

# Use the canonical Independent Base producer. Owner extends its input graph
# with the actual installed Dev helpers, firmware and kernel module installer.
# No second build path, and no reuse of the minimal-profile fingerprint.
COMPONENTS["independent-base-owner"] = {
    "inputs": COMPONENTS["independent-base"]["inputs"] + (
        "bootstrap/base/firmware_policy.py",
        "bootstrap/base/kernel_module_payload.py",
        "bootstrap/dev-base/ordax-dev-init",
        "bootstrap/dev-base/ordax-network",
        "bootstrap/dev-base/ordax-pull",
        "bootstrap/dev-base/ordax-rollback",
        "bootstrap/dev-base/ordax-run",
        "bootstrap/dev-base/ordax-diagnose",
        "bootstrap/dev-base/ordax_usb_mountattr.c",
        "bootstrap/dev-base/ordax_checkout_exchange.c",
        "bootstrap/recovery/entrypoint",
    ),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_repo_path(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise CacheError(f"unsafe repository input path: {relative!r}")
    root = root.resolve()
    lexical = root / relative
    if lexical.is_symlink():
        raise CacheError(f"component input must not be a symlink: {relative}")
    path = lexical.resolve()
    if path != root and root not in path.parents:
        raise CacheError(f"repository input escapes root: {relative}")
    return path


def _add_input(files: dict[str, Path], root: Path, path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError:
            relative = str(path)
        raise CacheError(f"component input is missing or unsafe: {relative}")
    relative = path.relative_to(root).as_posix()
    files[relative] = path


def _iter_input_files(root: Path, component: str) -> list[Path]:
    if component not in COMPONENTS:
        raise CacheError(f"unsupported component: {component}")
    root = root.resolve()
    files: dict[str, Path] = {}

    for relative in COMPONENTS[component]["inputs"]:
        path = _safe_repo_path(root, relative)
        if path.is_file():
            _add_input(files, root, path)
            continue
        if not path.is_dir():
            raise CacheError(f"component input is missing: {relative}")
        for candidate in sorted(path.rglob("*"), key=lambda item: item.as_posix()):
            if candidate.is_symlink():
                raise CacheError(
                    f"component input tree contains symlink: {candidate.relative_to(root).as_posix()}"
                )
            if not candidate.is_file():
                continue
            if component == "release-agent":
                # go test always runs from the current checkout. Test files,
                # README and maintenance scripts do not affect the compiled
                # release-agent binary and therefore must not invalidate it.
                if candidate.name in {"go.mod", "go.sum"}:
                    _add_input(files, root, candidate)
                elif candidate.suffix == ".go" and not candidate.name.endswith("_test.go"):
                    _add_input(files, root, candidate)
            else:
                _add_input(files, root, candidate)

    if component == "kernel":
        source_path = root / "bootstrap/kernel/source.json"
        try:
            source = json.loads(source_path.read_text(encoding="utf-8"))
            fragment_relative = source["configuration"]["fragment"]
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
            raise CacheError(f"cannot resolve kernel Kconfig input: {exc}") from exc
        fragment = _safe_repo_path(root, fragment_relative)
        _add_input(files, root, fragment)

    if component == "local-ai":
        lock_path = root / "system/services/local-ai/source-lock.json"
        try:
            lock = json.loads(lock_path.read_text(encoding="utf-8"))
            license_relative = lock["model"]["license_text_path"]
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
            raise CacheError(f"cannot resolve local AI license input: {exc}") from exc
        license_path = _safe_repo_path(root, license_relative)
        _add_input(files, root, license_path)

    if not files:
        raise CacheError(f"component has no fingerprint inputs: {component}")
    return [files[key] for key in sorted(files)]


def execution_environment() -> str:
    value = os.environ.get("ORDAX_COMPONENT_CACHE_ENVIRONMENT", "").strip()
    if not value:
        if os.environ.get("GITHUB_ACTIONS", "").lower() == "true":
            raise CacheError("CI component reuse requires ORDAX_COMPONENT_CACHE_ENVIRONMENT")
        return "local-unpinned"
    if "\n" in value or "\r" in value or len(value) > 256:
        raise CacheError("invalid component cache execution environment")
    return value


def component_fingerprint(component: str, root: Path = ROOT) -> str:
    root = root.resolve()
    environment = execution_environment()
    digest = hashlib.sha256()
    digest.update(
        (FINGERPRINT_VERSION + "\0" + component + "\0" + environment + "\0").encode("utf-8")
    )
    if component == "independent-base-owner":
        # The installed module bytes depend on the separately verified kernel.
        # Pin that entire compiler/config graph rather than its version alone.
        digest.update(b"kernel-component\0")
        digest.update(component_fingerprint("kernel", root).encode("ascii"))
        digest.update(b"\0")
    for path in _iter_input_files(root, component):
        relative = path.relative_to(root).as_posix()
        payload_sha = sha256_file(path)
        size = path.stat().st_size
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(size).encode("ascii"))
        digest.update(b"\0")
        digest.update(payload_sha.encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


def _artifact_entries(out_dir: Path) -> dict[str, dict[str, object]]:
    if out_dir.is_symlink():
        raise CacheError("component output directory must not be a symlink")
    out_dir = out_dir.resolve()
    if not out_dir.is_dir():
        raise CacheError("component output directory is missing or unsafe")
    result: dict[str, dict[str, object]] = {}
    for path in sorted(out_dir.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_symlink():
            raise CacheError(f"component output contains symlink: {path}")
        if not path.is_file() or path.name == CACHE_MANIFEST:
            continue
        relative = path.relative_to(out_dir).as_posix()
        result[relative] = {"sha256": sha256_file(path), "size": path.stat().st_size}
    if not result:
        raise CacheError("component output contains no artifacts")
    return result


def _exact_commit(value: str, label: str) -> str:
    value = value.strip().lower()
    if SHA40_RE.fullmatch(value) is None:
        raise CacheError(f"{label} must be an exact lowercase 40-hex commit")
    return value


def _verify_owner_development_payload(out_dir: Path, provenance: dict) -> None:
    """Check the actual Buildroot Owner bytes against immutable provenance."""
    if (provenance.get("$schema") != "prototype-ordax.independent-base-provenance/1"
            or provenance.get("profile") != "owner-development"
            or provenance.get("status") != "candidate-build-only"
            or provenance.get("owner_development_capabilities_verified") is not True
            or provenance.get("physical_artifact_authorized") is not False
            or provenance.get("signed_release_equivalence_proven") is not False):
        raise CacheError("cached Owner base profile or promotion policy mismatch")
    declared = provenance.get("artifacts")
    if not isinstance(declared, dict):
        raise CacheError("cached Owner base provenance artifacts missing")
    for name in ("rootfs.tar", "rootfs.cpio.gz", "independent-base.erofs"):
        expected = declared.get(name)
        path = out_dir / name
        if (not isinstance(expected, str) or SHA256_RE.fullmatch(expected) is None
                or path.is_symlink() or not path.is_file()
                or sha256_file(path) != expected):
            raise CacheError(f"cached Owner base provenance artifact mismatch: {name}")


def _component_provenance_commit(component: str, out_dir: Path) -> str | None:
    name = PROVENANCE_FILES.get(component)
    if name is None:
        return None
    path = out_dir / name
    if path.is_symlink() or not path.is_file():
        raise CacheError(f"component provenance is missing or unsafe: {name}")
    try:
        provenance = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CacheError(f"cannot read component provenance {name}: {exc}") from exc
    if component == "independent-base-owner":
        _verify_owner_development_payload(out_dir, provenance)
    return _exact_commit(str(provenance.get("source_commit", "")), "component provenance source commit")


def record_component(component: str, out_dir: Path, source_commit: str, root: Path = ROOT) -> dict:
    source_commit = _exact_commit(source_commit, "source commit")
    if out_dir.is_symlink():
        raise CacheError("component output directory must not be a symlink")
    out_dir = out_dir.resolve()
    provenance_commit = _component_provenance_commit(component, out_dir)
    if provenance_commit is not None and provenance_commit != source_commit:
        raise CacheError("fresh component provenance is not bound to the exact source commit")
    manifest_path = out_dir / CACHE_MANIFEST
    if manifest_path.exists() or manifest_path.is_symlink():
        raise CacheError("component cache manifest already exists")
    manifest = {
        "$schema": SCHEMA,
        "component": component,
        "fingerprint_version": FINGERPRINT_VERSION,
        "input_fingerprint": component_fingerprint(component, root),
        "execution_environment": execution_environment(),
        "build_source_commit": source_commit,
        "artifacts": _artifact_entries(out_dir),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def _load_manifest(out_dir: Path) -> dict:
    path = out_dir.resolve() / CACHE_MANIFEST
    if path.is_symlink() or not path.is_file():
        raise CacheError("component cache manifest is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CacheError(f"cannot read component cache manifest: {exc}") from exc
    if value.get("$schema") != SCHEMA:
        raise CacheError("unexpected component cache manifest schema")
    return value


def verify_component(
    component: str,
    out_dir: Path,
    integration_commit: str,
    receipt: Path,
    *,
    cache_hit: bool,
    root: Path = ROOT,
) -> dict:
    integration_commit = _exact_commit(integration_commit, "integration commit")
    if out_dir.is_symlink():
        raise CacheError("component output directory must not be a symlink")
    out_dir = out_dir.resolve()
    manifest = _load_manifest(out_dir)
    if manifest.get("component") != component:
        raise CacheError("cached component identity mismatch")
    if manifest.get("fingerprint_version") != FINGERPRINT_VERSION:
        raise CacheError("cached fingerprint version mismatch")
    expected_environment = execution_environment()
    if manifest.get("execution_environment") != expected_environment:
        raise CacheError("cached component execution environment mismatch")
    expected_fingerprint = component_fingerprint(component, root)
    if manifest.get("input_fingerprint") != expected_fingerprint:
        raise CacheError("cached component input fingerprint mismatch")
    build_source_commit = _exact_commit(str(manifest.get("build_source_commit", "")), "build source commit")
    provenance_commit = _component_provenance_commit(component, out_dir)
    if provenance_commit is not None and provenance_commit != build_source_commit:
        raise CacheError("cached component provenance disagrees with build source commit")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        raise CacheError("cached artifact manifest is empty")
    actual = _artifact_entries(out_dir)
    if set(actual) != set(artifacts):
        raise CacheError("cached artifact file set mismatch")
    for relative, expected in artifacts.items():
        if not isinstance(expected, dict):
            raise CacheError(f"invalid cached artifact record: {relative}")
        digest = expected.get("sha256")
        size = expected.get("size")
        if not isinstance(digest, str) or SHA256_RE.fullmatch(digest) is None:
            raise CacheError(f"invalid cached artifact digest: {relative}")
        if not isinstance(size, int) or size < 0:
            raise CacheError(f"invalid cached artifact size: {relative}")
        if actual[relative]["sha256"] != digest or actual[relative]["size"] != size:
            raise CacheError(f"cached artifact bytes changed: {relative}")
    if not cache_hit and build_source_commit != integration_commit:
        raise CacheError("fresh component build is not bound to the exact integration commit")

    receipt_value = {
        "$schema": REUSE_SCHEMA,
        "status": "verified",
        "component": component,
        "input_fingerprint": expected_fingerprint,
        "execution_environment": expected_environment,
        "build_source_commit": build_source_commit,
        "integration_source_commit": integration_commit,
        "reused": bool(cache_hit),
        "artifact_count": len(actual),
        "artifacts": actual,
        "provenance_rewritten": False,
    }
    receipt = receipt.resolve()
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps(receipt_value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return receipt_value


def write_fingerprints(github_output: Path, root: Path = ROOT) -> dict[str, str]:
    values = {name: component_fingerprint(name, root) for name in COMPONENTS}
    aliases = {
        "kernel": "kernel",
        "independent_base": "independent-base",
        "independent_base_owner": "independent-base-owner",
        "local_ai": "local-ai",
        "release_agent": "release-agent",
    }
    lines = [f"{key}={values[component]}" for key, component in aliases.items()]
    with github_output.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
    return values


def parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise CacheError("cache-hit must be exactly true or false")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    fp = sub.add_parser("fingerprints")
    fp.add_argument("--github-output", type=Path, required=True)

    record = sub.add_parser("record")
    record.add_argument("--component", choices=sorted(COMPONENTS), required=True)
    record.add_argument("--out-dir", type=Path, required=True)
    record.add_argument("--source-commit", required=True)

    verify = sub.add_parser("verify")
    verify.add_argument("--component", choices=sorted(COMPONENTS), required=True)
    verify.add_argument("--out-dir", type=Path, required=True)
    verify.add_argument("--integration-commit", required=True)
    verify.add_argument("--receipt", type=Path, required=True)
    verify.add_argument("--cache-hit", required=True)

    args = parser.parse_args()
    try:
        if args.command == "fingerprints":
            print(json.dumps(write_fingerprints(args.github_output), indent=2, sort_keys=True))
        elif args.command == "record":
            print(json.dumps(record_component(args.component, args.out_dir, args.source_commit), indent=2, sort_keys=True))
        else:
            print(
                json.dumps(
                    verify_component(
                        args.component,
                        args.out_dir,
                        args.integration_commit,
                        args.receipt,
                        cache_hit=parse_bool(args.cache_hit),
                    ),
                    indent=2,
                    sort_keys=True,
                )
            )
        return 0
    except (CacheError, OSError) as exc:
        print(f"portable-component-cache: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
