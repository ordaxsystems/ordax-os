#!/usr/bin/env python3
"""Assemble one disposable, reproducible OS system/ tree from pinned Surface source.

The OS supplies system services and host. The Surface supplies only the two
visual trees. No checkout, tracked OS source or running device is modified.
Release-bundle, portable image and other builders consume --out-root as normal.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ordax_surface_source_materialize", HERE / "materialize.py")
assert SPEC and SPEC.loader
source = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source)

VISUAL = ("ui", "workspace")
PROVENANCE = "system/surface/source-provenance.json"


def require_tree(root: Path) -> None:
    """Reject links or special files anywhere in the release's OS tree."""
    if not root.is_dir() or root.is_symlink():
        raise source.SurfaceSourceError("OS system root is missing or linked")
    for directory, folders, files in os.walk(root, followlinks=False):
        for name in (*folders, *files):
            item = Path(directory) / name
            mode = item.lstat().st_mode
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise source.SurfaceSourceError("non-regular OS system entry: " + str(item))


def os_head(root: Path) -> str:
    process = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        capture_output=True, check=False, text=True,
    )
    value = process.stdout.strip()
    if process.returncode or not source.SHA40.fullmatch(value):
        raise source.SurfaceSourceError("OS source must be an exact Git checkout")
    return value


def ensure_not_inside(output: Path, root: Path, surface_root: Path) -> None:
    resolved = output.resolve(strict=False)
    for parent in (root.resolve(strict=True), surface_root.resolve(strict=True)):
        if os.path.commonpath((str(resolved), str(parent))) == str(parent):
            raise source.SurfaceSourceError("release staging cannot modify an input checkout")
    if output.exists() or output.is_symlink():
        raise source.SurfaceSourceError("release staging output exists; overwrite forbidden")
    if not output.parent.is_dir() or output.parent.is_symlink():
        raise source.SurfaceSourceError("release staging parent must be a real directory")


def assemble(os_root: Path, surface_root: Path, output: Path, lock_file: Path = source.LOCK_PATH) -> dict:
    os_root = os_root.resolve(strict=True)
    surface_root = surface_root.resolve(strict=True)
    output = output.absolute()
    ensure_not_inside(output, os_root, surface_root)
    lock = source.load_lock(lock_file)
    records, visual_receipt = source.verify_source(surface_root, lock)
    system = os_root / "system"
    require_tree(system)
    os_sha = os_head(os_root)
    if (system / "surface/source-provenance.json").exists():
        raise source.SurfaceSourceError("OS may not own a second Surface provenance receipt")
    tmp = Path(tempfile.mkdtemp(prefix=".ordax-system-stage-", dir=output.parent))
    try:
        def ignore(directory: str, contents: list[str]) -> set[str]:
            # The old OS visual source NEVER enters the final build. While
            # cutover is in progress this also permits safe branch testing.
            if Path(directory).resolve() == (system / "surface").resolve():
                return set(VISUAL).intersection(contents)
            return set()

        shutil.copytree(system, tmp / "system", ignore=ignore, symlinks=True)
        for part in VISUAL:
            if (tmp / "system/surface" / part).exists():
                raise source.SurfaceSourceError("two Surface source trees in staged release")

        for relative, payload in records:
            dest = tmp.joinpath(*PurePosixPath(relative).parts)
            if dest.exists() or dest.is_symlink():
                raise source.SurfaceSourceError("staged path collision: " + relative)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(payload)
            # Exact revision/byte verification is handled by verify_source;
            # source mode must match the mode committed in its Git tree.
            source_mode = stat.S_IMODE((surface_root / relative).stat().st_mode)
            if source_mode not in (0o644, 0o755):
                raise source.SurfaceSourceError("non-canonical Surface source file mode")
            dest.chmod(source_mode)

        receipt = {
            "$schema": "prototype-ordax.surface-assembly/1",
            "os_commit": os_sha,
            "surface_source_repository": visual_receipt["source_repository"],
            "surface_source_commit": visual_receipt["source_commit"],
            "visual_file_count": visual_receipt["file_count"],
            "visual_source_sha256": visual_receipt["visual_source_sha256"],
            "visual_paths": visual_receipt["paths"],
            "old_os_visual_source_packaged": False,
            "host_owner": "ordaxsystems/ordax-os",
            "user_interface_owner": "ordaxsystems/ordax-surface",
        }
        dest_receipt = tmp / PROVENANCE
        dest_receipt.parent.mkdir(parents=True, exist_ok=True)
        dest_receipt.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        require_tree(tmp / "system")
        # The source code may not re-enter via any secondary path.
        if not (tmp / "system/entrypoint").is_file():
            raise source.SurfaceSourceError("OS source missing runnable entrypoint")
        if output.exists() or output.is_symlink():
            raise source.SurfaceSourceError("release staging destination appeared during build")
        os.rename(tmp, output)
        return receipt
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--os-root", type=Path, required=True)
    parser.add_argument("--surface-root", type=Path, required=True)
    parser.add_argument("--out-root", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=source.LOCK_PATH)
    args = parser.parse_args()
    print(json.dumps(assemble(args.os_root, args.surface_root, args.out_root, args.lock), sort_keys=True))


if __name__ == "__main__":
    main()
