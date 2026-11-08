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


def consumed_paths(owner: str, lock: dict) -> tuple[str, ...]:
    if owner == "intelligence":
        # Every portable module below src is part of one source graph. The
        # technical builder is consumed explicitly; optional platform builders
        # elsewhere in tools/inference-builder remain independent.
        return ("src", "tools/inference-builder/build.py")
    return tuple(OWNERS[owner]["paths"])


def select_source_commit(root: Path, owner: str, checkout: Path) -> str:
    """Select the last first-parent main commit changing OS-consumed bytes.

    A later documentation-only main commit is not necessarily subject to the
    owner's path-filtered push CI. Pin the source-producing main SHA, never a
    moving ref, so the upstream CI check remains meaningful.
    """
    if owner not in OWNERS:
        raise SourceAdvanceError("unrecognized source owner")
    if checkout.is_symlink() or not checkout.is_dir():
        raise SourceAdvanceError("source must be a real Git checkout")
    checkout = checkout.resolve(strict=True)
    lock = module_for(root.resolve(strict=True), owner).load_lock(
        root.resolve(strict=True) / OWNERS[owner]["lock"]
    )
    old = lock["source_commit"]
    head = git(checkout, "rev-parse", "HEAD").stdout.decode("ascii").strip()
    if not SHA.fullmatch(head):
        raise SourceAdvanceError("upstream main HEAD must be an exact Git SHA")
    if git(checkout, "merge-base", "--is-ancestor", old, head, accepted=(0, 1)).returncode:
        raise SourceAdvanceError("upstream main does not descend from pinned source")
    touched = git(
        checkout, "log", "--first-parent", "-1", "--format=%H", "HEAD",
        "--", *consumed_paths(owner, lock),
    ).stdout.decode("ascii").strip()
    if not SHA.fullmatch(touched):
        raise SourceAdvanceError("no trustworthy source-changing commit on upstream main")
    # The OS pin can point to a newer documentation-only SHA from a previous
    # integration. Never roll backwards just to select an earlier source edit.
    if git(checkout, "merge-base", "--is-ancestor", touched, old, accepted=(0, 1)).returncode == 0:
        return old
    if git(checkout, "merge-base", "--is-ancestor", old, touched, accepted=(0, 1)).returncode:
        raise SourceAdvanceError("source-changing commit is unrelated to current OS pin")
    return touched


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
    # Intelligence integrates the complete portable src graph plus its one
    # technical builder, not a mirror of independently evolving platform tools.
    # Additions/removals below src therefore advance the immutable OS pin.
    owned_paths = consumed_paths(owner, previous)
    diff = git(checkout, "diff", "--quiet", old, target, "--", *owned_paths, accepted=(0, 1))
    if diff.returncode == 0:
        return {"owner": owner, "changed": False, "reason": "no-owned-source-change", "source_commit": old}
    proposed = dict(previous)
    proposed["source_commit"] = target
    if owner == "intelligence":
        proposed["source_paths"] = materializer.source_tree_blobs(checkout)
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
    parser.add_argument("--select-source", action="store_true",
                        help="print exact last source-changing main commit for path-filtered CI")
    args = parser.parse_args()
    if args.select_source:
        if args.apply:
            parser.error("--select-source never modifies OS locks")
        print(select_source_commit(args.root, args.owner, args.source_dir))
    else:
        print(json.dumps(advance(args.root, args.owner, args.source_dir, args.apply), sort_keys=True))


if __name__ == "__main__":
    main()
