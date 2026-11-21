"""Fetch only an explicitly pinned Surface-owned Dev prerelease; never trust status flags.

This is a read-only artifact resolver. It cannot build Surface or authorize Site
publication. The Site builder validates the unpacked source graph and assets.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import tarfile
import urllib.parse
import urllib.request
from pathlib import Path

OWNER = "ordaxsystems/ordax-surface"
MAX_ARCHIVE = 15 * 1024 * 1024
MAX_FILES = 48
MAX_ASSETS = 12 * 1024 * 1024
SHA40 = re.compile(r"[a-f0-9]{40}\Z")
SHA256 = re.compile(r"[a-f0-9]{64}\Z")
ASSET = re.compile(r"assets/[A-Za-z0-9._/-]+\Z")


class SurfaceReleaseError(ValueError):
    pass


def validate_pin(item: dict) -> dict:
    required = {"source_repository", "source_commit", "os_host_commit",
                "release_tag", "archive_sha256", "manifest_sha256"}
    if not isinstance(item, dict) or set(item) != required:
        raise SurfaceReleaseError("invalid Surface Dev release pin")
    if (item["source_repository"] != OWNER
            or not isinstance(item["source_commit"], str)
            or SHA40.fullmatch(item["source_commit"]) is None
            or not isinstance(item["os_host_commit"], str)
            or SHA40.fullmatch(item["os_host_commit"]) is None
            or item["release_tag"] != "meridian-dev-" + item["source_commit"]
            or not isinstance(item["archive_sha256"], str)
            or SHA256.fullmatch(item["archive_sha256"]) is None
            or not isinstance(item["manifest_sha256"], str)
            or SHA256.fullmatch(item["manifest_sha256"]) is None):
        raise SurfaceReleaseError("invalid Surface Dev release pin")
    return item


def _allowed_final_url(value: str) -> bool:
    parsed = urllib.parse.urlsplit(value)
    host = parsed.hostname or ""
    return (parsed.scheme == "https" and parsed.username is None
            and parsed.password is None and parsed.port in (None, 443)
            and (host == "github.com" or host.endswith(".githubusercontent.com")))


def download_pinned_archive(url: str, expected_sha256: str, *,
                            max_bytes: int = MAX_ARCHIVE, open_url=None) -> bytes:
    """Single trusted HTTP(S) download path for Surface-owned Dev releases."""
    if not SHA256.fullmatch(str(expected_sha256)) or not _allowed_final_url(url):
        raise SurfaceReleaseError("invalid pinned Surface release origin/digest")
    if open_url is None:
        open_url = urllib.request.urlopen
    request = urllib.request.Request(url, headers={"User-Agent": "OrdaX-Site-Dev-Builder/1"})
    with open_url(request, timeout=60) as response:
        if not _allowed_final_url(response.geturl()) or getattr(response, "status", 200) != 200:
            raise SurfaceReleaseError("untrusted Surface Dev redirect")
        archive = response.read(max_bytes + 1)
    if len(archive) > max_bytes:
        raise SurfaceReleaseError("Surface Dev release too large")
    if hashlib.sha256(archive).hexdigest() != expected_sha256:
        raise SurfaceReleaseError("Surface Dev release archive pin mismatch")
    return archive


def materialize(pin: dict, destination: Path, *, open_url=None) -> Path:
    """Bounded download, external SHA pin, then safe non-executable TAR read.

    No path traversal, links, unlisted files, duplicate entries, or checkout
    source is allowed. Never extract TAR directly onto a deployed Site.
    """
    validate_pin(pin)
    if destination.exists() or destination.is_symlink():
        raise SurfaceReleaseError("Surface Dev destination already exists")
    name = "meridian-dev-" + pin["source_commit"] + ".tar.gz"
    url = "https://github.com/" + OWNER + "/releases/download/" + pin["release_tag"] + "/" + name
    archive = download_pinned_archive(url, pin["archive_sha256"], open_url=open_url)
    records = {}
    total = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
            for member in tar:
                path = member.name.removeprefix("./")
                if member.isdir():
                    if path.rstrip("/") not in ("", ".", "assets"):
                        raise SurfaceReleaseError("unexpected archive directory")
                    continue
                if not member.isfile() or (path != "manifest.json" and (
                        ASSET.fullmatch(path) is None
                        or any(s in ("", ".", "..") for s in path.split("/"))
                        or Path(path).suffix.lower() not in
                        (".json", ".css", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".woff2"))):
                    raise SurfaceReleaseError("untrusted Surface Dev archive entry")
                if path in records or len(records) >= MAX_FILES + 1:
                    raise SurfaceReleaseError("duplicate or excessive Surface Dev entries")
                if member.size < 0 or member.size > MAX_ASSETS:
                    raise SurfaceReleaseError("invalid Surface Dev entry size")
                total += member.size
                if total > MAX_ASSETS:
                    raise SurfaceReleaseError("Surface Dev release exceeds asset budget")
                fd = tar.extractfile(member)
                if fd is None:
                    raise SurfaceReleaseError("invalid Surface Dev member")
                data = fd.read(MAX_ASSETS + 1)
                if len(data) != member.size:
                    raise SurfaceReleaseError("Surface Dev entry size mismatch")
                records[path] = data
    except (tarfile.TarError, EOFError, OSError) as error:
        raise SurfaceReleaseError("invalid Surface Dev release archive") from error
    if not {"manifest.json", "assets/playground-fixture.json",
            "assets/surface-snapshot.css"} <= set(records):
        raise SurfaceReleaseError("Surface Dev release required assets missing")
    if hashlib.sha256(records["manifest.json"]).hexdigest() != pin["manifest_sha256"]:
        raise SurfaceReleaseError("Surface Dev manifest pin mismatch")
    try:
        manifest = json.loads(records["manifest.json"])
    except (ValueError, UnicodeError) as error:
        raise SurfaceReleaseError("invalid Surface Dev manifest") from error
    if (manifest.get("source_repository") != OWNER
            or manifest.get("source_commit") != pin["source_commit"]
            or manifest.get("os_host_repository") != "ordaxsystems/ordax-os"
            or manifest.get("os_host_commit") != pin["os_host_commit"]
            or manifest.get("status") != "candidate-not-published"
            or manifest.get("runtime_authority") is not False):
        raise SurfaceReleaseError("Surface Dev multi-owner provenance mismatch")
    inventory = manifest.get("files")
    if (not isinstance(inventory, list)
            or {item.get("path") for item in inventory if isinstance(item, dict)}
            != set(records) - {"manifest.json"}
            or len(inventory) != len(records) - 1):
        raise SurfaceReleaseError("Surface Dev release inventory mismatch")
    destination.mkdir(parents=True)
    for path, data in records.items():
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return destination
