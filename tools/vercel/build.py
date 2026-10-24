#!/usr/bin/env python3
"""Build the Vercel artifact owned by the current canonical OrdaX project.

The public portal and OrdaX Web share one repository and one Vercel policy, but
not one static filesystem. Each project receives exactly one root artifact.
Unknown projects fail closed instead of publishing the wrong product surface.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "out" / "vercel"
PUBLIC_PROJECT_ID = "prj_mA9ew6hOfjdqlBr1cC757iMLPQJC"
WEB_PROJECT_ID = "prj_ftACluUqk6i9DoD9GPIwmgURwckP"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
WEB_DEPLOYMENT_MANIFEST = "web-deployment-manifest.json"
WEB_DEPLOYMENT_SCHEMA = "prototype-ordax.web-deployment-bundle/1"
PUBLIC_ORIGIN = "https://ordax.com.br"
WEB_LOGIN_SOURCE_CONTRACT = "docs/contracts/public-site-source.json"
WEB_IDENTITY_SOURCE_FILES = (
    "assets/site.css",
    "assets/account.css",
    "assets/site.js",
    "i18n/catalog.js",
    "i18n/runtime.js",
    "config/public-site.json",
)
WEB_IDENTITY_SUPPORT_FILES = (
    *WEB_IDENTITY_SOURCE_FILES,
    "assets/ordax-design-tokens.css",
    "assets/ordax-symbol.png",
    "assets/ordax-font.css",
    "assets/fonts/inter-latin-wght-normal.woff2",
)


class DeploymentBuildError(RuntimeError):
    pass


def run(*args: str) -> None:
    result = subprocess.run(args, cwd=ROOT, check=False)
    if result.returncode:
        raise DeploymentBuildError("command failed: " + " ".join(args))


def load_site_source_resolver():
    path = ROOT / "tools/vercel/site_source.py"
    spec = importlib.util.spec_from_file_location("_ordax_external_site_build_source", path)
    if spec is None or spec.loader is None:
        raise DeploymentBuildError("external Site resolver unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.resolve


def clean_output() -> None:
    if OUTPUT.is_symlink():
        raise DeploymentBuildError("refusing linked Vercel output directory")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)


def build_independent_site_candidate(destination: Path) -> str:
    """Invoke the sole Site-owned builder against the exact pinned commit."""
    checkout, site_commit = load_site_source_resolver()()
    builder = checkout / "scripts/build.py"
    lock = checkout / "contracts/migration-artifact-lock.json"
    run(sys.executable, str(builder), "build",
        "--source-commit", site_commit,
        "--migration-lock", str(lock),
        "--public-origin", PUBLIC_ORIGIN,
        "--out", str(destination))
    run(sys.executable, str(builder), "verify", "--out", str(destination))
    return site_commit


def build_public(source_commit: str) -> None:
    # The Vercel account gateway stays in OS; all static Site output now
    # belongs to the independent Site builder. No local portal fallback.
    del source_commit
    build_independent_site_candidate(OUTPUT)


def copy_unique(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_file():
        raise DeploymentBuildError(f"invalid Web identity support file: {source}")
    if destination.exists():
        raise DeploymentBuildError(f"Web identity support collides with Surface output: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compose_web_identity_bootstrap(source_commit: str) -> None:
    """Compose Web login from the independently verified Site bundle.

    One owner renders its HTML, styles and brand. Web selects only the
    necessary output files and rewrites off-host public-account links.
    """
    del source_commit
    # No private OS copy of the Site renderer, CSS compiler or HTML is used.
    with tempfile.TemporaryDirectory(prefix=".ordax-web-site-", dir=ROOT / "out") as tmp:
        candidate = Path(tmp) / "site"
        build_independent_site_candidate(candidate)
        for relative in WEB_IDENTITY_SUPPORT_FILES:
            copy_unique(candidate / relative, OUTPUT / relative)
        login_source = candidate / "login/index.html"
        if not login_source.is_file() or login_source.is_symlink():
            raise DeploymentBuildError("pinned Site bundle lacks login route")
        login_html = login_source.read_text(encoding="utf-8")

    # Match the public portal's deterministic cache-busting for the shared
    # generated token bridge and shared presentation runtime. Stable bytes keep
    # stable URLs; there is no clock-based versioning.
    for asset in ("assets/ordax-design-tokens.css", "assets/site.js"):
        version = sha256_file(OUTPUT / asset)[:16]
        pattern = r'(["\'])/' + re.escape(asset) + r'(?:\?[^"\']*)?(["\'])'
        login_html = re.sub(
            pattern,
            lambda match: match[1] + "/" + asset + "?v=" + version + match[2],
            login_html,
        )

    # Account creation/recovery, legal documents and portal-only destinations
    # keep their canonical public owner. Only password sign-in is hosted on Web
    # because its resulting cookie must be host-only for web.ordax.com.br.
    for route in ("cadastro", "recuperar", "privacidade", "termos", "download", "licencas"):
        login_html = login_html.replace(
            f'href="/{route}/"',
            f'href="{PUBLIC_ORIGIN}/{route}/"',
        )

    login_destination = OUTPUT / "login/index.html"
    if login_destination.exists():
        raise DeploymentBuildError("Web login path already exists")
    login_destination.parent.mkdir(parents=True, exist_ok=True)
    login_destination.write_text(login_html, encoding="utf-8")

    config = json.loads((OUTPUT / "config/public-site.json").read_text(encoding="utf-8"))
    if config.get("identity", {}).get("login_url") != "/auth/login":
        raise DeploymentBuildError("Web login bootstrap lost canonical same-origin auth route")
    if not re.fullmatch(
        r"0x[A-Za-z0-9_-]{20,80}",
        str(config.get("identity", {}).get("turnstile_sitekey", "")),
    ):
        raise DeploymentBuildError("Web login bootstrap requires the canonical Turnstile sitekey")
    if 'data-identity-form="login"' not in login_html:
        raise DeploymentBuildError("Web login bootstrap is missing the canonical login form")
    if "/ordax/" in login_html:
        raise DeploymentBuildError("legacy /ordax mount leaked into Web login bootstrap")

    # Every local static dependency named by the login document must exist in
    # the final artifact. Product navigation is intentionally excluded here.
    local_static = set(
        re.findall(r'(?:href|src)="(/(?:assets|i18n|config)/[^"?#]+)', login_html)
    )
    missing = sorted(path for path in local_static if not (OUTPUT / path.lstrip("/")).is_file())
    if missing:
        raise DeploymentBuildError(f"Web login static dependency closure is incomplete: {missing}")


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
    source_pin = json.loads((ROOT / WEB_LOGIN_SOURCE_CONTRACT).read_text(encoding="utf-8"))
    manifest = {
        "$schema": WEB_DEPLOYMENT_SCHEMA,
        "source_commit": source_commit,
        "site_source_repository": source_pin["repository"],
        "site_source_commit": source_pin["commit"],
        "surface_manifest": "web-client-manifest.json",
        "login_path": "/login/",
        "login_presentation_owner": "ordaxsystems/ordax-site:site/login/index.html",
        "login_runtime_owner": "ordaxsystems/ordax-site:site/assets/site.js",
        "host_only_session_required": True,
        "identity_support_files": list(WEB_IDENTITY_SUPPORT_FILES),
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
