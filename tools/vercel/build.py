#!/usr/bin/env python3
"""Build the Vercel artifact owned by the current canonical OrdaX project.

The public portal and OrdaX Web share one repository and one Vercel policy, but
not one static filesystem. Each project receives exactly one root artifact.
Unknown projects fail closed instead of publishing the wrong product surface.
"""
from __future__ import annotations

import hashlib
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
WEB_DEPLOYMENT_MANIFEST = "web-deployment-manifest.json"
WEB_DEPLOYMENT_SCHEMA = "prototype-ordax.web-deployment-bundle/1"
PUBLIC_ORIGIN = "https://ordax.com.br"


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


def copy_unique(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_file():
        raise DeploymentBuildError(f"invalid Web identity support file: {source}")
    if destination.exists():
        raise DeploymentBuildError(f"Web identity support collides with Surface output: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def copy_tree_unique(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        raise DeploymentBuildError(f"invalid Web identity support directory: {source}")
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise DeploymentBuildError(f"linked Web identity support input: {path}")
        if path.is_file():
            copy_unique(path, destination / path.relative_to(source))


def compose_web_identity_bootstrap(source_commit: str) -> None:
    """Derive Web login from the canonical public Account presentation.

    The dedicated Web host owns its own HttpOnly session cookie, so anonymous
    users need a same-origin credential POST. The public Account presentation
    remains the single source: this step copies only its verified login runtime
    into the Web artifact and never copies the public portal root.
    """
    candidate = ROOT / "out" / "web-identity-bootstrap"
    if candidate.is_symlink():
        raise DeploymentBuildError("refusing linked Web identity bootstrap directory")
    if candidate.exists():
        shutil.rmtree(candidate)
    try:
        run(sys.executable, "tools/public-site/build.py", "check")
        run(
            sys.executable,
            "tools/public-site/build.py",
            "build",
            "--source-commit",
            source_commit,
            "--out-dir",
            str(candidate),
        )
        run(sys.executable, "tools/public-site/build.py", "verify", "--out-dir", str(candidate))

        copy_tree_unique(candidate / "assets", OUTPUT / "assets")
        copy_tree_unique(candidate / "i18n", OUTPUT / "i18n")
        copy_tree_unique(candidate / "config", OUTPUT / "config")

        source_login = candidate / "login" / "index.html"
        login_html = source_login.read_text(encoding="utf-8")
        # Account creation/recovery and legal documents keep their canonical
        # public owner. Only password sign-in is hosted on Web because the
        # resulting session cookie must be host-only for web.ordax.com.br.
        for route in ("cadastro", "recuperar", "privacidade", "termos"):
            login_html = login_html.replace(
                f'href="/{route}/"',
                f'href="{PUBLIC_ORIGIN}/{route}/"',
            )
        login_destination = OUTPUT / "login" / "index.html"
        if login_destination.exists():
            raise DeploymentBuildError("Web login path already exists")
        login_destination.parent.mkdir(parents=True, exist_ok=True)
        login_destination.write_text(login_html, encoding="utf-8")

        config = json.loads((OUTPUT / "config" / "public-site.json").read_text(encoding="utf-8"))
        if config.get("identity", {}).get("login_url") != "/auth/login":
            raise DeploymentBuildError("Web login bootstrap lost canonical same-origin auth route")
        if not re.fullmatch(r"0x[A-Za-z0-9_-]{20,80}", str(config.get("identity", {}).get("turnstile_sitekey", ""))):
            raise DeploymentBuildError("Web login bootstrap requires the canonical Turnstile sitekey")
        if 'data-identity-form="login"' not in login_html:
            raise DeploymentBuildError("Web login bootstrap is missing the canonical login form")
        if "/ordax/" in login_html:
            raise DeploymentBuildError("legacy /ordax mount leaked into Web login bootstrap")
    finally:
        shutil.rmtree(candidate, ignore_errors=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_web_deployment_manifest(source_commit: str) -> None:
    records = []
    for path in sorted(OUTPUT.rglob("*")):
        if not path.is_file() or path.name == WEB_DEPLOYMENT_MANIFEST:
            continue
        records.append({
            "path": path.relative_to(OUTPUT).as_posix(),
            "sha256": sha256_file(path),
            "size": path.stat().st_size,
        })
    manifest = {
        "$schema": WEB_DEPLOYMENT_SCHEMA,
        "source_commit": source_commit,
        "surface_manifest": "web-client-manifest.json",
        "login_path": "/login/",
        "login_presentation_owner": "sites/public/login/index.html",
        "login_runtime_owner": "sites/public/assets/site.js",
        "host_only_session_required": True,
        "files": records,
    }
    (OUTPUT / WEB_DEPLOYMENT_MANIFEST).write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


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

    compose_web_identity_bootstrap(source_commit)
    write_web_deployment_manifest(source_commit)


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
