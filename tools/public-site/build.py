#!/usr/bin/env python3
"""Build and verify the dependency-free OrdaX public site candidate."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

from public_release_catalog import (
    PublicReleaseCatalogError,
    load_publications,
    validate_catalog,
    write_catalog,
)
from playground_fixture import PlaygroundFixtureError, validate_fixture
from public_html_render import render_public_html

# Load the brand compiler by an isolated module identity. Importing a generic
# "build" module or prepending to sys.path shadows the component-package
# builder elsewhere in the OS foundation and corrupts unrelated releases.
import importlib.util

_BRAND_COMPILER_PATH = Path(__file__).resolve().parents[1] / "brand" / "build.py"
_BRAND_SPEC = importlib.util.spec_from_file_location("_ordax_brand_compiler", _BRAND_COMPILER_PATH)
if _BRAND_SPEC is None or _BRAND_SPEC.loader is None:
    raise RuntimeError("canonical OrdaX brand compiler unavailable")
_BRAND_MODULE = importlib.util.module_from_spec(_BRAND_SPEC)
_BRAND_SPEC.loader.exec_module(_BRAND_MODULE)
render_site_css = _BRAND_MODULE.render_site_css
render_site_identity_css = _BRAND_MODULE.render_site_identity_css
render_site_font_css = _BRAND_MODULE.render_site_font_css

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "sites" / "public"
CANONICAL_SYMBOL = ROOT / "system" / "surface" / "ui" / "brand" / "ordax-symbol.png"
PUBLIC_SYMBOL_PATH = "assets/ordax-symbol.png"
CANONICAL_WALLPAPER = ROOT / "system/surface/ui/brand/midnight-landscape.png"
CANONICAL_FONT = ROOT / "system/surface/ui/fonts/inter-latin-wght-normal.woff2"
CANONICAL_FONT_LICENSE = ROOT / "third_party/licenses/Inter-OFL-1.1.txt"
PUBLICATIONS = ROOT / "platform" / "releases" / "publications.json"
LEGAL_READINESS = ROOT / "docs" / "contracts" / "public-legal-readiness.json"
AUTH_HARDENING = ROOT / "docs" / "contracts" / "public-auth-hardening.json"
PUBLIC_CATALOG_RELATIVE = Path("releases/catalog.json")
MANIFEST_NAME = "public-site-manifest.json"
SCHEMA = "prototype-ordax.public-site-bundle/1"
CONFIG_SCHEMA = "prototype-ordax.public-site-runtime/1"
TURNSTILE_RUNTIME_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
TURNSTILE_SITEKEY_RE = re.compile(r"^0x[A-Za-z0-9_-]{20,80}$")
REMOTE_RUNTIME_ALLOWLIST = {
    "assets/site.js": (TURNSTILE_RUNTIME_URL,),
}
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
# Non-fetching URI constants embedded by the audited React/TanStack runtime.
# These represent DOM namespaces, vendor documentation and the Router SSR
# fallback (window.origin is always authoritative in browsers). The browser CSP
# still permits connect-src 'self' only. Never allow arbitrary external URLs.
ACCOUNT_UI_STATIC_URIS = (
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1998/Math/MathML",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/XML/1998/namespace",
    "https://react.dev/errors/",
    "http://localhost",
)

REMOTE_HTML_REF_RE = re.compile(r"\\b(?:src|href)\\s*=\\s*['\"]//", re.IGNORECASE)
PROTOCOL_RELATIVE_CSS_TOKENS = (
    "url(//",
    "url('//",
    'url("//',
    "@import //",
    "@import '//",
    '@import "//',
)
REQUIRED_FILES = (
    "index.html",
    "download/index.html",
    "login/index.html",
    "cadastro/index.html",
    "recuperar/index.html",
    "recuperar/nova-senha/index.html",
    "conta/index.html",
    "web/index.html",
    "assets/account-dashboard.css",
    "assets/account-portal.js",
    "licencas/index.html",
    "privacidade/index.html",
    "termos/index.html",
    "assets/site.css",
    "assets/site.js",
    "i18n/catalog.js",
    "i18n/runtime.js",
    "assets/playground-fixture.json",
    "config/public-site.json",
)


class PublicSiteError(RuntimeError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def same_origin_path(value: object) -> bool:
    return value is None or (
        isinstance(value, str)
        and value.startswith("/")
        and not value.startswith("//")
    )


def source_files(root: Path = SOURCE) -> list[Path]:
    if not root.is_dir():
        raise PublicSiteError(f"missing public site source root: {root}")
    files = sorted(
        (path for path in root.rglob("*") if path.is_file()),
        key=lambda p: p.relative_to(root).as_posix(),
    )
    if not files:
        raise PublicSiteError("public site source is empty")
    if root.resolve() == SOURCE.resolve():
        try:
            validate_fixture()
        except PlaygroundFixtureError as exc:
            raise PublicSiteError(str(exc)) from exc

    return files


def validate_source(root: Path = SOURCE) -> list[Path]:
    files = source_files(root)
    relative = {path.relative_to(root).as_posix() for path in files}
    missing = sorted(set(REQUIRED_FILES) - relative)
    if missing:
        raise PublicSiteError(f"missing required public site files: {missing}")

    for path in files:
        suffix = path.suffix.lower()
        relative_path = path.relative_to(root).as_posix()
        if suffix == ".txt":
            if (root.resolve() == SOURCE.resolve()
                    or relative_path != "assets/fonts/Inter-OFL-1.1.txt"
                    or path.read_bytes() != CANONICAL_FONT_LICENSE.read_bytes()):
                raise PublicSiteError("public font license must match its canonical owner")
            continue
        if suffix == ".woff2":
            if (root.resolve() == SOURCE.resolve()
                    or relative_path != "assets/fonts/" + CANONICAL_FONT.name
                    or path.read_bytes() != CANONICAL_FONT.read_bytes()):
                raise PublicSiteError("public font must be the generated canonical Surface asset")
            continue
        if relative_path == PUBLIC_SYMBOL_PATH:
            # The public bundle derives the symbol from its single Surface owner.
            if (root.resolve() == SOURCE.resolve()
                    or path.read_bytes() != CANONICAL_SYMBOL.read_bytes()):
                raise PublicSiteError("public symbol diverged from Surface owner")
            if path.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
                raise PublicSiteError("invalid canonical PNG symbol")
            continue
        if suffix == ".jpg":
            if not relative_path.startswith("assets/account/") or path.read_bytes()[:3] != bytes((255, 216, 255)):
                raise PublicSiteError("unverified account JPEG asset")
            continue
        if suffix not in {".html", ".css", ".js", ".json", ".md", ".png"}:
            raise PublicSiteError(
                f"unexpected public site source type: {path.relative_to(root).as_posix()}"
            )
        if suffix in {".html", ".css", ".js"}:
            text = path.read_text(encoding="utf-8")
            relative_path = path.relative_to(root).as_posix()
            sanitized = text
            for allowed_url in REMOTE_RUNTIME_ALLOWLIST.get(relative_path, ()):
                sanitized = sanitized.replace(allowed_url, "")
            if relative_path.startswith("assets/account/") and suffix == ".js":
                for nonfetching_uri in ACCOUNT_UI_STATIC_URIS:
                    sanitized = sanitized.replace(nonfetching_uri, "")
            if "http://" in sanitized or "https://" in sanitized:
                raise PublicSiteError(
                    f"undeclared remote runtime reference is not allowed: {relative_path}"
                )
            if suffix == ".html" and REMOTE_HTML_REF_RE.search(text):
                raise PublicSiteError(
                    f"protocol-relative HTML reference is not allowed: {path.relative_to(root).as_posix()}"
                )
            if suffix == ".css" and any(token in text.lower() for token in PROTOCOL_RELATIVE_CSS_TOKENS):
                raise PublicSiteError(
                    f"protocol-relative CSS reference is not allowed: {path.relative_to(root).as_posix()}"
                )

    config_path = root / "config" / "public-site.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("$schema") != CONFIG_SCHEMA:
        raise PublicSiteError("unexpected public site runtime config schema")

    identity = config.get("identity")
    downloads = config.get("downloads")
    legal = config.get("legal")
    if not isinstance(identity, dict) or not isinstance(downloads, dict) or not isinstance(legal, dict):
        raise PublicSiteError("public site runtime config sections are missing")
    for key in ("login_url", "register_url", "recovery_url", "recovery_complete_url"):
        if not same_origin_path(identity.get(key)):
            raise PublicSiteError(f"identity.{key} must be null or a same-origin path")
    if not TURNSTILE_SITEKEY_RE.fullmatch(str(identity.get("turnstile_sitekey", ""))):
        raise PublicSiteError("identity.turnstile_sitekey must be a valid public Turnstile sitekey")
    if not same_origin_path(downloads.get("catalog_url")):
        raise PublicSiteError("downloads.catalog_url must be null or a same-origin path")

    # Product entry is navigation, not an authentication or release authority.
    # A real Web host still has to authorize requests independently of this portal.
    product = config.get("product", {})
    if not isinstance(product, dict):
        raise PublicSiteError("product config must be an object")
    web = product.get("web", {})
    if not isinstance(web, dict) or not isinstance(web.get("enabled", False), bool):
        raise PublicSiteError("product.web.enabled must be boolean")
    entry = web.get("entry_url")
    if entry is not None and (
        not isinstance(entry, str)
        or not re.fullmatch(r"/[A-Za-z0-9/_-]+/", entry)
        or "//" in entry
        or re.match(r"/(auth|account|sync|config|api|conta|login|cadastro|web)(/|$)", entry)
    ):
        raise PublicSiteError("product.web.entry_url must be a separate same-origin product path")
    site_contract = json.loads((ROOT / "docs/contracts/public-site.json").read_text(encoding="utf-8"))
    approved_entry = site_contract["account_area"].get("web_entry", {})
    if web.get("enabled") is True and (
        approved_entry.get("runtime_available") is not True
        or not entry or entry != approved_entry.get("runtime_path")
    ):
        raise PublicSiteError("Web launch requires the deployed product entry authorized by its owner")

    for key in ("privacy_url", "terms_url"):
        if not same_origin_path(legal.get(key)):
            raise PublicSiteError(f"legal.{key} must be a same-origin path")
    if not isinstance(legal.get("account_activation_ready"), bool):
        raise PublicSiteError("legal.account_activation_ready must be boolean")

    legal_contract = json.loads(LEGAL_READINESS.read_text(encoding="utf-8"))
    if legal_contract.get("$schema") != "prototype-ordax.public-legal-readiness/1":
        raise PublicSiteError("unexpected public legal-readiness schema")
    hardening_contract = json.loads(AUTH_HARDENING.read_text(encoding="utf-8"))
    if hardening_contract.get("$schema") != "prototype-ordax.public-auth-hardening/1":
        raise PublicSiteError("unexpected public auth-hardening schema")
    contract_ready = legal_contract.get("account_activation_ready")
    if legal["account_activation_ready"] is not contract_ready:
        raise PublicSiteError("runtime legal readiness must match canonical legal-readiness contract")

    auth_only = legal.get("auth_only_source_enabled", False)
    if not isinstance(auth_only, bool):
        raise PublicSiteError("legal.auth_only_source_enabled must be a boolean")
    if not contract_ready:
        if auth_only:
            # Limited to identity only. The browser still requires the
            # *live* Supabase session provider and active registration policy.
            if identity.get("login_url") != "/auth/login" or identity.get("register_url") != "/auth/register":
                raise PublicSiteError("auth-only source requires exact same-origin login/signup routes")
            if identity.get("recovery_url") is not None or identity.get("recovery_complete_url") is not None:
                raise PublicSiteError("auth-only source cannot silently enable password recovery")
            documents = legal_contract.get("documents", {})
            for name in ("privacy", "terms"):
                doc = documents.get(name, {})
                if doc.get("final") is not True or not doc.get("version") or not doc.get("effective_date"):
                    raise PublicSiteError("auth-only source needs published versioned legal documents")
        elif any(
            identity.get(key) is not None
            for key in ("login_url", "register_url", "recovery_url", "recovery_complete_url")
        ):
            raise PublicSiteError("identity URLs must remain null until public legal readiness is complete")
    else:
        if legal_contract.get("status") != "ready":
            raise PublicSiteError("ready legal contract must have status=ready")
        if hardening_contract.get("status") != "ready":
            raise PublicSiteError("public auth hardening must be ready before account activation")
        expected_identity_routes = {
            "login_url": "/auth/login",
            "register_url": "/auth/register",
            "recovery_url": "/auth/recover",
            "recovery_complete_url": "/auth/recover/complete",
        }
        for key, expected in expected_identity_routes.items():
            if identity.get(key) != expected:
                raise PublicSiteError("ready account activation requires canonical same-origin auth routes")
        documents = legal_contract.get("documents")
        if not isinstance(documents, dict):
            raise PublicSiteError("ready legal contract documents are missing")
        for name in ("privacy", "terms"):
            document = documents.get(name)
            if not isinstance(document, dict) or document.get("final") is not True:
                raise PublicSiteError(f"{name} document must be final before account activation")
            if not document.get("version") or not document.get("effective_date"):
                raise PublicSiteError(f"{name} document requires version and effective date")

    return files


ACCOUNT_UI_PREBUILT = ROOT / "sites/account-ui/prebuilt"

def stage_account_lovable(stage: Path) -> None:
    """Ship the reviewed, precompiled React bundle without npm during Vercel deploy.

    The authoritative source and lockfile are sites/account-ui/lovable-original;
    CI rebuilds and byte-compares this prebuilt bundle against that source.
    """
    source = ACCOUNT_UI_PREBUILT
    if not (source / "index.html").is_file():
        raise PublicSiteError("reviewed account React bundle missing")
    markup = (source / "index.html").read_text(encoding="utf-8")
    if '<div id="root"></div>' not in markup:
        raise PublicSiteError("account React application root missing")
    if 'src="/assets/account/' not in markup or 'href="/assets/account/' not in markup:
        raise PublicSiteError("account assets must be same-origin and content-addressed")
    if "https://" in markup or "http://" in markup:
        raise PublicSiteError("account candidate embeds remote runtime dependencies")
    allowed = {".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".woff", ".woff2"}
    contents = sorted(source.iterdir(), key=lambda entry: entry.name)
    for item in contents:
        if item.name == "index.html" or item.name == ".vite":
            continue
        if not item.is_file() or item.is_symlink() or item.suffix not in allowed:
            raise PublicSiteError("unapproved account UI bundle entry")
        if item.stat().st_size > 4 * 1024 * 1024:
            raise PublicSiteError("account bundle asset too large")
        dst = stage / "assets/account" / item.name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(item, dst)
    (stage / "conta/index.html").write_text(markup, encoding="utf-8")


def build_bundle(out_dir: Path, source_commit: str, root: Path = SOURCE, account_ui: str = 'classic') -> dict:
    if not SHA40_RE.fullmatch(source_commit):
        raise PublicSiteError("source commit must be a full lowercase 40-hex Git SHA")
    if out_dir.exists() and any(out_dir.iterdir()):
        raise PublicSiteError(f"refusing to replace non-empty output directory: {out_dir}")

    files = validate_source(root)
    publications = load_publications(PUBLICATIONS)
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".ordax-public-site-", dir=out_dir.parent))
    try:
        for path in files:
            relative = path.relative_to(root)
            destination = stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)

        if account_ui == "lovable":
            stage_account_lovable(stage)
        elif account_ui != "classic":
            raise PublicSiteError("unsupported public account UI profile")

        # Derived CSS bridge: no manual palette in sites/public and no risk of
        # overwriting in-progress public-site layouts or source files.
        token_asset = stage / "assets" / "ordax-design-tokens.css"
        token_asset.write_text(render_site_identity_css(), encoding="utf-8")
        # Use the identical source asset consumed by Native and Surface Web.
        # Its mask/symbol is exposed for UI composition; existing public HTML
        # and its in-progress layout remain untouched.
        shutil.copyfile(CANONICAL_SYMBOL, stage / PUBLIC_SYMBOL_PATH)
        shutil.copyfile(CANONICAL_WALLPAPER, stage / "assets/ordax-landscape.png")
        font_dir = stage / "assets/fonts"
        font_dir.mkdir(exist_ok=True)
        shutil.copyfile(CANONICAL_FONT, font_dir / CANONICAL_FONT.name)
        shutil.copyfile(CANONICAL_FONT_LICENSE, font_dir / CANONICAL_FONT_LICENSE.name)
        (stage / "assets/ordax-font.css").write_text(render_site_font_css(), encoding="utf-8")
        for page in stage.rglob("*.html"):
            try:
                markup = render_public_html(page.read_text(encoding="utf-8"))
                if page.relative_to(stage).as_posix() in ("conta/index.html", "web/index.html"):
                    # A new account layout must never reuse stale cached CSS or
                    # presentation code. Stable bytes keep a stable URL; no clock.
                    for asset in (
                        "assets/account-dashboard.css", "assets/account-portal.js",
                        "assets/ordax-design-tokens.css", "assets/ordax-font.css",
                    ):
                        version = sha256_bytes((stage / asset).read_bytes())[:16]
                        pattern = r'(["\'])/' + re.escape(asset) + r'(?:\?[^"\']*)?(["\'])'
                        markup = re.sub(pattern, lambda match: match[1] + "/" + asset + "?v=" + version + match[2], markup)
                marker = "<!-- ORDAX_ACCOUNT_PLAN_CATALOG -->"
                if marker in markup:
                    plans = json.loads((ROOT / "docs/contracts/entitlements.json").read_text(encoding="utf-8"))["plan_catalog"]["plans"]
                    if page.relative_to(stage).as_posix() != "conta/index.html" or markup.count(marker) != 1:
                        raise PublicSiteError("plan catalog has one public account presentation")
                    labels = [plan["display_name"] for plan in plans]
                    if not labels or any(not isinstance(label, str) or len(label) > 64 for label in labels):
                        raise PublicSiteError("invalid canonical account plan names")
                    markup = markup.replace(marker, '<ul class="plan-catalog">' + "".join(
                        "<li>" + html.escape(label) + "</li>" for label in labels
                    ) + "</ul>")
            except ValueError as exc:
                raise PublicSiteError(str(exc)) from exc
            page.write_text(markup, encoding="utf-8")

        catalog = write_catalog(PUBLICATIONS, stage / PUBLIC_CATALOG_RELATIVE)

        records = []
        for path in sorted(
            (p for p in stage.rglob("*") if p.is_file()),
            key=lambda p: p.relative_to(stage).as_posix(),
        ):
            payload = path.read_bytes()
            records.append(
                {
                    "path": path.relative_to(stage).as_posix(),
                    "sha256": sha256_bytes(payload),
                    "size": len(payload),
                }
            )

        manifest = {
            "$schema": SCHEMA,
            "status": "candidate",
            "artifact_class": "public-site",
            "source_commit": source_commit,
            "source_root": "sites/public",
            "build_recipe": "tools/public-site/build.py",
            "remote_runtime_dependencies": True,
            "remote_runtime_allowlist": [
                {
                    "url": TURNSTILE_RUNTIME_URL,
                    "owner": "public-account-abuse-protection",
                    "scope": ["login", "register", "recovery"],
                    "lazy": True,
                }
            ],
            "framework_runtime_dependency": account_ui == "lovable",
            "account_ui_source": "sites/account-ui/lovable-original" if account_ui == "lovable" else "sites/public/conta",
            "routes": ["/", "/download/", "/login/", "/cadastro/", "/recuperar/", "/recuperar/nova-senha/", "/conta/", "/licencas/", "/privacidade/", "/termos/"],
            "public_release_catalog": {
                "path": "/" + PUBLIC_CATALOG_RELATIVE.as_posix(),
                "status": catalog["status"],
                "release_count": len(catalog["releases"]),
                "publication_source": "platform/releases/publications.json",
                "publication_status": publications["status"],
            },
            "files": records,
        }
        (stage / MANIFEST_NAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        if out_dir.exists():
            out_dir.rmdir()
        os.replace(stage, out_dir)
        stage = None
        return manifest
    finally:
        if stage is not None:
            shutil.rmtree(stage, ignore_errors=True)


def verify_bundle(out_dir: Path) -> dict:
    manifest_path = out_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        raise PublicSiteError(f"missing {MANIFEST_NAME}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("$schema") != SCHEMA:
        raise PublicSiteError("unexpected public site bundle schema")
    if manifest.get("artifact_class") != "public-site":
        raise PublicSiteError("unexpected artifact class")
    if not SHA40_RE.fullmatch(str(manifest.get("source_commit", ""))):
        raise PublicSiteError("manifest source_commit is invalid")
    if manifest.get("remote_runtime_dependencies") is not True:
        raise PublicSiteError("public site must declare the Turnstile runtime dependency")
    expected_remote = [
        {
            "url": TURNSTILE_RUNTIME_URL,
            "owner": "public-account-abuse-protection",
            "scope": ["login", "register", "recovery"],
            "lazy": True,
        }
    ]
    if manifest.get("remote_runtime_allowlist") != expected_remote:
        raise PublicSiteError("public site remote runtime allowlist mismatch")

    expected = {record["path"]: record for record in manifest.get("files", [])}
    actual = {
        path.relative_to(out_dir).as_posix(): path
        for path in out_dir.rglob("*")
        if path.is_file() and path.name != MANIFEST_NAME
    }
    if set(actual) != set(expected):
        raise PublicSiteError(
            f"bundle file set mismatch: expected={sorted(expected)} actual={sorted(actual)}"
        )
    if PUBLIC_SYMBOL_PATH not in actual or actual[PUBLIC_SYMBOL_PATH].read_bytes() != CANONICAL_SYMBOL.read_bytes():
        raise PublicSiteError("canonical OrdaX public symbol asset missing or stale")
    for relative, canonical in (
        ("assets/ordax-landscape.png", CANONICAL_WALLPAPER),
        ("assets/fonts/" + CANONICAL_FONT.name, CANONICAL_FONT),
        ("assets/fonts/" + CANONICAL_FONT_LICENSE.name, CANONICAL_FONT_LICENSE),
    ):
        if relative not in actual or actual[relative].read_bytes() != canonical.read_bytes():
            raise PublicSiteError("canonical OrdaX public visual asset missing or stale")
    if actual.get("assets/ordax-font.css") is None or actual["assets/ordax-font.css"].read_text(encoding="utf-8") != render_site_font_css():
        raise PublicSiteError("canonical OrdaX public font declaration missing or stale")
    if actual.get("assets/ordax-design-tokens.css") is None or actual["assets/ordax-design-tokens.css"].read_text(encoding="utf-8") != render_site_identity_css():
        raise PublicSiteError("canonical OrdaX public design tokens missing or stale")

    for relative, path in actual.items():
        payload = path.read_bytes()
        record = expected[relative]
        if len(payload) != record["size"] or sha256_bytes(payload) != record["sha256"]:
            raise PublicSiteError(f"bundle integrity mismatch: {relative}")

    validate_source(out_dir)
    catalog_path = out_dir / PUBLIC_CATALOG_RELATIVE
    if not catalog_path.is_file():
        raise PublicSiteError("public release catalog is missing from bundle")
    catalog = validate_catalog(catalog_path)
    catalog_manifest = manifest.get("public_release_catalog")
    if not isinstance(catalog_manifest, dict):
        raise PublicSiteError("public release catalog manifest metadata is missing")
    if catalog_manifest.get("path") != "/" + PUBLIC_CATALOG_RELATIVE.as_posix():
        raise PublicSiteError("public release catalog manifest path is invalid")
    if catalog_manifest.get("status") != catalog.get("status"):
        raise PublicSiteError("public release catalog status mismatch")
    if catalog_manifest.get("release_count") != len(catalog.get("releases", [])):
        raise PublicSiteError("public release catalog count mismatch")
    return manifest


def command_check() -> int:
    files = validate_source()
    publications = load_publications(PUBLICATIONS)
    print("PUBLIC_SITE_SOURCE=PASS")
    print(f"PUBLIC_SITE_SOURCE_FILE_COUNT={len(files)}")
    print("PUBLIC_SITE_REMOTE_RUNTIME_DEPENDENCIES=TURNSTILE_ONLY")
    print("PUBLIC_PLAYGROUND_FIXTURE=PASS")
    print(f"PUBLIC_RELEASE_PUBLICATION_COUNT={len(publications['releases'])}")
    return 0


def command_build(args: argparse.Namespace) -> int:
    manifest = build_bundle(Path(args.out_dir), args.source_commit, account_ui=args.account_ui)
    print("PUBLIC_SITE_BUILD=PASS")
    print(f"PUBLIC_SITE_FILE_COUNT={len(manifest['files'])}")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    manifest = verify_bundle(Path(args.out_dir))
    print("PUBLIC_SITE_VERIFY=PASS")
    print(f"PUBLIC_SITE_SOURCE_COMMIT={manifest['source_commit']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build = sub.add_parser("build")
    build.add_argument("--out-dir", default="out/public-site")
    build.add_argument("--source-commit", required=True)
    build.add_argument("--account-ui", choices=("classic", "lovable"), default="classic")
    verify = sub.add_parser("verify")
    verify.add_argument("--out-dir", default="out/public-site")
    args = parser.parse_args(argv)

    try:
        if args.command == "check":
            return command_check()
        if args.command == "build":
            return command_build(args)
        return command_verify(args)
    except (
        PublicSiteError,
        PublicReleaseCatalogError,
        PlaygroundFixtureError,
        OSError,
        ValueError,
        json.JSONDecodeError,
        UnicodeDecodeError,
    ) as exc:
        print(f"PUBLIC_SITE_ERROR={exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
