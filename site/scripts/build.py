#!/usr/bin/env python3
"""Independent, fail-closed public-site candidate builder. No OS or Surface source imports."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path

from public_html_render import render_public_html
from public_shell import load_contract as load_public_shell, render_public_shell
from public_release_catalog import render_catalog, validate_catalog
from site_routes import ROUTES, ROUTE_RECORDS
from site_seo import validate_origin, render_html, write_robots_sitemap
from surface_release import validate_pin as validate_surface_release_pin, materialize as download_surface_release, SurfaceReleaseError
from brand_release import validate_pin as validate_brand_release_pin, materialize as download_brand_release, BrandReleaseError

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
BINARY_PROVENANCE = {
    "assets/account-landscape.jpg": "260e215794a3a38b03d0df6ce9395632aa7b78be",
    "assets/aurora-titanium.png": "e4574877f57a66574d001ebcfbfc8718782a2c23",
    "assets/download-hero.png": "7c23ed6070890d81a11474108f0a52a0965ce501",
    "assets/public-space-city.jpg": "189b498cf95572b45ccbbdc23ebc4eda9a66f257",
    "assets/public-surface-day.jpg": "9ae4fb9586e7c4267087c0bcba00b1f466f3866b",
    "assets/public-surface-night.jpg": "75f905b78bde6287a8a11c4062ef00ad1e469486",
}
BRAND_FILES = {
    "assets/ordax-design-tokens.css", "assets/ordax-font.css",
    "assets/ordax-symbol.png", "assets/ordax-landscape.png",
    "assets/fonts/inter-latin-wght-normal.woff2",
    "assets/fonts/Inter-OFL-1.1.txt",
}
REMOTE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
# Exact official read-only Windows CI page; not a release-authority or download grant.
DESKTOP_EVALUATION_WORKFLOW = "https://github.com/ordaxsystems/ordax-os/actions/workflows/windows-desktop-dev.yml?query=branch%3Amain"
SCHEMA = "prototype-ordax.independent-public-site-bundle/1"
MAX_BUNDLE_FILES = 500
MAX_BUNDLE_BYTES = 64 * 1024 * 1024
PREVIEW_FILES = {"assets/playground-fixture.json", "assets/surface-snapshot.css"}
PREVIEW_SCHEMA = "prototype-ordax.public-playground-fixture/1"
DEV_ARTIFACT_LOCK_SCHEMA = "ordax.site-dev-artifact-lock/2"
DEV_ARTIFACT_STATUS = "development-only-not-authorized-for-production"

class SiteError(ValueError):
    pass

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def validate_bundle_inventory(ledger: dict) -> dict[str, dict]:
    """One canonical file inventory validator for local verify and staging.

    Manifests do not authorize publication; they enumerate candidate bytes.
    """
    records = ledger.get("files")
    if not isinstance(records, list) or not records or len(records) > MAX_BUNDLE_FILES:
        raise SiteError("site-bundle-file-inventory-invalid")
    files: dict[str, dict] = {}
    total_bytes = 0
    for row in records:
        if (
            not isinstance(row, dict)
            or set(row) != {"path", "size", "sha256"}
            or not isinstance(row["path"], str)
            or re.fullmatch(r"[A-Za-z0-9._/-]+", row["path"]) is None
            or row["path"].startswith("/")
            or any(part in ("", ".", "..") for part in row["path"].split("/"))
            or row["path"] == "public-site-manifest.json"
            or not isinstance(row["size"], int) or isinstance(row["size"], bool)
            or row["size"] < 0
            or not isinstance(row["sha256"], str)
            or SHA256.fullmatch(row["sha256"]) is None
            or row["path"] in files
        ):
            raise SiteError("site-bundle-file-inventory-invalid")
        total_bytes += row["size"]
        if total_bytes > MAX_BUNDLE_BYTES:
            raise SiteError("site-bundle-file-inventory-too-large")
        files[row["path"]] = row
    for required in ("config/public-site.json", "releases/catalog.json"):
        if required not in files:
            raise SiteError("site-bundle-file-inventory-missing:" + required)
    # No file may simultaneously act as the parent of another file.
    for name in files:
        parts = name.split("/")
        if any("/".join(parts[:i]) in files for i in range(1, len(parts))):
            raise SiteError("site-bundle-file-inventory-invalid")
    return files


def git_blob(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def safe_relative(value: object) -> bool:
    return (isinstance(value, str) and value.startswith("/")
            and not value.startswith("//") and "\\" not in value
            and "?" not in value and "#" not in value
            and ".." not in value.split("/"))

def check_source(strict_assets: bool = False) -> dict:
    if not SOURCE.is_dir():
        raise SiteError("missing site/public source")
    files = sorted(p for p in SOURCE.rglob("*") if p.is_file() or p.is_symlink())
    if any(p.is_symlink() for p in files):
        raise SiteError("symbolic links forbidden in site source")
    paths = {p.relative_to(SOURCE).as_posix() for p in files}
    missing_routes = set(ROUTES) - paths
    if paths.intersection(PREVIEW_FILES | {"assets/surface-snapshot.json"}):
        raise SiteError("generated Surface preview must come only from a pinned external artifact")
    if missing_routes:
        raise SiteError("missing routes: " + ", ".join(sorted(missing_routes)))
    public_shell = load_public_shell(ROUTE_RECORDS)
    for route in ROUTE_RECORDS:
        page = SOURCE / route["source"]
        markup = page.read_text(encoding="utf-8")
        render_public_shell(markup, route["path"], public_shell)
    config = json.loads((SOURCE / "config/public-site.json").read_text("utf-8"))
    if config.get("$schema") != "prototype-ordax.public-site-runtime/1":
        raise SiteError("runtime config schema mismatch")
    if config.get("product", {}).get("web", {}).get("enabled") is not False:
        raise SiteError("product Web may not be activated by the site")
    identity = config["identity"]
    for key in ("login_url", "register_url", "recovery_url", "recovery_complete_url"):
        if identity.get(key) is not None and not safe_relative(identity[key]):
            raise SiteError("unsafe identity target: " + key)
    if config["legal"].get("account_activation_ready") is not False:
        raise SiteError("source alone must not activate public account")
    if config["downloads"].get("catalog_url") != "/releases/catalog.json":
        raise SiteError("download catalog must be same-origin and versioned")
    for p in files:
        if p.suffix.lower() in {".js", ".css", ".html"}:
            value = p.read_text("utf-8")
            if p.suffix.lower() == ".js" and re.search(r"(?:import|from|require\().{0,120}system/surface/", value):
                raise SiteError("site imports internal Surface source: " + str(p))
            if "http://" in value or "https://" in value:
                scrubbed = value.replace(REMOTE_SCRIPT, "")
                scrubbed = re.sub(r'href="https://web\.ordax\.com\.br/"', 'href="/"', scrubbed)
                if p.suffix.lower() == ".html":
                    scrubbed = scrubbed.replace('href="' + DESKTOP_EVALUATION_WORKFLOW + '"', 'href="/download/#desktop"')
                if "http://" in scrubbed or "https://" in scrubbed:
                    raise SiteError("unapproved external runtime reference: " + str(p))
    missing_binary = []
    for relative, sha in BINARY_PROVENANCE.items():
        path = SOURCE / relative
        if not path.is_file():
            missing_binary.append(relative)
        elif git_blob(path.read_bytes()) != sha:
            raise SiteError("binary source provenance mismatch: " + relative)
    if strict_assets and missing_binary:
        raise SiteError("missing original source assets: " + ", ".join(missing_binary))
    return {"source_files": len(files), "missing_source_assets": missing_binary}

def load_dev_artifact_lock(path: Path) -> dict:
    """One Dev-only SSOT for two separately signed, owner-generated packages."""
    if path.is_symlink() or not path.is_file():
        raise SiteError("Dev artifact lock missing or symlinked")
    data = json.loads(path.read_text(encoding="utf-8"))
    if (set(data) != {"$schema", "status", "artifacts"}
            or data["$schema"] != DEV_ARTIFACT_LOCK_SCHEMA
            or data["status"] != DEV_ARTIFACT_STATUS
            or not isinstance(data["artifacts"], dict)
            or set(data["artifacts"]) != {"brand", "surface_preview"}):
        raise SiteError("invalid Dev artifact lock")
    if set(data["artifacts"]["brand"]) != {"release"} or set(data["artifacts"]["surface_preview"]) != {"release"}:
        raise SiteError("Dev artifacts must be external owner releases")
    try:
        brand = validate_brand_release_pin(data["artifacts"]["brand"]["release"])
        preview = validate_surface_release_pin(data["artifacts"]["surface_preview"]["release"])
    except (BrandReleaseError, SurfaceReleaseError, TypeError, AttributeError) as error:
        raise SiteError("invalid signed Dev release lock") from error
    return {
        "brand": {"release": brand, "manifest_sha256": brand["manifest_sha256"]},
        "surface_preview": {"release": preview, "manifest_sha256": preview["manifest_sha256"]},
    }


def load_pinned_manifest(directory: Path, expected_sha256: str | None, label: str) -> tuple[dict, str]:
    """Verify trust anchor outside the manifest before interpreting any manifest claims."""
    if not SHA256.fullmatch(str(expected_sha256)):
        raise SiteError(label + " manifest SHA-256 pin is mandatory")
    path = directory / "manifest.json"
    if path.is_symlink() or not path.is_file():
        raise SiteError(label + " manifest missing or symlinked")
    payload = path.read_bytes()
    if digest(payload) != expected_sha256:
        raise SiteError(label + " manifest pin mismatch")
    return json.loads(payload), expected_sha256


def stage_brand(stage: Path, brand_dir: Path, expected_sha256: str | None) -> dict:
    """Use only a Surface-owned bundle already pinned and authenticated."""
    ledger, pinned_sha256 = load_pinned_manifest(brand_dir, expected_sha256, "brand")
    if (ledger.get("$schema") != "ordax.surface-brand-artifact/1"
            or ledger.get("artifact_class") != "ordax-brand"
            or ledger.get("source_repository") != "ordaxsystems/ordax-surface"
            or ledger.get("status") != "candidate-not-published"
            or ledger.get("immutable") is not True
            or not SHA40.fullmatch(str(ledger.get("source_commit", "")))):
        raise SiteError("wrong owner or unverified brand artifact")
    rows = ledger.get("files")
    if (not isinstance(rows, list) or len(rows) != len(BRAND_FILES)
            or {r.get("path") for r in rows if isinstance(r, dict)} != BRAND_FILES):
        raise SiteError("brand file inventory mismatch")
    for row in rows:
        name = row["path"]
        source = brand_dir / name
        if source.is_symlink() or not source.is_file() or not SHA256.fullmatch(str(row.get("sha256", ""))):
            raise SiteError("invalid brand source asset")
        payload = source.read_bytes()
        if digest(payload) != row["sha256"] or len(payload) != row["size"]:
            raise SiteError("brand asset SHA-256 mismatch: " + name)
        target = stage / name
        if target.exists():
            raise SiteError("brand file conflicts with Site-owned source: " + name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    return {"source_repository": ledger["source_repository"],
            "source_commit": ledger["source_commit"], "status": ledger["status"],
            "manifest_sha256": pinned_sha256}


def coalesce_verified_site_images(stage: Path, payloads: dict[str, bytes]) -> int:
    """Reuse identical authored Site images in a verified Surface Dev output.

    Surface release bytes and signatures were verified before this operation.
    Only the disposable bundle is rewritten; no canonical source is changed.
    """
    images = {}
    for source in sorted((stage / "assets").glob("*")):
        if (not source.is_file() or source.is_symlink()
                or source.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}):
            continue
        data = source.read_bytes()
        images.setdefault(digest(data), []).append(
            (source.relative_to(stage).as_posix(), data)
        )
    reused = 0
    for name, raw in list(payloads.items()):
        if Path(name).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        # Require full byte equality, not only a digest collision or image name.
        target = next((path for path, data in images.get(digest(raw), [])
                       if path != name and data == raw), None)
        if target is None:
            continue
        if name != "assets/" + Path(name).name or target != "assets/" + Path(target).name:
            raise SiteError("shared Surface image requires flat Site asset paths")
        old_url = b"/" + name.encode("ascii")
        new_url = b"/" + target.encode("ascii")
        old_relative = b"./" + Path(name).name.encode("ascii")
        new_relative = b"./" + Path(target).name.encode("ascii")
        for filename, content in list(payloads.items()):
            if filename == name or Path(filename).suffix.lower() not in {".css", ".json", ".svg"}:
                continue
            updated = content.replace(old_url, new_url).replace(old_relative, new_relative)
            # Unknown URL spellings are never silently orphaned by deduplication.
            if Path(name).name.encode("ascii") in updated:
                raise SiteError("unmapped Surface image reference: " + name)
            payloads[filename] = updated
        del payloads[name]
        reused += 1
    return reused


def stage_surface_dev_preview(stage: Path, directory: Path, manifest: dict,
                              manifest_sha256: str) -> dict:
    """Consume the Surface-owned read-only Dev bundle, not source code.

    This is a dev-only integration and MUST follow an authenticated GitHub
    producer-run check by the build workflow. A self-asserted manifest status
    or locally computed hash does not grant production authority.
    """
    if (manifest.get("$schema") != "ordax.meridian-readonly-preview-artifact/2"
            or manifest.get("artifact_class") != "ordax-meridian-preview"
            or manifest.get("status") != "candidate-not-published"
            or manifest.get("runtime_authority") is not False
            or manifest.get("source_repository") != "ordaxsystems/ordax-surface"
            or manifest.get("os_host_repository") != "ordaxsystems/ordax-os"
            or not SHA40.fullmatch(str(manifest.get("source_commit", "")))
            or not SHA40.fullmatch(str(manifest.get("os_host_commit", "")))
            or manifest.get("catalog_schema") != "ordax.os-public-catalog-projection/1"
            or not SHA256.fullmatch(str(manifest.get("catalog_sha256", "")))):
        raise SiteError("untrusted or wrong-authority Surface dev preview")
    records = manifest.get("files")
    if not isinstance(records, list) or not 2 <= len(records) <= 48:
        raise SiteError("Surface dev preview file inventory invalid")
    files = {}
    total = 0
    for item in records:
        if (not isinstance(item, dict) or set(item) != {"path", "size", "sha256"}
                or not isinstance(item.get("path"), str)
                or not re.fullmatch(r"assets/[A-Za-z0-9._/-]+", item["path"])
                or any(s in ("", ".", "..") for s in item["path"].split("/"))
                or item["path"].split(".")[-1] not in {"json", "css", "png", "jpg", "jpeg", "webp", "svg", "woff2"}
                or item["path"] in files
                or not isinstance(item.get("size"), int)
                or isinstance(item["size"], bool)
                or item["size"] < 0
                or not SHA256.fullmatch(str(item.get("sha256", "")))):
            raise SiteError("invalid Surface dev preview artifact entry")
        total += item["size"]
        if total > 12 * 1024 * 1024:
            raise SiteError("Surface dev preview exceeds Dev-only size bound")
        files[item["path"]] = item
    if not {"assets/surface-snapshot.css", "assets/playground-fixture.json"} <= set(files):
        raise SiteError("Surface dev preview missing canonical Site files")
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not sources:
        raise SiteError("Surface preview is missing provenance source graph")
    owners = set()
    for row in sources:
        if not isinstance(row, dict):
            raise SiteError("invalid Surface dev source graph")
        repo = row.get("repository")
        commit = row.get("commit")
        if (repo not in ("ordaxsystems/ordax-os", "ordaxsystems/ordax-surface")
                or commit != manifest["source_commit" if repo.endswith("surface") else "os_host_commit"]
                or not SHA40.fullmatch(str(row.get("git_blob", "")))
                or not SHA256.fullmatch(str(row.get("sha256", "")))):
            raise SiteError("untrusted Surface preview source provenance")
        owners.add(repo)
    if owners != {"ordaxsystems/ordax-os", "ordaxsystems/ordax-surface"}:
        raise SiteError("Surface preview missing one of its real source owners")
    present = {
        p.relative_to(directory).as_posix()
        for p in directory.rglob("*") if p.is_file() or p.is_symlink()
    }
    if present != set(files) | {"manifest.json"}:
        raise SiteError("unexpected or missing Surface dev preview source files")
    payloads = {}
    for name, row in files.items():
        src = directory / name
        if src.is_symlink() or not src.is_file():
            raise SiteError("missing/linked Surface preview asset: " + name)
        data = src.read_bytes()
        if len(data) != row["size"] or digest(data) != row["sha256"]:
            raise SiteError("Surface preview asset digest mismatch: " + name)
        payloads[name] = data
    try:
        fixture = json.loads(payloads["assets/playground-fixture.json"])
    except (UnicodeError, ValueError) as error:
        raise SiteError("invalid Surface dev fixture JSON") from error
    surface = fixture.get("surface", {})
    if (fixture.get("$schema") != PREVIEW_SCHEMA
            or not isinstance(fixture.get("apps"), list) or not fixture["apps"]
            or not isinstance(fixture.get("home", {}).get("rail_apps"), list)
            or not isinstance(surface, dict)
            or not isinstance(surface.get("chrome"), str)
            or not isinstance(surface.get("views", {}).get("home"), str)
            or len(surface.get("views", {})) != 11
            or surface.get("sources") != sources
            or surface.get("cssSha256") != digest(payloads["assets/surface-snapshot.css"])
            or surface.get("presentation") != "example-only-not-an-authorized-session"):
        raise SiteError("Surface preview fixture/source/CSS mismatch")
    # Vite fingerprints the same Inter font already supplied by the
    # verified brand package. Rebase its public URL to the single brand
    # asset rather than shipping a second identical binary.
    css = payloads["assets/surface-snapshot.css"]
    bundled_fonts = [
        name for name in payloads
        if re.fullmatch(r"assets/inter-latin-wght-normal-[A-Za-z0-9_-]+\.woff2", name)
    ]
    if len(bundled_fonts) != 1:
        raise SiteError("expected one canonical Vite Inter font in Dev preview")
    brand_font = stage / "assets/fonts/inter-latin-wght-normal.woff2"
    if not brand_font.is_file() or brand_font.read_bytes() != payloads[bundled_fonts[0]]:
        raise SiteError("Surface renderer font does not match verified brand font")
    source_font_url = b"/" + bundled_fonts[0].encode("ascii")
    if source_font_url not in css:
        raise SiteError("Surface preview CSS does not reference its verified font")
    css = css.replace(source_font_url, b"/assets/fonts/inter-latin-wght-normal.woff2")
    payloads["assets/surface-snapshot.css"] = css
    del payloads[bundled_fonts[0]]
    reused_images = coalesce_verified_site_images(stage, payloads)
    for name, raw in payloads.items():
        dst = stage / name
        if dst.exists():
            if dst.is_symlink() or dst.read_bytes() != raw:
                raise SiteError("conflicting Surface-owned Site asset: " + name)
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(raw)
    return {"source_repository": manifest["source_repository"],
            "source_commit": manifest["source_commit"],
            "os_host_commit": manifest["os_host_commit"],
            "status": manifest["status"],
            "manifest_sha256": manifest_sha256,
            "file_count": len(files),
            "rendered_css_sha256": digest(payloads["assets/surface-snapshot.css"]),
            "font_url_rebased": True, "reused_site_images": reused_images}


def stage_surface_preview(stage: Path, directory: Path, expected_manifest_sha256: str) -> dict:
    """Accept only the currently pinned Surface-owned signed Dev preview."""
    manifest, pinned_sha256 = load_pinned_manifest(
        directory, expected_manifest_sha256, "Surface preview"
    )
    if manifest.get("artifact_class") != "ordax-meridian-preview":
        raise SiteError("retired OS Surface migration preview is forbidden")
    return stage_surface_dev_preview(stage, directory, manifest, pinned_sha256)


INACTIVE_PLANS_HTML = '<p class="commercial-notice">Planos em preparação — contratação indisponível.</p>'


def build(out: Path, sha: str, brand: Path, publications: Path | None,
          public_origin: str | None = None,
          surface_preview_dir: Path | None = None,
          surface_preview_manifest_sha256: str | None = None,
          brand_manifest_sha256: str | None = None) -> dict:
    if not SHA40.fullmatch(sha):
        raise SiteError("full Git SHA required")
    origin = validate_origin(public_origin)
    # A boolean "public_authorized" in an arbitrary local JSON file is not
    # publisher attestation. No official release artifact trust policy exists.
    # Keep the download catalog empty until an explicitly authenticated
    # publishing handoff can be implemented; preserve only the offline renderer.
    if publications is not None:
        raise SiteError("public downloads require an attested publisher artifact; local --publications is forbidden")
    check_source(strict_assets=True)
    public_shell = load_public_shell(ROUTE_RECORDS)
    if out.exists():
        raise SiteError("refusing to replace existing build output")
    out.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkdtemp(prefix=".ordax-site-", dir=out.parent))
    try:
        shutil.copytree(SOURCE, temp, dirs_exist_ok=True)
        brand_receipt = stage_brand(temp, brand, brand_manifest_sha256)
        if surface_preview_dir is None:
            raise SiteError("Surface preview artifact required; no embedded Surface copy")
        preview_receipt = stage_surface_preview(
            temp, surface_preview_dir, surface_preview_manifest_sha256 or ""
        )
        route_by_source = {item["source"]: item for item in ROUTE_RECORDS}
        for page in temp.rglob("*.html"):
            relative = page.relative_to(temp).as_posix()
            if relative not in route_by_source:
                raise SiteError("HTML page has no declared route: " + relative)
            markup = render_public_shell(
                page.read_text("utf-8"), route_by_source[relative]["path"], public_shell
            )
            markup = render_public_html(markup)
            for marker, expected in (
                ("<!-- ORDAX_PUBLIC_PLAN_CATALOG -->", "index.html"),
                ("<!-- ORDAX_ACCOUNT_PLAN_CATALOG -->", "conta/index.html"),
            ):
                if marker in markup:
                    if page.relative_to(temp).as_posix() != expected or markup.count(marker) != 1:
                        raise SiteError("offers catalog marker outside its official presentation page")
                    markup = markup.replace(marker, INACTIVE_PLANS_HTML)
            # CSS source receipts stay immutable; the query tracks the bytes
            # actually distributed after verified font URL rebasing.
            markup = re.sub(r"(/assets/surface-snapshot\.css\?v=)[0-9a-f]{12}",
                            lambda match: match.group(1) + preview_receipt["rendered_css_sha256"][:12], markup)
            page.write_text(render_html(markup, route_by_source[relative], origin), encoding="utf-8")
        write_robots_sitemap(temp, origin)
        # The Site cannot authorize releases. Without independently attested
        # public-publisher input, the only safe downloadable catalog is empty.
        catalog = render_catalog({"releases": []})
        publications_digest = None
        dest = temp / "releases/catalog.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        validate_catalog(dest)
        records = [
            {"path": p.relative_to(temp).as_posix(), "sha256": digest(p.read_bytes()), "size": p.stat().st_size}
            for p in sorted(temp.rglob("*")) if p.is_file()
        ]
        manifest = {"$schema": SCHEMA, "source_commit": sha, "artifact_class": "public-site",
                    "brand": brand_receipt, "surface_preview": preview_receipt,
                    "publications_sha256": publications_digest,
                    "seo_origin": origin, "indexable_routes": [row["path"] for row in ROUTE_RECORDS if row["indexable"]],
                    "catalog_status": catalog["status"], "files": records}
        (temp / "public-site-manifest.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        os.replace(temp, out)
        temp = None
        return manifest
    finally:
        if temp is not None:
            shutil.rmtree(temp, ignore_errors=True)

def verify(out: Path) -> None:
    ledger = json.loads((out / "public-site-manifest.json").read_text("utf-8"))
    if ledger.get("$schema") != SCHEMA or not SHA40.fullmatch(str(ledger.get("source_commit", ""))):
        raise SiteError("bundle identity invalid")
    if ledger.get("artifact_class") != "public-site":
        raise SiteError("bundle identity invalid")
    expected = validate_bundle_inventory(ledger)
    # The signed Surface package may repeat Site-owned binaries under hashed
    # names, but the distributed output must retain only one byte-identical
    # image/font. This runs in Vercel's build verify, not only in browser CI.
    binary_digest_paths = {}
    for relative, row in expected.items():
        if Path(relative).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".woff2"}:
            continue
        previous = binary_digest_paths.setdefault(row["sha256"], relative)
        if previous != relative:
            raise SiteError("duplicate distributed binary assets: " + previous + " / " + relative)
    paths = list(out.rglob("*"))
    if any(p.is_symlink() for p in paths):
        raise SiteError("bundle contains symbolic links")
    files = {p.relative_to(out).as_posix(): p for p in paths if p.is_file()}
    if set(files) != set(expected) | {"public-site-manifest.json"}:
        raise SiteError("bundle path inventory mismatch")
    for relative, row in expected.items():
        path = files[relative]
        raw = path.read_bytes()
        if len(raw) != row["size"] or digest(raw) != row["sha256"]:
            raise SiteError("bundle integrity mismatch: " + relative)
    catalog = validate_catalog(out / "releases/catalog.json")
    # The existing Site bundle manifest is the build's publication-state
    # record. Reject a valid but swapped catalog or a forged "ready" marker.
    if ledger.get("catalog_status") != catalog["status"]:
        raise SiteError("bundle publication state mismatch")
    # The standalone Site has no official publisher trust anchor yet.
    # A SHA in this same manifest is NOT an external attestation.
    if catalog["status"] != "empty":
        raise SiteError("ready catalog requires an independently attested publisher")
    if ledger.get("publications_sha256") is not None:
        raise SiteError("empty catalog cannot have a publisher receipt")

def main() -> None:
    cli = argparse.ArgumentParser()
    cli.add_argument("command", choices=("check", "build", "verify"))
    cli.add_argument("--source-commit")
    cli.add_argument("--brand-dir")
    cli.add_argument("--brand-manifest-sha256")
    cli.add_argument("--publications")
    cli.add_argument("--dev-lock")
    cli.add_argument("--public-origin")
    cli.add_argument("--surface-preview-dir")
    cli.add_argument("--surface-preview-manifest-sha256")
    cli.add_argument("--out", default="out/site")
    args = cli.parse_args()
    if args.command == "check":
        report = check_source()
        print(json.dumps({"structural_check": "PASS", **report}, sort_keys=True))
    elif args.command == "build":
        brand = Path(args.brand_dir) if args.brand_dir else None
        brand_hash = args.brand_manifest_sha256
        preview = Path(args.surface_preview_dir) if args.surface_preview_dir else None
        preview_hash = args.surface_preview_manifest_sha256
        external_release = None
        external_brand = None
        if args.dev_lock:
            if any(x is not None for x in (brand, brand_hash, preview, preview_hash)):
                raise SiteError("migration lock and individual artifact overrides are mutually exclusive")
            pinned = load_dev_artifact_lock(Path(args.dev_lock))
            external_brand = pinned["brand"]["release"]
            brand_hash = pinned["brand"]["manifest_sha256"]
            external_release = pinned["surface_preview"]["release"]
            preview_hash = pinned["surface_preview"]["manifest_sha256"]
        if external_brand is None and brand is None:
            raise SiteError("signed brand release required; no OS fallback")
        if external_brand is not None and external_release is not None:
            with tempfile.TemporaryDirectory(prefix="ordax-owner-releases-") as temporary:
                brand = download_brand_release(external_brand, Path(temporary) / "brand")
                preview = download_surface_release(external_release, Path(temporary) / "preview")
                receipt = build(Path(args.out), args.source_commit or "", brand,
                                Path(args.publications) if args.publications else None,
                                args.public_origin, preview, preview_hash, brand_hash)
        elif external_brand is None:
            receipt = build(Path(args.out), args.source_commit or "", brand,
                            Path(args.publications) if args.publications else None,
                            args.public_origin, preview, preview_hash, brand_hash)
        else:
            raise SiteError("partial Dev release lock is invalid")
        print(json.dumps(receipt, sort_keys=True))
    else:
        verify(Path(args.out))
        print("SITE_BUNDLE_VERIFY=PASS")

if __name__ == "__main__":
    try:
        main()
    except (SiteError, ValueError, OSError) as error:
        raise SystemExit(f"SITE_ERROR: {error}")
