#!/usr/bin/env python3
"""Owner/Development Creator release: consume OS media, never build the OS.

The OS owner publishes only QEMU-accepted image media. This Creator owner
binds exact OS bytes to its own Windows binary, version and Git identity.
Neither this module nor a normal Creator build can write a physical disk.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import zipfile

SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z][a-z0-9]*(?:\.[0-9]+)?)?\Z")
MEDIA_FILES = {
    "creator-owner-media.json", "ordax-bootstrap-seed.raw.gz",
    "ordax-symbol.png", "ordax-design-theme.json",
}
# Fingerprint only bytes embedded into the Owner Creator, not a rerun-only
# QEMU proof receipt. Exact source SHA by itself does not identify USB media.
OWNER_MEDIA_PAYLOAD_FIELDS = (
    "seed_sha256", "compressed_seed_sha256", "symbol_sha256",
    "theme_sha256", "trust_sha256", "prototype_manifest_sha256",
)


def owner_media_payload_sha256(media: dict) -> str:
    payload = {key: media.get(key) for key in OWNER_MEDIA_PAYLOAD_FIELDS}
    if any(not isinstance(value, str) or not SHA256.fullmatch(value)
           for value in payload.values()):
        raise ValueError("OS media payload has invalid canonical digest")
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


BUNDLE = "OrdaX-Creator-Owner-Prototype.zip"
TAG = "creator-owner-prototype"
CREATOR_REPO = "ordaxsystems/ordax-os"
OWNER = "ordaxsystems/ordax-os"
RELEASE_BASE = f"https://github.com/{CREATOR_REPO}/releases/download/{TAG}/"
BUNDLE_FILES = ("OrdaX-Creator.exe", "provenance.json", "ordax-symbol.png",
                "ordax-design-theme.json", "LEIA-ME.txt")
RELEASE_FILES = (BUNDLE, "SHA256SUMS.txt", "LEIA-ME.txt", "creator-owner-update.json")


def digest(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    total = 0
    with path.open("rb") as src:
        for part in iter(lambda: src.read(1024 * 1024), b""):
            h.update(part)
            total += len(part)
    return h.hexdigest(), total


def canonical_version(root: Path) -> str:
    doc = json.loads((root / "version.json").read_text(encoding="utf-8"))
    if set(doc) != {"$schema", "version"} or doc["$schema"] != "ordax.creator-product-version/1":
        raise ValueError("Creator has no single version authority")
    v = doc["version"]
    if not isinstance(v, str) or not VERSION.fullmatch(v):
        raise ValueError("invalid canonical Creator version")
    return v


def valid_media(media: Path, *, verify_gzip: bool) -> dict:
    if ({p.name for p in media.iterdir()} != MEDIA_FILES
            or any(not p.is_file() or p.is_symlink() for p in media.iterdir())):
        raise ValueError("OS media has unexpected, missing, or linked files")
    meta = json.loads((media / "creator-owner-media.json").read_text(encoding="utf-8"))
    if (meta.get("$schema") != "prototype-ordax.creator-owner-media/1"
            or meta.get("channel") != "owner-prototype"
            or meta.get("status") != "qemu-accepted-development-media-only"
            or meta.get("source_repository") != OWNER
            or meta.get("qemu_two_boot_acceptance") is not True
            or meta.get("physical_hardware_proven") is not False
            or meta.get("windows_executable_in_media") is not False
            or meta.get("canonical_public_release") is not False
            or meta.get("private_key_in_package") is not False):
        raise ValueError("OS image is not accepted Owner Dev media")
    for field in ("source_commit", "assembly_creator_source_commit"):
        if not isinstance(meta.get(field), str) or not SHA40.fullmatch(meta[field]):
            raise ValueError("OS source commit invalid: " + field)
    for field in ("seed_sha256", "compressed_seed_sha256", "symbol_sha256",
                  "theme_sha256", "trust_sha256", "prototype_manifest_sha256",
                  "qemu_proof_sha256"):
        if not isinstance(meta.get(field), str) or not SHA256.fullmatch(meta[field]):
            raise ValueError("OS media digest invalid: " + field)
    for field in ("seed_size", "compressed_seed_size"):
        if type(meta.get(field)) is not int or not 0 < meta[field] <= 8 * 1024**3:
            raise ValueError("OS media size invalid: " + field)
    for name, sha, size in (
        ("ordax-bootstrap-seed.raw.gz", "compressed_seed_sha256", "compressed_seed_size"),
        ("ordax-symbol.png", "symbol_sha256", None),
        ("ordax-design-theme.json", "theme_sha256", None),
    ):
        actual_hash, actual_size = digest(media / name)
        if actual_hash != meta[sha] or (size and actual_size != meta[size]):
            raise ValueError("OS media file differs from manifest: " + name)
    if ((media / "ordax-symbol.png").stat().st_size > 2 << 20 or
            (media / "ordax-design-theme.json").stat().st_size > 64 << 10):
        raise ValueError("OS visual assets exceed limits")
    if verify_gzip:
        total = 0
        h = hashlib.sha256()
        with gzip.open(media / "ordax-bootstrap-seed.raw.gz", "rb") as src:
            while part := src.read(1024 * 1024):
                total += len(part)
                if total > meta["seed_size"]:
                    raise ValueError("OS seed expands beyond verified length")
                h.update(part)
        if total != meta["seed_size"] or h.hexdigest() != meta["seed_sha256"]:
            raise ValueError("OS decompressed image does not match QEMU-verified seed")
    return meta


def stage(media: Path, root: Path, bundle: Path, source: str, tree: str) -> None:
    if not SHA40.fullmatch(source) or not SHA40.fullmatch(tree):
        raise ValueError("Creator Git source/tree identity missing")
    m = valid_media(media, verify_gzip=True)
    version = canonical_version(root)
    embedded = root / "cmd/ordax-creator-app/owner_payload"
    if embedded.exists():
        raise ValueError("Creator source already contains an embedded Owner payload")
    embedded.mkdir(parents=True)
    bundle.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(media / "ordax-bootstrap-seed.raw.gz",
                    embedded / "ordax-bootstrap-seed.raw.gz")
    provenance = {
        "$schema": "prototype-ordax.creator-owner-physical/1",
        "status": "owner-prototype-write-enabled",
        "source_commit": m["source_commit"],
        "creator_source_repository": CREATOR_REPO,
        "creator_source_commit": source,
        "creator_source_tree": tree,
        "creator_version": version,
        "canonical_public_release": False,
        "ephemeral_prototype_trust": True,
        "private_key_in_package": False,
        "raw_backend_linked": True,
        "physical_write_authorized_in_binary": True,
        "system_disk_exclusion_required": True,
        "live_target_revalidation_required": True,
        "windows_uac_required": True,
        "readback_verification_required": True,
        "trust_sha256": m["trust_sha256"],
        "prototype_manifest_sha256": m["prototype_manifest_sha256"],
        "seed_sha256": m["seed_sha256"],
        "seed_size": m["seed_size"],
        "symbol_sha256": m["symbol_sha256"],
        "theme_sha256": m["theme_sha256"],
    }
    data = json.dumps(provenance, indent=2, sort_keys=True) + "\n"
    (embedded / "provenance.json").write_text(data, encoding="utf-8")
    (bundle / "provenance.json").write_text(data, encoding="utf-8")
    for asset in ("ordax-symbol.png", "ordax-design-theme.json"):
        shutil.copyfile(media / asset, bundle / asset)
    readme = (
        "OrdaX Creator — Owner Development USB\n\n"
        "Abra somente OrdaX-Creator.exe. Selecione apenas o pendrive removivel.\n"
        "Windows solicita UAC apenas para gravar, apos a confirmacao do disco.\n"
        "A imagem QEMU-verificada do OrdaX OS esta incorporada ao executavel.\n"
        "O programa, sua versao e atualizacoes pertencem a ordax-os/creator/.\n"
        "O sistema e a imagem USB pertencem a ordax-os.\n\n"
        "Canal de desenvolvimento sem assinatura Authenticode de producao.\n"
    )
    (bundle / "LEIA-ME.txt").write_text(readme, encoding="utf-8")
    print("CREATOR_MEDIA_BOUND=PASS os=" + m["source_commit"] +
          " creator=" + source + " version=" + version)


def package(media: Path, root: Path, bundle: Path, release: Path,
            source: str, tree: str) -> None:
    m = valid_media(media, verify_gzip=False)
    version = canonical_version(root)
    if not SHA40.fullmatch(source) or not SHA40.fullmatch(tree):
        raise ValueError("Creator revision identity is invalid")
    p = json.loads((bundle / "provenance.json").read_text(encoding="utf-8"))
    if (p.get("source_commit") != m["source_commit"]
            or p.get("creator_source_commit") != source
            or p.get("creator_source_tree") != tree
            or p.get("creator_version") != version
            or p.get("seed_sha256") != m["seed_sha256"]
            or p.get("seed_size") != m["seed_size"]
            or p.get("trust_sha256") != m["trust_sha256"]):
        raise ValueError("Creator release differs from validated OS image/source")
    if ({x.name for x in bundle.iterdir()} != set(BUNDLE_FILES)
            or any(not x.is_file() or x.is_symlink() for x in bundle.iterdir())):
        raise ValueError("Windows distribution must contain five regular files")
    exe = bundle / "OrdaX-Creator.exe"
    with exe.open("rb") as stream:
        if stream.read(2) != b"MZ":
            raise ValueError("Creator binary is not a Windows executable")
    for name, sha_field in (("ordax-symbol.png", "symbol_sha256"),
                            ("ordax-design-theme.json", "theme_sha256")):
        if digest(bundle / name)[0] != m[sha_field]:
            raise ValueError("Creator embedded visual asset differs from OS SSOT")
    release.mkdir(parents=True, exist_ok=True)
    out = release / BUNDLE
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for filename in BUNDLE_FILES:
            z.write(bundle / filename, arcname="OrdaX-Creator/" + filename)
    with zipfile.ZipFile(out) as z:
        if set(z.namelist()) != {"OrdaX-Creator/" + n for n in BUNDLE_FILES} or len(z.namelist()) != 5:
            raise ValueError("Creator ZIP unexpectedly gained another executable")
        embedded_p = json.loads(z.read("OrdaX-Creator/provenance.json"))
        if embedded_p != p:
            raise ValueError("Creator ZIP provenance changed")
    archive_sha, archive_size = digest(out)
    if archive_size <= 0 or archive_size > 2 << 30:
        raise ValueError("Creator ZIP exceeds Owner channel limits")
    (release / "SHA256SUMS.txt").write_text(
        archive_sha + "  " + BUNDLE + "\n", encoding="ascii")
    shutil.copyfile(bundle / "LEIA-ME.txt", release / "LEIA-ME.txt")
    manifest = {
        "$schema": "prototype-ordax.creator-owner-bundle-update/2",
        "channel": "owner-prototype",
        "owner_repository": CREATOR_REPO,
        "version": version,
        "source_commit": m["source_commit"],
        "creator_source_commit": source,
        "os_media_payload_sha256": owner_media_payload_sha256(m),
        "artifact": BUNDLE,
        "download_url": RELEASE_BASE + BUNDLE,
        "sha256": archive_sha,
        "size": archive_size,
        "automatic_in_app_update": False,
    }
    (release / "creator-owner-update.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("CREATOR_RELEASE=PASS " + archive_sha + " source=" + source)


def verify_published(release: Path, remote: Path) -> None:
    doc = json.loads(remote.read_text(encoding="utf-8"))
    assets = doc.get("assets")
    if (doc.get("tag_name") != TAG or doc.get("prerelease") is not True
            or doc.get("draft") is not False or not isinstance(assets, list)
            or len(assets) != len(RELEASE_FILES)):
        raise ValueError("Creator release channel is not the expected prerelease")
    names = [a.get("name") for a in assets]
    if len(names) != len(set(names)) or set(names) != set(RELEASE_FILES):
        raise ValueError("published Creator asset membership mismatch")
    for a in assets:
        name = a["name"]
        local_sha, size = digest(release / name)
        if (a.get("digest") != "sha256:" + local_sha or
                a.get("size") != size or a.get("state") not in (None, "uploaded")):
            raise ValueError("published Creator asset readback failed: " + name)
    manifest = json.loads((release / "creator-owner-update.json").read_text(encoding="utf-8"))
    sha, size = digest(release / BUNDLE)
    if (manifest.get("$schema") != "prototype-ordax.creator-owner-bundle-update/2" or
            manifest.get("owner_repository") != CREATOR_REPO or
            manifest.get("download_url") != RELEASE_BASE + BUNDLE or
            manifest.get("sha256") != sha or manifest.get("size") != size or
            not isinstance(manifest.get("os_media_payload_sha256"), str) or
            not SHA256.fullmatch(manifest["os_media_payload_sha256"])):
        raise ValueError("published Creator manifest mismatch")
    print("CREATOR_PUBLISHED_READBACK=PASS " + sha)


def up_to_date(media_manifest: Path, existing: Path | None, root: Path, source: str) -> bool:
    current = json.loads(media_manifest.read_text(encoding="utf-8"))
    if (current.get("$schema") != "prototype-ordax.creator-owner-media/1"
            or current.get("source_repository") != OWNER
            or current.get("status") != "qemu-accepted-development-media-only"
            or not SHA40.fullmatch(current.get("source_commit", ""))):
        raise ValueError("OS image manifest not a verified Owner source")
    if existing is None or not existing.is_file():
        return False
    try:
        p = json.loads(existing.read_text(encoding="utf-8"))
    except (ValueError, OSError, json.JSONDecodeError):
        return False
    return (p.get("$schema") == "prototype-ordax.creator-owner-bundle-update/2"
            and p.get("owner_repository") == CREATOR_REPO
            and p.get("source_commit") == current["source_commit"]
            # A mutable release tag must be bound to the actual USB image
            # and trust bytes. A legacy manifest is simply not CURRENT.
            and p.get("os_media_payload_sha256") == owner_media_payload_sha256(current)
            and p.get("creator_source_commit") == source
            and p.get("version") == canonical_version(root)
            and p.get("download_url") == RELEASE_BASE + BUNDLE
            and SHA256.fullmatch(p.get("sha256", "")) is not None)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=("status", "stage", "package", "readback"))
    p.add_argument("--media", type=Path)
    p.add_argument("--root", type=Path, default=Path("."))
    p.add_argument("--bundle", type=Path)
    p.add_argument("--release", type=Path)
    p.add_argument("--remote", type=Path)
    p.add_argument("--existing", type=Path)
    p.add_argument("--creator-sha")
    p.add_argument("--creator-tree")
    p.add_argument("--github-output", type=Path)
    args = p.parse_args()
    if args.action == "status":
        if not SHA40.fullmatch(args.creator_sha or ""):
            raise ValueError("Creator SHA missing")
        fresh = not up_to_date(args.media, args.existing, args.root, args.creator_sha)
        if args.github_output:
            with args.github_output.open("a", encoding="utf-8") as dst:
                dst.write("publish_required=" + str(fresh).lower() + "\n")
        print("CREATOR_PUBLICATION_REQUIRED=" + str(fresh).upper())
    elif args.action == "stage":
        stage(args.media, args.root, args.bundle, args.creator_sha, args.creator_tree)
    elif args.action == "package":
        package(args.media, args.root, args.bundle, args.release,
                args.creator_sha, args.creator_tree)
    else:
        verify_published(args.release, args.remote)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, EOFError, gzip.BadGzipFile, zipfile.BadZipFile) as exc:
        print("CREATOR_OWNER_RELEASE=FAIL " + str(exc), file=sys.stderr)
        raise SystemExit(1)
