#!/usr/bin/env python3
"""Assemble the signed Native system release source tree.

This recipe is intentionally separate from tools/release-bundle: it prepares
the Native-specific system/ tree, while release-bundle remains the canonical
deterministic tar owner.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SYSTEM = ROOT / "system"
CREATOR_SOURCE_CONTRACT = ROOT / "docs" / "contracts" / "native-release-assembly.json"
RUNTIME_COMPONENT_CHANNEL = ROOT / "tools" / "runtime-component-channel"
PROVENANCE_RELATIVE = Path("system/.ordax/native-release-tools.json")
SCHEMA = "prototype-ordax.native-release-assembly/2"

HELPERS = (
    {
        "relative": Path("system/bin/ordax-native-install-targets"),
        "module": None,  # Bound only to verified external Creator source.
        "package": "./cmd/ordax-creator-native-targets",
        "role": "native-install-read-only-target-discovery",
        "source_package": "github.com/ordaxsystems/ordax-creator/cmd/ordax-creator-native-targets",
        "external_creator_source": True,
        "physical_apply_authorized": False,
        "component_publish_authorized": False,
    },
    {
        "relative": Path("system/bin/ordax-runtime-component-channel"),
        "module": RUNTIME_COMPONENT_CHANNEL,
        "package": ".",
        "role": "runtime-component-verifier-and-activation-state-owner",
        "source_package": "tools/runtime-component-channel",
        "physical_apply_authorized": False,
        "component_publish_authorized": False,
    },
)


class AssemblyError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_head() -> str:
    try:
        value = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise AssemblyError("cannot resolve source commit") from exc
    if len(value) != 40 or any(c not in "0123456789abcdef" for c in value):
        raise AssemblyError("source commit is not a lowercase 40-hex SHA")
    return value


def ensure_clean_destination(destination: Path) -> Path:
    absolute = destination.resolve()
    if absolute == ROOT or ROOT in absolute.parents:
        raise AssemblyError("assembly destination must be outside repository source")
    if absolute.exists() or absolute.is_symlink():
        raise AssemblyError("assembly destination already exists")
    absolute.parent.mkdir(parents=True, exist_ok=True)
    return absolute


def creator_source_pin() -> dict:
    """Read the one authoritative OS Native assembly source contract."""
    try:
        contract = json.loads(CREATOR_SOURCE_CONTRACT.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise AssemblyError("canonical Creator source contract is unreadable") from exc
    pin = contract.get("creator_source")
    if not isinstance(pin, dict) or contract.get("$schema") != SCHEMA:
        raise AssemblyError("canonical Creator source lock is missing or invalid")
    if (
        pin.get("repository") != "ordaxsystems/ordax-creator"
        or pin.get("module") != "github.com/ordaxsystems/ordax-creator"
        or pin.get("helper_package") != "./cmd/ordax-creator-native-targets"
        or pin.get("physical_apply_authorized") is not False
        or pin.get("publisher_authority") != "ordaxsystems/ordax-os"
    ):
        raise AssemblyError("Creator source authority or physical policy mismatch")
    for field in ("commit", "tree"):
        value = pin.get(field)
        if not isinstance(value, str) or len(value) != 40 or any(c not in "0123456789abcdef" for c in value):
            raise AssemblyError(f"Creator source {field} must be immutable lowercase Git SHA")
    return pin


def checked_git(source: Path, *args: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(source), *args],
            capture_output=True, check=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise AssemblyError("cannot verify immutable external Creator source") from exc


def verify_external_creator_source(source: Path) -> dict:
    """Reject mutable, dirty, wrong-owner or floating Creator trees before Go build."""
    pin = creator_source_pin()
    if not source.is_dir() or source.is_symlink():
        raise AssemblyError("external Creator source must be a real directory")
    absolute = source.resolve()
    if Path(checked_git(absolute, "rev-parse", "--show-toplevel")).resolve() != absolute:
        raise AssemblyError("Creator source must be a standalone Git checkout root")
    if checked_git(absolute, "rev-parse", "HEAD") != pin["commit"]:
        raise AssemblyError("Creator source Git commit differs from canonical OS pin")
    if checked_git(absolute, "rev-parse", "HEAD^{tree}") != pin["tree"]:
        raise AssemblyError("Creator source Git tree differs from canonical OS pin")
    if checked_git(absolute, "status", "--porcelain", "--untracked-files=all"):
        raise AssemblyError("Creator source checkout is dirty or contains extra untrusted files")
    mod = absolute / "go.mod"
    package = absolute / "cmd/ordax-creator-native-targets/main.go"
    if not mod.is_file() or mod.is_symlink() or not package.is_file() or package.is_symlink():
        raise AssemblyError("Creator module or Native helper source is missing or linked")
    if f"module {pin['module']}" not in mod.read_text(encoding="utf-8").splitlines():
        raise AssemblyError("Creator Go module does not match canonical source owner")
    return pin


def validate_source_tree(system_source: Path = SYSTEM, creator_source: Path | None = None) -> None:
    if not system_source.is_dir() or system_source.is_symlink():
        raise AssemblyError("system source root is missing or unsafe")
    entrypoint = system_source / "entrypoint"
    if not entrypoint.is_file() or entrypoint.is_symlink():
        raise AssemblyError("system entrypoint is missing or unsafe")
    if stat.S_IMODE(entrypoint.stat().st_mode) != 0o755:
        raise AssemblyError("system entrypoint must be mode 0755")
    for helper in HELPERS:
        module = creator_source if helper.get("external_creator_source") else helper["module"]
        if not isinstance(module, Path) or not (module / "go.mod").is_file():
            raise AssemblyError("Native helper Go module is missing or unverified")
    for path in system_source.rglob("*"):
        if path.is_symlink():
            raise AssemblyError(f"symlink is forbidden in Native release source: {path}")



def verify_external_surface_system(system_source: Path) -> dict:
    """A Native release can only extend a fully verified cross-repo source."""
    lock_file = ROOT / "docs/contracts/surface-source.json"
    lock = json.loads(lock_file.read_text(encoding="utf-8"))
    receipt_path = system_source / "surface/source-provenance.json"
    if not receipt_path.is_file() or receipt_path.is_symlink():
        raise AssemblyError("external Native source requires verified Surface provenance")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if (
        receipt.get("$schema") != "prototype-ordax.surface-assembly/1"
        or receipt.get("old_os_visual_source_packaged") is not False
        or receipt.get("os_commit") != git_head()
        or receipt.get("surface_source_repository") != lock.get("source_repository")
        or receipt.get("surface_source_commit") != lock.get("source_commit")
        or receipt.get("visual_paths") != lock.get("visual_source_paths")
    ):
        raise AssemblyError("external Native source is not bound to current OS/Surface")
    fingerprint = hashlib.sha256()
    files = []
    for dirname in ("ui", "workspace"):
        base = system_source / "surface" / dirname
        if not base.is_dir() or base.is_symlink():
            raise AssemblyError("Native Surface source tree is missing or linked")
        for file in base.rglob("*"):
            if not file.is_file() or file.is_symlink():
                if not file.is_dir():
                    raise AssemblyError("Native visual source contains unsafe entry")
                continue
            files.append(file)
    # The same lexical Git-path order as tools/surface-source/materialize.py.
    files.sort(key=lambda file: file.relative_to(system_source.parent).as_posix())
    for file in files:
        relative = file.relative_to(system_source.parent).as_posix()
        payload = file.read_bytes()
        fingerprint.update(relative.encode("utf-8") + b"\0")
        fingerprint.update(hashlib.sha256(payload).digest())
    if receipt.get("visual_file_count") != len(files) or receipt.get("visual_source_sha256") != fingerprint.hexdigest():
        raise AssemblyError("external Native visual source fingerprint mismatch")
    return receipt

def copy_system_tree(destination: Path, system_source: Path = SYSTEM) -> Path:
    target = destination / "system"
    shutil.copytree(
        system_source,
        target,
        symlinks=False,
        copy_function=shutil.copy2,
    )
    for path in target.rglob("*"):
        if path.is_symlink():
            raise AssemblyError(f"symlink leaked into Native release staging: {path}")
    return target


def build_helper(destination: Path, spec: dict, creator_source: Path) -> Path:
    relative = spec["relative"]
    module = creator_source if spec.get("external_creator_source") else spec["module"]
    package = spec["package"]
    output = destination / relative
    output.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ)
    env.update({
        "CGO_ENABLED": "0",
        "GOOS": "linux",
        "GOARCH": "amd64",
        "GOTOOLCHAIN": "local",
    })
    argv = [
        "go",
        "build",
        "-trimpath",
        "-buildvcs=false",
        "-ldflags=-s -w",
        "-o",
        str(output),
        package,
    ]
    try:
        subprocess.run(argv, cwd=module, env=env, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise AssemblyError(f"failed to build Native helper: {relative}") from exc
    if not output.is_file() or output.is_symlink() or output.stat().st_size <= 0:
        raise AssemblyError(f"Native helper build did not produce a safe file: {relative}")
    output.chmod(0o755)
    return output


def tool_provenance(spec: dict, helper: Path) -> dict:
    record = {
        "path": spec["relative"].as_posix(),
        "role": spec["role"],
        "source_package": spec["source_package"],
        "sha256": sha256_file(helper),
        "size": helper.stat().st_size,
        "mode": "0755",
        "physical_apply_authorized": spec["physical_apply_authorized"],
        "component_publish_authorized": spec["component_publish_authorized"],
    }
    if spec.get("external_creator_source"):
        pin = creator_source_pin()
        record.update({
            "source_repository": pin["repository"],
            "source_commit": pin["commit"],
            "source_tree": pin["tree"],
        })
    return record


def write_provenance(
    destination: Path,
    built_helpers: list[tuple[dict, Path]],
    source_commit: str,
) -> Path:
    provenance = {
        "$schema": SCHEMA,
        "status": "assembled",
        "source_commit": source_commit,
        "recipe": "tools/native-release-assembly/build.py",
        "target": "linux/amd64",
        "cgo_enabled": False,
        "system_source": "system/",
        "physical_apply_authorized": False,
        "component_publish_authorized": False,
        "injected_tools": [
            tool_provenance(spec, helper)
            for spec, helper in built_helpers
        ],
    }
    path = destination / PROVENANCE_RELATIVE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    path.chmod(0o644)
    return path


def assemble(destination: Path, system_source: Path = SYSTEM, creator_source: Path | None = None) -> dict:
    if creator_source is None:
        raise AssemblyError('Native assembly requires an explicit pinned external Creator source')
    verify_external_creator_source(creator_source)
    validate_source_tree(system_source, creator_source)
    if system_source != SYSTEM:
        verify_external_surface_system(system_source)
    destination = ensure_clean_destination(destination)
    destination.mkdir(mode=0o755)
    copy_system_tree(destination, system_source)
    built_helpers = [(spec, build_helper(destination, spec, creator_source)) for spec in HELPERS]
    source_commit = git_head()
    provenance = write_provenance(destination, built_helpers, source_commit)
    tools = [tool_provenance(spec, helper) for spec, helper in built_helpers]
    return {
        "schema": SCHEMA,
        "status": "assembled",
        "source_commit": source_commit,
        "root": str(destination),
        "helpers": tools,
        "provenance": PROVENANCE_RELATIVE.as_posix(),
        "provenance_sha256": sha256_file(provenance),
        "physical_apply_authorized": False,
        "component_publish_authorized": False,
    }


def verify_tool(destination: Path, spec: dict, record: object) -> dict:
    if not isinstance(record, dict):
        raise AssemblyError("Native helper provenance record is invalid")
    helper = destination / spec["relative"]
    if not helper.is_file() or helper.is_symlink():
        raise AssemblyError(f"assembled Native helper is missing or unsafe: {spec['relative']}")
    if stat.S_IMODE(helper.stat().st_mode) != 0o755:
        raise AssemblyError(f"assembled Native helper must be mode 0755: {spec['relative']}")
    expected = {
        "path": spec["relative"].as_posix(),
        "role": spec["role"],
        "source_package": spec["source_package"],
        "sha256": sha256_file(helper),
        "size": helper.stat().st_size,
        "mode": "0755",
        "physical_apply_authorized": spec["physical_apply_authorized"],
        "component_publish_authorized": spec["component_publish_authorized"],
    }
    if record != expected:
        raise AssemblyError(
            f"Native helper provenance does not match assembled bytes: {spec['relative']}"
        )
    return expected


def verify(destination: Path) -> dict:
    destination = destination.resolve()
    provenance_path = destination / PROVENANCE_RELATIVE
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AssemblyError("Native assembly provenance is unreadable") from exc
    if (
        provenance.get("$schema") != SCHEMA
        or provenance.get("physical_apply_authorized") is not False
        or provenance.get("component_publish_authorized") is not False
    ):
        raise AssemblyError("Native assembly provenance policy is invalid")
    tools = provenance.get("injected_tools")
    if not isinstance(tools, list) or len(tools) != len(HELPERS):
        raise AssemblyError(
            f"Native assembly must contain exactly {len(HELPERS)} injected tools"
        )
    by_path = {
        record.get("path"): record
        for record in tools
        if isinstance(record, dict) and isinstance(record.get("path"), str)
    }
    if len(by_path) != len(HELPERS):
        raise AssemblyError("Native helper provenance paths must be unique and complete")
    verified = [
        verify_tool(destination, spec, by_path.get(spec["relative"].as_posix()))
        for spec in HELPERS
    ]
    return {
        "status": "verified",
        "source_commit": provenance.get("source_commit"),
        "helpers": verified,
        "physical_apply_authorized": False,
        "component_publish_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    assemble_parser = sub.add_parser("assemble")
    assemble_parser.add_argument("--out", type=Path, required=True)
    assemble_parser.add_argument("--system-source", type=Path, default=SYSTEM)
    assemble_parser.add_argument("--creator-source", type=Path, required=True, help="standalone exact-commit Creator checkout; must match canonical OS Native contract")
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = assemble(args.out, args.system_source, args.creator_source) if args.command == "assemble" else verify(args.root)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (AssemblyError, OSError) as exc:
        print(f"native-release-assembly: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
