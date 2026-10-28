#!/usr/bin/env python3
"""Advance only the OS-owned immutable source lock of an approved external owner.

This does not publish a release, change activation policy, or update a device.
The existing Surface/Intelligence materializers remain the only byte verifiers.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OWNERS = {
    "surface": {
        "lock": "docs/contracts/surface-source.json",
        "module": "tools/surface-source/materialize.py",
        "paths": ("system/surface/ui", "system/surface/workspace"),
    },
    "intelligence": {
        "lock": "docs/contracts/intelligence-source.json",
        "module": "tools/intelligence-source/materialize.py",
        "paths": ("src", "tools/inference-builder"),
    },
}
SHA = re.compile(r"[0-9a-f]{40}\Z")


class SourceAdvanceError(ValueError):
    pass


def git(source: Path, *args: str, accepted: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess:
    result = subprocess.run(
        ["git", "-C", str(source), *args], capture_output=True, check=False,
    )
    if result.returncode not in accepted:
        raise SourceAdvanceError("Git source validation failed: " + " ".join(args[:2]))
    return result


def module_for(root: Path, owner: str):
    path = root / OWNERS[owner]["module"]
    spec = importlib.util.spec_from_file_location("ordax_source_advance_" + owner, path)
    if spec is None or spec.loader is None:
        raise SourceAdvanceError("canonical OS source materializer unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def git_tree_blobs(checkout: Path, required: set[str]) -> dict[str, str]:
    raw = git(checkout, "ls-tree", "-rz", "HEAD", "--", *sorted(required)).stdout
    result = {}
    for record in raw.split(b"\0"):
        if not record:
            continue
        try:
            meta, raw_path = record.split(b"\t", 1)
            mode, kind, blob = meta.decode("ascii").split()
            path = raw_path.decode("utf-8")
        except (ValueError, UnicodeError) as exc:
            raise SourceAdvanceError("malformed source tree record") from exc
        if path not in required or path in result or mode != "100644" or kind != "blob" or not SHA.fullmatch(blob):
            raise SourceAdvanceError("Intelligence candidate changes the fixed source graph")
        result[path] = blob
    if set(result) != required:
        raise SourceAdvanceError("Intelligence candidate has missing or unexpected source files")
    return result


def advance(root: Path, owner: str, checkout: Path, apply: bool = False) -> dict:
    if owner not in OWNERS:
        raise SourceAdvanceError("unrecognized source owner")
    if checkout.is_symlink() or not checkout.is_dir():
        raise SourceAdvanceError("source must be a real Git checkout")
    checkout = checkout.resolve(strict=True)
    root = root.resolve(strict=True)
    config = OWNERS[owner]
    path = root / config["lock"]
    materializer = module_for(root, owner)
    previous = materializer.load_lock(path)
    target = git(checkout, "rev-parse", "HEAD").stdout.decode("ascii").strip()
    if not SHA.fullmatch(target):
        raise SourceAdvanceError("external HEAD is not a full immutable SHA")
    old = previous["source_commit"]
    if not SHA.fullmatch(old):
        raise SourceAdvanceError("invalid previous source revision")
    if old == target:
        return {"owner": owner, "changed": False, "reason": "already-pinned", "source_commit": target}
    # Require a descendant; never interpret a force-pushed or unrelated main
    # as a routine update. CI fetches complete history for this reason.
    ancestor = git(checkout, "merge-base", "--is-ancestor", old, target, accepted=(0, 1))
    if ancestor.returncode:
        raise SourceAdvanceError("candidate does not descend from the pinned source")
    diff = git(checkout, "diff", "--quiet", old, target, "--", *config["paths"], accepted=(0, 1))
    if diff.returncode == 0:
        return {"owner": owner, "changed": False, "reason": "no-owned-source-change", "source_commit": old}
    proposed = dict(previous)
    proposed["source_commit"] = target
    if owner == "intelligence":
        proposed["source_paths"] = git_tree_blobs(checkout, set(previous["source_paths"]))
    # Reuse the exact already-tested OS authority, including blob, mode,
    # symlink, size, cleanliness and public contract validation.
    materializer.verify_source(checkout, proposed)
    if owner == "intelligence":
        if (proposed["status"] != previous["status"]
                or proposed["activation_authorized"] is not False
                or proposed["cutover_complete"] is not False):
            raise SourceAdvanceError("source update cannot promote Intelligence activation")
    if apply:
        path.write_text(json.dumps(proposed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        materializer.load_lock(path)
    return {"owner": owner, "changed": True, "source_commit": target, "applied": apply}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", choices=sorted(OWNERS), required=True)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(advance(args.root, args.owner, args.source_dir, args.apply), sort_keys=True))


if __name__ == "__main__":
    main()
