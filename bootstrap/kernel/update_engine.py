#!/usr/bin/env python3
"""Discover and authenticate future patch releases without editing CI code.

The updater never replaces the active kernel, adds trusted keys, or promotes
any release. A proposed source is published only *after* OpenPGP verification
against the currently reviewed immutable signing identity.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
FEED = "https://www.kernel.org/releases.json"
MAX_FEED = 256 * 1024
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_SIGNATURE = 128 * 1024
MAX_KEY_RESPONSE = 2 * 1024 * 1024


def load_owner(filename: str, name: str):
    location = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(name, location)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PIPELINE = load_owner("candidate_pipeline.py", "ordax_kernel_update_candidate")
KERNEL = load_owner("build.py", "ordax_kernel_update_build")


class UpdateError(RuntimeError):
    pass


def signed_feed_entry(feed: dict, current: str) -> dict:
    current_tuple = PIPELINE.version_tuple(current)
    if not isinstance(feed, dict) or not isinstance(feed.get("releases"), list):
        raise UpdateError("invalid kernel.org release metadata")
    found = []
    for release in feed["releases"]:
        if not isinstance(release, dict) or release.get("moniker") != "longterm" or release.get("iseol") is not False:
            continue
        version = release.get("version")
        try:
            release_tuple = PIPELINE.version_tuple(version)
        except PIPELINE.CandidateError:
            continue
        if release_tuple[:2] != current_tuple[:2]:
            continue
        archive = f"https://cdn.kernel.org/pub/linux/kernel/v{release_tuple[0]}.x/linux-{version}.tar.xz"
        signature = archive.removesuffix(".xz").removesuffix(".tar") + ".tar.sign"
        if release.get("source") != archive or release.get("pgp") != signature:
            raise UpdateError("official feed release URLs conflict with kernel.org canonical paths")
        found.append((release_tuple, {"version": version, "source": archive, "pgp": signature}))
    if len(found) != 1:
        raise UpdateError("expected exactly one supported longterm release for the selected kernel line")
    return found[0][1]


def download_bounded(url: str, path: Path, max_bytes: int) -> str:
    size = 0
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(url, timeout=120) as stream, path.open("xb") as out:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise UpdateError("upstream input exceeds bounded size")
                digest.update(chunk)
                out.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    if size == 0:
        path.unlink(missing_ok=True)
        raise UpdateError("empty upstream input")
    return digest.hexdigest()


def load_feed() -> dict:
    with tempfile.TemporaryDirectory(prefix="ordax-kernel-feed-") as tmp:
        path = Path(tmp) / "releases.json"
        download_bounded(FEED, path, MAX_FEED)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise UpdateError("kernel.org feed contains invalid JSON") from exc


def candidate_record(entry: dict, previous: dict, digest: str) -> dict:
    version = entry["version"]
    result = {
        "$schema": "prototype-ordax.kernel-source/1",
        "version": version,
        "archive_url": entry["source"],
        "signature_url": entry["pgp"],
        "archive_sha256": digest,
        "configuration": previous["configuration"],
        "build": {
            "canonical_entrypoint": "bootstrap/kernel/build.py",
            "pinned_environment_resolved": False,
            "physical_artifact_authorized": False,
        },
        "upstream_signature": previous["upstream_signature"],
    }
    KERNEL.UPSTREAM_SIGNATURE.validate_source_contract(result)
    return result


def write_exact(path: Path, content: bytes) -> bool:
    if path.is_symlink():
        raise UpdateError(f"unsafe output path: {path}")
    if path.exists():
        if not path.is_file() or path.read_bytes() != content:
            raise UpdateError(f"reviewed candidate exists with different bytes: {path}")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".candidate-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
        os.replace(tmp, path)
    finally:
        Path(tmp).unlink(missing_ok=True)
    return True


def prepare_new_candidate(entry: dict, root: Path = ROOT) -> dict:
    root = root.resolve()
    previous_path, previous = PIPELINE.select_candidate(root)
    active = PIPELINE.read_json(root / "bootstrap/kernel/source.json")
    new_version = PIPELINE.version_tuple(entry["version"])
    old_version = PIPELINE.version_tuple(previous["version"])
    if new_version[:2] != old_version[:2] or new_version <= old_version:
        return {"status": "up-to-date", "candidate": previous["version"]}
    if new_version[:2] != PIPELINE.version_tuple(active["version"])[:2]:
        raise UpdateError("kernel line transition requires separate architecture review")
    archive_url = f"https://cdn.kernel.org/pub/linux/kernel/v{new_version[0]}.x/linux-{entry['version']}.tar.xz"
    if entry.get("source") != archive_url or entry.get("pgp") != archive_url.removesuffix(".xz").removesuffix(".tar") + ".tar.sign":
        raise UpdateError("candidate download URL is not canonical kernel.org")
    with tempfile.TemporaryDirectory(prefix="ordax-kernel-auth-") as tmp:
        directory = Path(tmp)
        archive = directory / "source.tar.xz"
        digest = download_bounded(entry["source"], archive, MAX_ARCHIVE)
        record = candidate_record(entry, previous, digest)
        contract = directory / "candidate.json"
        contract.write_text(json.dumps(record, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        signature = directory / "source.tar.sign"
        download_bounded(entry["pgp"], signature, MAX_SIGNATURE)
        armored_b64 = directory / "key.asc.base64"
        download_bounded(previous["upstream_signature"]["trusted_public_key_url"], armored_b64, MAX_KEY_RESPONSE)
        try:
            public_key = base64.b64decode(armored_b64.read_bytes().strip(), validate=True)
        except (ValueError, base64.binascii.Error) as exc:
            raise UpdateError("trusted immutable key source is not valid base64") from exc
        if not public_key or len(public_key) > 1024 * 1024:
            raise UpdateError("invalid bounded kernel signer key")
        key = directory / "key.asc"
        key.write_bytes(public_key)
        proof = KERNEL.UPSTREAM_SIGNATURE.verify(contract, archive, signature, key)
        if proof.get("status") != "verified":
            raise UpdateError("new patch lacks the pinned signer OpenPGP proof")
        candidate = root / f"bootstrap/kernel/candidates/{entry['version']}.json"
        serialized = (json.dumps(record, sort_keys=True, indent=2) + "\n").encode("utf-8")
        created = write_exact(candidate, serialized)
    pointer = {
        "$schema": PIPELINE.SELECTION_SCHEMA,
        "source_contract": f"bootstrap/kernel/candidates/{entry['version']}.json",
    }
    selected = root / "bootstrap/kernel/candidates/proposal.json"
    if selected.is_symlink() or not selected.is_file():
        raise UpdateError("unsafe current candidate selector")
    old_pointer = selected.read_bytes()
    updated_pointer = (json.dumps(pointer, indent=2) + "\n").encode("utf-8")
    if old_pointer != updated_pointer:
        fd, tmp = tempfile.mkstemp(prefix=".selector-", dir=selected.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(updated_pointer)
            os.replace(tmp, selected)
        finally:
            Path(tmp).unlink(missing_ok=True)
    PIPELINE.select_candidate(root)
    return {
        "status": "authenticated-candidate-proposed",
        "version": entry["version"],
        "source_contract": str(candidate.relative_to(root)),
        "sha256": digest,
        "created_new_contract": created,
        "signer_verified": True,
        "physical_write_authorized": False,
        "stable_mvp_promoted": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Update proposal for the active Linux LTS series")
    parser.add_argument("command", choices=["discover", "prepare"])
    parser.add_argument("--version", help="optional exact patch from kernel.org feed, never another LTS line")
    args = parser.parse_args()
    try:
        _, selected = PIPELINE.select_candidate()
        feed = signed_feed_entry(load_feed(), selected["version"])
        if args.version and args.version != feed["version"]:
            raise UpdateError("requested patch does not match latest signed longterm feed")
        if args.command == "discover":
            status = "update-available" if PIPELINE.version_tuple(feed["version"]) > PIPELINE.version_tuple(selected["version"]) else "up-to-date"
            result = {"status": status, "current_candidate": selected["version"], "latest": feed["version"],
                      "physical_write_authorized": False}
        else:
            result = prepare_new_candidate(feed)
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except (UpdateError, PIPELINE.CandidateError, KERNEL.BuildError, KERNEL.UPSTREAM_SIGNATURE.VerificationError,
            OSError, ValueError, KeyError) as exc:
        print(f"KERNEL_UPDATE=FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
