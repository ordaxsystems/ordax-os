#!/usr/bin/env python3
"""Build the Vercel artifact owned by the current canonical OrdaX project.

The public portal and OrdaX Web share one repository and one Vercel policy, but
not one static filesystem. Each project receives exactly one root artifact.
Unknown projects fail closed instead of publishing the wrong product surface.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "out" / "vercel"
PUBLIC_PROJECT_ID = "prj_mA9ew6hOfjdqlBr1cC757iMLPQJC"
WEB_PROJECT_ID = "prj_ftACluUqk6i9DoD9GPIwmgURwckP"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")


class DeploymentBuildError(RuntimeError):
    pass


def run(*args: str) -> None:
    result = subprocess.run(args, cwd=ROOT, check=False)
    if result.returncode:
        raise DeploymentBuildError("command failed: " + " ".join(args))


def clean_output() -> None:
    if OUTPUT.is_symlink():
        raise DeploymentBuildError("refusing linked Vercel output directory")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)


def build_public(source_commit: str) -> None:
    run(sys.executable, "tools/public-site/build.py", "check")
    run(
        sys.executable,
        "tools/public-site/build.py",
        "build",
        "--source-commit",
        source_commit,
        "--out-dir",
        str(OUTPUT),
    )
    run(sys.executable, "tools/public-site/build.py", "verify", "--out-dir", str(OUTPUT))


def build_web(source_commit: str) -> None:
    run(sys.executable, "tools/surface-web/build.py", "check")
    run(
        sys.executable,
        "tools/surface-web/build.py",
        "build",
        "--source-commit",
        source_commit,
        "--mount-path",
        "/",
        "--out-dir",
        str(OUTPUT),
    )
    run(sys.executable, "tools/surface-web/build.py", "verify", "--out-dir", str(OUTPUT))
    manifest = json.loads((OUTPUT / "web-client-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("mount_path") != "/":
        raise DeploymentBuildError("OrdaX Web must own the deployment root")
    index = (OUTPUT / "index.html").read_text(encoding="utf-8")
    if "/ordax/" in index:
        raise DeploymentBuildError("legacy /ordax mount leaked into OrdaX Web root")


def main() -> int:
    project_id = (os.environ.get("VERCEL_PROJECT_ID") or "").strip()
    source_commit = (os.environ.get("VERCEL_GIT_COMMIT_SHA") or "").strip().lower()
    if not SHA40_RE.fullmatch(source_commit):
        print("VERCEL_DEPLOYMENT_ERROR=canonical Git commit SHA required", file=sys.stderr)
        return 1

    role = {
        PUBLIC_PROJECT_ID: "public-site",
        WEB_PROJECT_ID: "ordax-web",
    }.get(project_id)
    if role is None:
        print("VERCEL_DEPLOYMENT_ERROR=unrecognized canonical project", file=sys.stderr)
        return 1

    try:
        clean_output()
        if project_id == PUBLIC_PROJECT_ID:
            build_public(source_commit)
        else:
            build_web(source_commit)
        print("VERCEL_DEPLOYMENT_BUILD=PASS")
        print(f"VERCEL_DEPLOYMENT_ROLE={role}")
        print(f"VERCEL_DEPLOYMENT_SOURCE_COMMIT={source_commit}")
        return 0
    except (DeploymentBuildError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"VERCEL_DEPLOYMENT_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
