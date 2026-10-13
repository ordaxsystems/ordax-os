#!/usr/bin/env python3
"""Exact-input, fail-closed caching for disposable independent CI artifacts.

The source build provenance is immutable. A separate per-run binding links
verified binaries to the *current* checkout without rewriting their origin.
Never a release signing, promotion, or physical device authority.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
MANIFEST = "ci-build-identity.json"
SCHEMA = "prototype-ordax.independent-ci-artifact-identity/1"
BINDING_SCHEMA = "prototype-ordax.independent-ci-run-binding/1"
PACKAGES = (
    "binutils", "bison", "cpio", "dwarves", "e2fsprogs", "erofs-utils",
    "flex", "gawk", "gcc-13", "libelf-dev", "libssl-dev", "make", "patch", "xz-utils",
)

class CacheError(RuntimeError):
    pass

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def checked(argv: list[str]) -> str:
    return subprocess.check_output(argv, text=True, stderr=subprocess.PIPE).strip()

def checkout_sha() -> str:
    value = checked(["git", "-C", str(ROOT), "rev-parse", "HEAD"])
    if not HEX40.fullmatch(value):
        raise CacheError("invalid checkout commit")
    return value

def inputs(kind: str) -> list[Path]:
    if kind not in ("kernel", "base"):
        raise CacheError("unknown CI input kind")
    if kind == "kernel":
        paths = [
            p for p in (ROOT / "bootstrap/kernel").rglob("*")
            if p.is_file() and p.suffix not in (".md", ".txt", ".pyc")
            and "__pycache__" not in p.parts
            and "candidates" not in p.parts and p.name != ".gitkeep"
        ]
        paths += [ROOT / "bootstrap/kernel/source.json",
                  ROOT / "bootstrap/kernel/config/ordax.fragment"]
    else:
        paths = [
            p for p in HERE.rglob("*")
            if p.is_file() and p.suffix not in (".md", ".txt", ".pyc")
            and "__pycache__" not in p.parts
            and p.name not in ("qemu_proof.py", "portable_boot_proof.py",
                                "signed_release_failure_qemu.py")
        ]
        paths += list((ROOT / "bootstrap/network").glob("*"))
        paths += [
            ROOT / "bootstrap/stable-base/ordax-stable-init",
            ROOT / "bootstrap/stable-base/source.json",
            ROOT / "bootstrap/kernel/source.json",
            ROOT / "docs/contracts/portable-boot-handoff.json",
            ROOT / "system/entrypoint", ROOT / "system/supervisor",
        ]
    unique = sorted({p for p in paths if p.is_file()})
    for path in unique:
        if path.is_symlink() or ROOT not in path.resolve().parents:
            raise CacheError(f"unsafe source input: {path}")
    if not unique:
        raise CacheError("no canonical build inputs")
    return unique

def fingerprint(kind: str) -> dict:
    # Exact Ubuntu image + resolved apt dependency versions and canonical paths.
    # A new runner image or any relevant build dependency changes the key.
    packages = {}
    for package in PACKAGES:
        packages[package] = checked([
            "dpkg-query", "-W", "-f=${Version}", package
        ])
        if not packages[package]:
            raise CacheError(f"missing build dependency: {package}")
    toolchain = {
        "runner_image_os": os.environ.get("ImageOS", ""),
        "runner_image_version": os.environ.get("ImageVersion", ""),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "gcc13_full_version": checked(["gcc-13", "-dumpfullversion"]),
        "gcc13_target": checked(["gcc-13", "-dumpmachine"]),
        "make": checked(["make", "--version"]).splitlines()[0],
        "packages": packages,
    }
    if not toolchain["runner_image_version"] or platform.system() != "Linux":
        raise CacheError("CI runner image identity is not pinned")
    files = {}
    for path in inputs(kind):
        relative = path.relative_to(ROOT).as_posix()
        files[relative] = {
            "sha256": sha256(path),
            "mode": oct(stat.S_IMODE(path.stat().st_mode)),
        }
    document = {"kind": kind, "toolchain": toolchain, "inputs": files}
    key = hashlib.sha256(json.dumps(document, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"fingerprint": key, **document}

def artifacts(path: Path) -> dict[str, str]:
    if path.is_symlink() or not path.is_dir():
        raise CacheError("artifact directory is missing or unsafe")
    files = {}
    for item in sorted(path.iterdir()):
        if item.name == MANIFEST:
            continue
        if item.is_symlink() or not item.is_file() or not re.fullmatch(r"[A-Za-z0-9_.-]+", item.name):
            raise CacheError(f"unsafe cached artifact: {item.name}")
        files[item.name] = sha256(item)
    if not files:
        raise CacheError("no verifiable build artifacts")
    return files

def verify_canonical(kind: str, path: Path) -> dict:
    if kind == "kernel":
        checked([sys.executable, str(ROOT / "bootstrap/kernel/verify.py"), str(path)])
        report_file = path / "kernel-provenance.json"
    else:
        checked([sys.executable, str(HERE / "build.py"), "verify", "--out", str(path)])
        report_file = path / "provenance.json"
    report = json.loads(report_file.read_text(encoding="utf-8"))
    if not HEX40.fullmatch(report.get("source_commit", "")):
        raise CacheError("canonical provenance has no valid origin commit")
    if kind == "kernel":
        pinned = json.loads((ROOT / "bootstrap/kernel/source.json").read_text())
        if (report.get("kernel_version") != pinned["version"] or
            report.get("source_contract_sha256") != sha256(ROOT / "bootstrap/kernel/source.json") or
            report.get("fragment_sha256") != sha256(ROOT / "bootstrap/kernel/config/ordax.fragment") or
            report.get("physical_artifact_authorized") is not False):
            raise CacheError("kernel ABI/config/policy drift from its canonical owner")
    else:
        if report.get("physical_artifact_authorized") is not False:
            raise CacheError("cached Base unexpectedly promotable")
    return report

def seal(kind: str, path: Path) -> dict:
    identity = fingerprint(kind)
    source = checkout_sha()
    report = verify_canonical(kind, path)
    if report["source_commit"] != source:
        raise CacheError("new build provenance is not bound to its source checkout")
    manifest = {
        "$schema": SCHEMA,
        "kind": kind,
        "origin_commit": source,
        "fingerprint": identity["fingerprint"],
        "toolchain": identity["toolchain"],
        "inputs": identity["inputs"],
        "artifacts": artifacts(path),
        "canonical_provenance_sha256": sha256(
            path / ("kernel-provenance.json" if kind == "kernel" else "provenance.json")
        ),
        "physical_promotion_authorized": False,
    }
    target = path / MANIFEST
    if target.exists() or target.is_symlink():
        raise CacheError("refuse to replace existing cache identity")
    target.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest

def verify(kind: str, path: Path) -> dict:
    target = path / MANIFEST
    if target.is_symlink() or not target.is_file():
        raise CacheError("cached build has no immutable origin identity")
    metadata = json.loads(target.read_text())
    expected = fingerprint(kind)
    if (metadata.get("$schema") != SCHEMA or metadata.get("kind") != kind or
        metadata.get("fingerprint") != expected["fingerprint"] or
        metadata.get("toolchain") != expected["toolchain"] or
        metadata.get("inputs") != expected["inputs"] or
        metadata.get("physical_promotion_authorized") is not False or
        not HEX40.fullmatch(metadata.get("origin_commit", ""))):
        raise CacheError("cache key, inputs, toolchain or non-promotion policy changed")
    actual_files = artifacts(path)
    if actual_files != metadata.get("artifacts"):
        raise CacheError("immutable cached bytes differ from sealed SHA-256 list")
    report = verify_canonical(kind, path)
    if report.get("source_commit") != metadata["origin_commit"]:
        raise CacheError("cached original provenance does not match origin commit")
    if sha256(path / ("kernel-provenance.json" if kind == "kernel" else "provenance.json")) != metadata["canonical_provenance_sha256"]:
        raise CacheError("cached original provenance hash differs")
    return metadata

def bind(kind: str, path: Path, destination: Path) -> dict:
    info = verify(kind, path)
    value = {
        "$schema": BINDING_SCHEMA,
        "kind": kind,
        "current_commit": checkout_sha(),
        "origin_commit": info["origin_commit"],
        "inputs_sha256": info["fingerprint"],
        "artifacts": info["artifacts"],
        "physical_promotion_authorized": False,
    }
    if destination.exists() or destination.is_symlink():
        raise CacheError("run binding destination must be new")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    return value

def verify_binding(kind: str, path: Path, receipt: Path, current: str) -> dict:
    if receipt.is_symlink() or not receipt.is_file():
        raise CacheError("current-run artifact binding is missing or unsafe")
    value = json.loads(receipt.read_text())
    info = verify(kind, path)
    if (value.get("$schema") != BINDING_SCHEMA or value.get("kind") != kind or
        value.get("current_commit") != current or value.get("origin_commit") != info["origin_commit"] or
        value.get("inputs_sha256") != info["fingerprint"] or
        value.get("artifacts") != info["artifacts"] or
        value.get("physical_promotion_authorized") is not False):
        raise CacheError("run-bound receipt does not match current commit and exact bytes")
    return value

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("key", "seal", "bind", "check"))
    parser.add_argument("--kind", required=True, choices=("kernel", "base"))
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "key":
            value = fingerprint(args.kind)
            if args.github_output:
                with args.github_output.open("a") as handle:
                    handle.write(f"key=ordax-independent-{args.kind}-{value['fingerprint']}\n")
            print(value["fingerprint"])
        else:
            if args.directory is None:
                raise CacheError("artifact directory required")
            if args.command == "seal":
                value = seal(args.kind, args.directory)
            elif args.command == "bind":
                if args.receipt is None:
                    raise CacheError("binding output required")
                value = bind(args.kind, args.directory, args.receipt)
            else:
                value = verify(args.kind, args.directory)
            print(json.dumps({
                "kind": args.kind, "inputs_sha256": value.get("fingerprint", value.get("inputs_sha256")),
                "origin_commit": value.get("origin_commit"),
                "current_commit": checkout_sha(), "verified": True,
            }, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError, CacheError) as exc:
        print(f"ordax-independent-ci-cache: ERROR: {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
