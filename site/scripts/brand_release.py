"""Consume Surface's signed development brand; never build or mirror its source."""
from __future__ import annotations

import hashlib
import io
import json
import re
import tarfile
from pathlib import Path

from surface_release import download_pinned_archive

OWNER = "ordaxsystems/ordax-surface"
LICENSE_OWNER = "ordaxsystems/ordax-os"
LICENSE_PATH = "third_party/licenses/Inter-OFL-1.1.txt"
LICENSE_BLOB = "556792990d740c111b4fee7fe1938dc90bcee2ce"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
FILES = frozenset((
    "assets/ordax-design-tokens.css",
    "assets/ordax-font.css",
    "assets/ordax-symbol.png",
    "assets/ordax-landscape.png",
    "assets/fonts/inter-latin-wght-normal.woff2",
    "assets/fonts/Inter-OFL-1.1.txt",
))
SOURCE_PATHS = frozenset((
    "system/surface/ui/brand/ordax-symbol.png",
    "system/surface/ui/brand/midnight-landscape.png",
    "system/surface/ui/fonts/inter-latin-wght-normal.woff2",
    "system/surface/ui/tokens.css",
    "system/surface/ui/meridian.tokens.css",
    LICENSE_PATH,
))


class BrandReleaseError(ValueError):
    pass


def validate_pin(pin: dict) -> dict:
    keys = {"source_repository", "source_commit", "release_tag",
            "archive_sha256", "manifest_sha256"}
    if (not isinstance(pin, dict) or set(pin) != keys
            or pin.get("source_repository") != OWNER
            or not isinstance(pin.get("source_commit"), str)
            or SHA40.fullmatch(pin["source_commit"]) is None
            or pin.get("release_tag") != "brand-dev-" + pin["source_commit"]
            or not isinstance(pin.get("archive_sha256"), str)
            or SHA256.fullmatch(pin["archive_sha256"]) is None
            or not isinstance(pin.get("manifest_sha256"), str)
            or SHA256.fullmatch(pin["manifest_sha256"]) is None):
        raise BrandReleaseError("invalid Surface brand release pin")
    return pin


def materialize(pin: dict, destination: Path, *, open_url=None) -> Path:
    validate_pin(pin)
    if destination.exists() or destination.is_symlink():
        raise BrandReleaseError("brand destination already exists")
    name = "ordax-brand-" + pin["source_commit"] + ".tar.gz"
    url = "https://github.com/" + OWNER + "/releases/download/" + pin["release_tag"] + "/" + name
    archive = download_pinned_archive(url, pin["archive_sha256"],
                                      max_bytes=16 * 1024 * 1024, open_url=open_url)
    contents = {}
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
            for entry in tar:
                name = entry.name.removeprefix("./").rstrip("/")
                if entry.isdir():
                    if name not in ("", ".", "assets", "assets/fonts"):
                        raise BrandReleaseError("unexpected brand directory")
                    continue
                if (not entry.isfile() or (entry.mode & 0o111)
                        or name not in (FILES | {"manifest.json"})
                        or name in contents or entry.size < 0
                        or entry.size > 8 * 1024 * 1024):
                    raise BrandReleaseError("unsafe brand archive member")
                stream = tar.extractfile(entry)
                if stream is None:
                    raise BrandReleaseError("unreadable brand member")
                payload = stream.read(entry.size + 1)
                if len(payload) != entry.size:
                    raise BrandReleaseError("truncated brand member")
                contents[name] = payload
    except (tarfile.TarError, EOFError, OSError) as error:
        raise BrandReleaseError("invalid brand archive") from error
    if set(contents) != FILES | {"manifest.json"}:
        raise BrandReleaseError("brand file inventory mismatch")
    digest = lambda value: hashlib.sha256(value).hexdigest()
    if digest(contents["manifest.json"]) != pin["manifest_sha256"]:
        raise BrandReleaseError("brand manifest digest mismatch")
    try:
        manifest = json.loads(contents["manifest.json"])
    except (ValueError, UnicodeError) as error:
        raise BrandReleaseError("invalid brand manifest") from error
    if (manifest.get("$schema") != "ordax.surface-brand-artifact/1"
            or manifest.get("artifact_class") != "ordax-brand"
            or manifest.get("status") != "candidate-not-published"
            or manifest.get("immutable") is not True
            or manifest.get("source_repository") != OWNER
            or manifest.get("source_commit") != pin["source_commit"]):
        raise BrandReleaseError("brand authority mismatch")
    rows = manifest.get("files")
    if (not isinstance(rows, list) or len(rows) != len(FILES)
            or {r.get("path") for r in rows if isinstance(r, dict)} != FILES):
        raise BrandReleaseError("brand inventory invalid")
    for row in rows:
        name = row["path"]
        data = contents[name]
        if row.get("size") != len(data) or row.get("sha256") != digest(data):
            raise BrandReleaseError("brand payload digest mismatch: " + name)
    sources = manifest.get("sources")
    if (not isinstance(sources, list) or len(sources) != len(SOURCE_PATHS)
            or {x.get("path") for x in sources if isinstance(x, dict)} != SOURCE_PATHS):
        raise BrandReleaseError("brand input provenance incomplete")
    for src in sources:
        repo = src.get("repository")
        if (repo not in (OWNER, LICENSE_OWNER)
                or src.get("commit") is None
                or SHA40.fullmatch(str(src["commit"])) is None
                or SHA40.fullmatch(str(src.get("git_blob"))) is None
                or SHA256.fullmatch(str(src.get("sha256"))) is None):
            raise BrandReleaseError("malformed brand provenance")
        if repo == OWNER and src["commit"] != pin["source_commit"]:
            raise BrandReleaseError("mixed Surface brand revision")
        if (src["path"] == LICENSE_PATH) != (repo == LICENSE_OWNER):
            raise BrandReleaseError("invalid license authority")
        if src["path"] == LICENSE_PATH and src["git_blob"] != LICENSE_BLOB:
            raise BrandReleaseError("invalid canonical font license")
    if b'url("./fonts/inter-latin-wght-normal.woff2")' not in contents["assets/ordax-font.css"]:
        raise BrandReleaseError("brand font URL is not locally resolvable")
    destination.mkdir(parents=True)
    for name, raw in contents.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    return destination
