#!/usr/bin/env python3
"""Owner/Dev component orchestrator. No CI dependency, release or physical writes."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCES = {
    "base": ("bootstrap/independent-base", "bootstrap/kernel/source.json",
             "bootstrap/network/source.json", "bootstrap/stable-base/source.json",
             "docs/contracts/portable-boot-handoff.json",
             "bootstrap/stable-base/ordax-stable-init"),
    "surface": ("bootstrap/surface-runtime", "bootstrap/independent-base/source.json",
                "bootstrap/kernel/source.json"),
}
SCRIPTS = {
    "base": ROOT / "bootstrap/independent-base/build.py",
    "surface": ROOT / "bootstrap/surface-runtime/build.py",
}


def fingerprint(component: str) -> str:
    """Include tracked source bytes, recipe, relative paths and host environment."""
    sha = hashlib.sha256()
    sha.update(("ordax-dev-component-v1\0" + component + "\0").encode())
    sha.update((os.uname().sysname + "\0" + os.uname().machine + "\0").encode())
    paths = []
    for name in SOURCES[component]:
        path = ROOT / name
        if path.is_file():
            paths.append(path)
        elif path.is_dir():
            paths.extend(p for p in path.rglob("*") if p.is_file() and not p.is_symlink()
                             and ".git" not in p.parts and "__pycache__" not in p.parts)
        else:
            raise RuntimeError("missing source input: " + name)
    for path in sorted(set(paths)):
        relative = path.relative_to(ROOT).as_posix()
        sha.update(relative.encode() + b"\0")
        sha.update(hashlib.sha256(path.read_bytes()).digest())
    return sha.hexdigest()


def run(*args: str) -> None:
    subprocess.run([sys.executable, *args], cwd=ROOT, check=True)


def verified(component: str, target: Path, identity: str) -> bool:
    marker = target / ".ordax-dev-component.json"
    if not marker.is_file():
        return False
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
        if data != {"component": component, "fingerprint": identity}:
            return False
        cmd = [str(SCRIPTS[component]), "verify", "--out", str(target)]
        if component == "base":
            cmd += ["--profile", "owner-development"]
        run(*cmd)
        return True
    except (ValueError, OSError, subprocess.CalledProcessError):
        return False


def component(component: str, root: Path, jobs: int, build: bool) -> dict:
    identity = fingerprint(component)
    target = root / component / identity
    if verified(component, target, identity):
        return {"component": component, "status": "reused-verified", "path": str(target),
                "fingerprint": identity}
    if not build:
        return {"component": component, "status": "needs-build", "path": str(target),
                "fingerprint": identity}
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".ordax-build-", dir=target.parent))
    try:
        cmd = [str(SCRIPTS[component]), "build", "--out", str(staging),
               "--jobs", str(jobs)]
        if component == "base":
            cmd += ["--profile", "owner-development", "--cache", str(root / "downloads" / "base")]
        else:
            cmd += ["--cache", str(root / "downloads" / "surface")]
        run(*cmd)
        verify_cmd = [str(SCRIPTS[component]), "verify", "--out", str(staging)]
        if component == "base":
            verify_cmd += ["--profile", "owner-development"]
        run(*verify_cmd)
        (staging / ".ordax-dev-component.json").write_text(
            json.dumps({"component": component, "fingerprint": identity}, sort_keys=True) + "\n",
            encoding="utf-8")
        if target.exists():
            if verified(component, target, identity):
                return {"component": component, "status": "reused-verified", "path": str(target),
                        "fingerprint": identity}
            raise RuntimeError("existing invalid output; do not overwrite: " + str(target))
        staging.rename(target)
        return {"component": component, "status": "built-verified", "path": str(target),
                "fingerprint": identity}
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "build"])
    parser.add_argument("--component", choices=["base", "surface", "all"], default="all")
    parser.add_argument("--root", type=Path, default=Path.home() / ".cache/ordax/dev-components")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    if root == ROOT or ROOT in root.parents:
        parser.error("artifact root must be outside source checkout")
    if args.jobs < 1 or args.jobs > 64:
        parser.error("--jobs must be 1..64")
    targets = ("base", "surface") if args.component == "all" else (args.component,)
    try:
        results = [component(c, root, args.jobs, args.action == "build") for c in targets]
        print(json.dumps({"status": "dev-components-only", "physical_write": False,
                          "stable_publication": False, "results": results}, indent=2))
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print("ordax dev components: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
