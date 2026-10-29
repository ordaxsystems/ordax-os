#!/usr/bin/env python3
"""Resolve the immutable public Site source for OS-owned Web login composition.

This is a build-time source input, not a second public-site builder or runtime.
An exact pinned Git commit is mandatory; no branch tracking or source fallback.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "docs/contracts/public-site-source.json"
STAGE = ROOT / "out/site-source"
SOURCE_REPO = "ordaxsystems/ordax-site"
SOURCE_URL = "https://github.com/ordaxsystems/ordax-site.git"
SCHEMA = "prototype-ordax.external-public-site-source/1"
PIN = re.compile(r"^[0-9a-f]{40}$")
CLOSURE = (
    "site/login/index.html",
    "site/assets/site.css",
    "site/assets/account.css",
    "site/assets/site.js",
    "site/i18n/catalog.js",
    "site/i18n/runtime.js",
    "site/config/public-site.json",
    "scripts/public_html_render.py",
)


class SiteSourceError(RuntimeError):
    pass


def contract() -> dict:
    source = json.loads(CONTRACT.read_text(encoding="utf-8"))
    if (not isinstance(source, dict)
        or source.get("$schema") != SCHEMA
        or source.get("status") != "development-source-repoint"
        or source.get("repository") != SOURCE_REPO
        or not isinstance(source.get("commit"), str)
        or not PIN.fullmatch(source["commit"])
        or source.get("source_subdirectory") != "site"
        or source.get("render_helper") != "scripts/public_html_render.py"
        or source.get("production_deployment_activated") is not False):
        raise SiteSourceError("external Site source pin contract invalid")
    return source


def git(path: Path, *args: str) -> str:
    result = subprocess.run(
        ("git", "-C", str(path), *args), check=False, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
    )
    if result.returncode:
        raise SiteSourceError("cannot verify pinned public Site Git source: " + " ".join(args[:2]))
    return result.stdout.strip()


def validate_checkout(path: Path, expected: str) -> Path:
    if path.is_symlink() or not path.is_dir() or not (path / ".git").is_dir():
        raise SiteSourceError("external Site checkout is missing or linked")
    if git(path, "rev-parse", "HEAD") != expected:
        raise SiteSourceError("external Site checkout is not at the canonical pinned commit")
    # An edited local file is never a valid source, even if HEAD remains pinned.
    if git(path, "status", "--porcelain", "--untracked-files=all"):
        raise SiteSourceError("external Site checkout has uncommitted modifications")
    for name in CLOSURE:
        file = path / name
        if file.is_symlink() or not file.is_file():
            raise SiteSourceError("pinned Site source closure missing: " + name)
    return path


def resolve() -> tuple[Path, str]:
    pin = contract()["commit"]
    checkout = STAGE / pin
    if checkout.exists():
        return validate_checkout(checkout, pin), pin
    STAGE.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=".site-source-", dir=STAGE))
    try:
        git(temp, "init", "-q")
        git(temp, "remote", "add", "origin", SOURCE_URL)
        # Fetch precisely one verified revision. No branch or mutable URL input.
        git(temp, "fetch", "--depth=1", "--no-tags", "origin", pin)
        git(temp, "checkout", "--detach", "-q", "FETCH_HEAD")
        validate_checkout(temp, pin)
        temp.rename(checkout)
        return checkout, pin
    finally:
        if temp.exists():
            shutil.rmtree(temp)
