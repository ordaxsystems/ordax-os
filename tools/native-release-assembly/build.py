#!/usr/bin/env python3
"""Assemble the signed Native system release source tree.

This recipe is intentionally separate from tools/release-bundle: it prepares
the Native-specific system/ tree, while release-bundle remains the canonical
deterministic tar owner.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
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
        "source_package": "github.com/ordaxsystems/ordax-os/creator/cmd/ordax-creator-native-targets",
        "monorepo_creator_source": True,
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
    """Resolve Creator source from this OS commit, without an external Git pin."""
    try:
        contract = json.loads(CREATOR_SOURCE_CONTRACT.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise AssemblyError("canonical Creator source contract is unreadable") from exc
    pin = contract.get("creator_source")
    if not isinstance(pin, dict) or contract.get("$schema") != SCHEMA:
        raise AssemblyError("canonical Creator source contract is missing or invalid")
    if (
        pin.get("repository") != "ordaxsystems/ordax-os"
        or pin.get("path") != "creator"
        or pin.get("module") != "github.com/ordaxsystems/ordax-os/creator"
        or pin.get("helper_package") != "./cmd/ordax-creator-native-targets"
        or pin.get("physical_apply_authorized") is not False
        or pin.get("publisher_authority") != "ordaxsystems/ordax-os"
        or "commit" in pin or "tree" in pin
    ):
        raise AssemblyError("Creator monorepo ownership or physical policy mismatch")
    return {**pin, "commit": checked_git(ROOT, "rev-parse", "HEAD"),
            "tree": checked_git(ROOT, "rev-parse", "HEAD:creator")}


def checked_git(source: Path, *args: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(source), *args],
            capture_output=True, check=True, text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise AssemblyError("cannot verify immutable external Creator source") from exc


def verify_monorepo_creator_source(source: Path) -> dict:
    """Require the Creator module from the exact checked-out OS commit."""
    pin = creator_source_pin()
    if not source.is_dir() or source.is_symlink():
        raise AssemblyError("Creator module source must be a real directory")
    absolute = source.resolve()
    if absolute != (ROOT / "creator").resolve():
        raise AssemblyError("Creator source must be the current OS creator/ module")
    if Path(checked_git(absolute, "rev-parse", "--show-toplevel")).resolve() != ROOT.resolve():
        raise AssemblyError("Creator module must belong to the OS Git worktree")
    if checked_git(ROOT, "status", "--porcelain", "--untracked-files=all", "--", "creator"):
        raise AssemblyError("Creator source differs from the checked-out OS commit")
    mod = absolute / "go.mod"
    package = absolute / "cmd/ordax-creator-native-targets/main.go"
    if not mod.is_file() or mod.is_symlink() or not package.is_file() or package.is_symlink():
        raise AssemblyError("Creator module or Native helper source is missing or linked")
    if f"module {pin['module']}" not in mod.read_text(encoding="utf-8").splitlines():
        raise AssemblyError("Creator Go module does not match canonical OS ownership")
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
        module = creator_source if helper.get("monorepo_creator_source") else helper["module"]
        if not isinstance(module, Path) or not (module / "go.mod").is_file():
            raise AssemblyError("Native helper Go module is missing or unverified")
    for path in system_source.rglob("*"):
        if path.is_symlink():
            raise AssemblyError(f"symlink is forbidden in Native release source: {path}")



def verify_same_commit_surface_system(system_source: Path) -> dict:
    """Native releases must contain the visual tree from the same OS commit."""
    lock_file = ROOT / "docs/contracts/surface-source.json"
    lock = json.loads(lock_file.read_text(encoding="utf-8"))
    receipt_path = system_source / "surface/source-provenance.json"
    if not receipt_path.is_file() or receipt_path.is_symlink():
        raise AssemblyError("Native source requires same-commit Surface provenance")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if (
        lock.get("$schema") != "prototype-ordax.surface-source/2"
        or lock.get("source_ref") != "same-commit"
        or receipt.get("$schema") != "prototype-ordax.surface-assembly/2"
        or receipt.get("single_visual_source") is not True
        or receipt.get("os_commit") != git_head()
        or receipt.get("surface_source_repository") != "ordaxsystems/ordax-os"
        or receipt.get("surface_source_commit") != git_head()
        or receipt.get("user_interface_owner") != "ordaxsystems/ordax-os"
        or receipt.get("visual_paths") != lock.get("visual_source_paths")
    ):
        raise AssemblyError("Native Surface source is not bound to current OS commit")
    # The OS materializer owns one byte-for-byte Git proof; never trust a
    # self-declared receipt as independent authorization for a release.
    module_path = Path(__file__).resolve().parents[2] / "tools/surface-source/materialize.py"
    spec = importlib.util.spec_from_file_location("ordax_native_os_visual_proof", module_path)
    if spec is None or spec.loader is None:
        raise AssemblyError("canonical visual Git verifier unavailable")
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    try:
        source.verify_staged_visuals(ROOT, system_source, receipt)
    except (source.SurfaceSourceError, OSError, ValueError) as exc:
        raise AssemblyError("Native visual source fingerprint differs from OS Git") from exc
    return receipt

def verify_canonical_intelligence_system(system_source: Path) -> dict:
    """Verify same-commit OS Intelligence and staged non-activating receipt."""
    module_path = ROOT / "tools/intelligence/verify.py"
    spec = importlib.util.spec_from_file_location("ordax_native_intelligence_integrity", module_path)
    if spec is None or spec.loader is None:
        raise AssemblyError("same-commit Intelligence verifier unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        record = module.verify(system_source.parent, need_receipt=True)
    except (module.IntelligenceIntegrityError, ValueError, OSError) as exc:
        raise AssemblyError("Native Intelligence bytes do not match OS Git or receipt") from exc
    return record


def intelligence_binding(receipt: dict) -> dict:
    return {
        "source_repository": "ordaxsystems/ordax-os",
        "source_commit": receipt["source_commit"],
        "source_sha256": receipt["source_sha256"],
        "activation_authorized": False,
    }


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
    module = creator_source if spec.get("monorepo_creator_source") else spec["module"]
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
    if spec.get("monorepo_creator_source"):
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
    intelligence: dict | None = None,
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
    if intelligence is not None:
        provenance["intelligence_source"] = intelligence_binding(intelligence)
    path = destination / PROVENANCE_RELATIVE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    path.chmod(0o644)
    return path


def assemble(destination: Path, system_source: Path = SYSTEM, creator_source: Path | None = None, *, require_intelligence: bool = False) -> dict:
    if creator_source is None:
        creator_source = ROOT / 'creator'
    if require_intelligence and system_source == SYSTEM:
        raise AssemblyError("Intelligence requires verified same-commit Native staging")
    verify_monorepo_creator_source(creator_source)
    validate_source_tree(system_source, creator_source)
    if system_source != SYSTEM:
        verify_same_commit_surface_system(system_source)
    intelligence = None
    if require_intelligence:
        if system_source == SYSTEM:
            raise AssemblyError("Intelligence requires verified same-commit Native staging")
        intelligence = verify_canonical_intelligence_system(system_source)
    destination = ensure_clean_destination(destination)
    destination.mkdir(mode=0o755)
    copy_system_tree(destination, system_source)
    built_helpers = [(spec, build_helper(destination, spec, creator_source)) for spec in HELPERS]
    source_commit = git_head()
    provenance = write_provenance(destination, built_helpers, source_commit, intelligence)
    tools = [tool_provenance(spec, helper) for spec, helper in built_helpers]
    return {
        "schema": SCHEMA,
        "status": "assembled",
        "source_commit": source_commit,
        "root": str(destination),
        "helpers": tools,
        "provenance": PROVENANCE_RELATIVE.as_posix(),
        "provenance_sha256": sha256_file(provenance),
        "intelligence_source": intelligence_binding(intelligence) if intelligence is not None else None,
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
    # Use the same single provenance policy as assembly, including the
    # exact external Creator commit and Git tree for the Native helper.
    expected = tool_provenance(spec, helper)
    if record != expected:
        raise AssemblyError(
            f"Native helper provenance does not match assembled bytes: {spec['relative']}"
        )
    return expected


def verify(destination: Path, *, require_intelligence: bool = False) -> dict:
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
    bound = provenance.get("intelligence_source")
    if require_intelligence and bound is None:
        raise AssemblyError("Native release is missing required external Intelligence binding")
    if bound is not None:
        checked = verify_canonical_intelligence_system(destination / "system")
        if bound != intelligence_binding(checked):
            raise AssemblyError("Native release Intelligence binding differs from packaged bytes")
    return {
        "status": "verified",
        "source_commit": provenance.get("source_commit"),
        "helpers": verified,
        "intelligence_source": bound,
        "physical_apply_authorized": False,
        "component_publish_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    assemble_parser = sub.add_parser("assemble")
    assemble_parser.add_argument("--out", type=Path, required=True)
    assemble_parser.add_argument("--system-source", type=Path, default=SYSTEM)
    assemble_parser.add_argument("--creator-source", type=Path, default=ROOT / "creator", help="creator/ module from same OS Git commit")
    assemble_parser.add_argument("--require-intelligence", action="store_true", help="fail closed unless the Native candidate contains verified Intelligence source")
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--root", type=Path, required=True)
    verify_parser.add_argument("--require-intelligence", action="store_true")
    args = parser.parse_args()
    try:
        result = (assemble(args.out, args.system_source, args.creator_source, require_intelligence=args.require_intelligence)
                  if args.command == "assemble"
                  else verify(args.root, require_intelligence=args.require_intelligence))
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (AssemblyError, OSError) as exc:
        print(f"native-release-assembly: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
