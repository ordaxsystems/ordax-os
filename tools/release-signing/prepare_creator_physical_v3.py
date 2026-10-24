#!/usr/bin/env python3
"""Prepare an UNSIGNED Creator physical v3 manifest from verified Creator Core bindings.

This OS-owned operator handoff never signs, publishes, grants consent or writes media.
The canonical Creator Go CLI remains the only 17-artifact inventory and hasher.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from typing import Any

SCHEMA_V2 = "prototype-ordax.creator-physical-manifest/2"
SCHEMA_V3 = "prototype-ordax.creator-physical-manifest/3"
PAYLOAD_SCHEMA = "prototype-ordax.creator-portable-payload/1"
BINDINGS_SCHEMA = "prototype-ordax.portable-media-bindings/1"
AUTHORIZATION_SCHEMA = "prototype-ordax.physical-write-authorization/3"
REPOSITORY = "ordaxsystems/ordax-os"
RECIPE = "creator/physical/portable-windows/2"
PURPOSE = "creator-portable-physical-windows-amd64"
COMMIT = re.compile(r"^[0-9a-f]{40}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
ASSET_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
MAX_ASSET_BYTES = 16 << 30
MAX_TOTAL_BYTES = 32 << 30


class PreparationError(RuntimeError):
    pass


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PreparationError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _real_file(path: Path, label: str) -> Path:
    path = path.absolute()
    try:
        if not stat.S_ISREG(path.lstat().st_mode):
            raise PreparationError(f"{label} must be a regular file, not a symlink")
        if path.resolve(strict=True) != path:
            raise PreparationError(f"{label} traverses a symlink")
    except OSError as exc:
        raise PreparationError(f"{label} is missing or unsafe: {exc}") from exc
    return path


def _load_json(path: Path, label: str) -> dict[str, Any]:
    source = _real_file(path, label)
    if source.stat().st_size > (512 << 10):
        raise PreparationError(f"{label} is too large")
    try:
        document = json.loads(source.read_text(encoding="utf-8"), object_pairs_hook=_unique_pairs)
    except (UnicodeError, json.JSONDecodeError, OSError) as exc:
        raise PreparationError(f"{label} is invalid JSON: {exc}") from exc
    if not isinstance(document, dict):
        raise PreparationError(f"{label} must be a JSON object")
    return document


def _verified_bindings(document: dict[str, Any]) -> list[dict[str, Any]]:
    if document.get("$schema") != BINDINGS_SCHEMA:
        raise PreparationError("Creator source bindings have an unexpected schema")
    items = document.get("artifacts")
    if not isinstance(items, list) or len(items) != 17:
        raise PreparationError("exactly 17 Creator Core source bindings are required")
    seen: set[str] = set()
    total = 0
    result = []
    for item in items:
        if not isinstance(item, dict) or set(item) != {"id", "sha256", "size_bytes"}:
            raise PreparationError("Creator binding shape is not canonical")
        name, digest, size = item["id"], item["sha256"], item["size_bytes"]
        if not isinstance(name, str) or not ASSET_ID.fullmatch(name) or name in seen:
            raise PreparationError("duplicate or unsafe Creator artifact ID")
        if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
            raise PreparationError(f"invalid Creator artifact digest for {name}")
        if type(size) is not int or not 0 < size <= MAX_ASSET_BYTES:
            raise PreparationError(f"invalid Creator artifact size for {name}")
        total += size
        if total > MAX_TOTAL_BYTES:
            raise PreparationError("Creator sources exceed the signed Portable limit")
        seen.add(name)
        result.append({"id": name, "sha256": digest, "size_bytes": size})
    return sorted(result, key=lambda item: item["id"])


def prepare(
    manifest_path: Path, bindings_path: Path, sources_root: Path,
    creator_cli: Path, authorization_path: Path, output: Path,
) -> dict[str, Any]:
    manifest = _load_json(manifest_path, "v2 candidate manifest")
    if (
        manifest.get("$schema") != SCHEMA_V2
        or manifest.get("purpose") != PURPOSE
        or manifest.get("created_from_recipe") != RECIPE
        or manifest.get("source_repository") != REPOSITORY
        or not isinstance(manifest.get("source_commit"), str)
        or not COMMIT.fullmatch(manifest["source_commit"])
        or "portable_payload" in manifest
    ):
        raise PreparationError("input must be the unmodified OS physical candidate v2 manifest")

    authorization = _load_json(authorization_path, "canonical authorization")
    binding = authorization.get("release_binding")
    if authorization.get("$schema") != AUTHORIZATION_SCHEMA or not isinstance(binding, dict):
        raise PreparationError("canonical physical release binding is unavailable")
    release_commit = binding.get("source_commit")
    if not isinstance(release_commit, str) or not COMMIT.fullmatch(release_commit):
        raise PreparationError("physical release source commit is invalid")
    expected_envelope = (
        f"https://github.com/{REPOSITORY}/releases/download/"
        f"ordax-stable-v4-{release_commit}/release-envelope.json"
    )
    if binding.get("canonical_envelope_url") != expected_envelope:
        raise PreparationError("physical release binding URL is not canonical")
    if authorization.get("source_repository") != REPOSITORY:
        raise PreparationError("physical release publisher authority changed")
    if authorization.get("status") not in (
        "blocked-explicit-physical-authorization-pending", "authorized"
    ):
        raise PreparationError("physical authorization state is unsupported")
    if authorization.get("status") != "authorized" and (
        authorization.get("physical_write_allowed") is not False
        or authorization.get("explicit_owner_authorization") is not False
        or authorization.get("authorization_context_sha256") is not None
    ):
        raise PreparationError("blocked source unexpectedly contains physical consent")

    bindings = _verified_bindings(_load_json(bindings_path, "Creator Core bindings"))
    binary = _real_file(creator_cli, "independent Creator CLI")
    if not os.access(binary, os.X_OK):
        raise PreparationError("independent Creator CLI is not executable")
    if not sources_root.is_dir() or sources_root.is_symlink():
        raise PreparationError("Creator source root must be a real directory")
    if sources_root.absolute().resolve() != sources_root.absolute():
        raise PreparationError("Creator source root traverses a symlink")
    try:
        check = subprocess.run(
            [str(binary), "verify-portable-sources", "--bindings", str(bindings_path.absolute()),
             "--sources-root", str(sources_root.absolute())],
            check=False, capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PreparationError(f"Creator source verification unavailable: {exc}") from exc
    required = {
        "PORTABLE_SOURCES_VERIFIED=YES", "PORTABLE_SOURCE_COUNT=17",
        "PHYSICAL_DEVICE_TOUCHED=NO", "PHYSICAL_WRITE_AUTHORIZED=NO",
    }
    if check.returncode != 0 or not required.issubset(set(check.stdout.splitlines())):
        raise PreparationError("independent Creator Core rejected source bytes")

    prefix = f"https://github.com/{REPOSITORY}/releases/download/ordax-stable-v4-{release_commit}/"
    document = dict(manifest)
    document["$schema"] = SCHEMA_V3
    document["portable_payload"] = {
        "$schema": PAYLOAD_SCHEMA,
        "release_source_commit": release_commit,
        "artifacts": [dict(item, url=prefix + item["id"]) for item in bindings],
    }
    dest = output.absolute()
    if not dest.parent.is_dir() or dest.parent.is_symlink() or dest.parent.resolve() != dest.parent:
        raise PreparationError("output parent must be a real existing directory")
    try:
        with dest.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(document, stream, indent=2, sort_keys=True)
            stream.write("\n")
    except FileExistsError as exc:
        raise PreparationError("output already exists; overwrite forbidden") from exc
    return document


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("v2_manifest", "bindings", "sources_root", "creator_cli", "authorization", "output"):
        parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
    args = parser.parse_args()
    try:
        result = prepare(args.v2_manifest, args.bindings, args.sources_root,
                         args.creator_cli, args.authorization, args.output)
    except PreparationError as exc:
        parser.exit(2, f"unsigned v3 preparation blocked: {exc}\n")
    print(f"CREATOR_PHYSICAL_MANIFEST_SCHEMA={result['$schema']}")
    print("CREATOR_PORTABLE_SOURCE_BINDINGS=17_VERIFIED_BY_INDEPENDENT_CORE")
    print("CREATOR_PHYSICAL_MANIFEST_SIGNED=NO")
    print("CREATOR_PHYSICAL_RELEASE_PUBLISHED=NO")
    print("PHYSICAL_WRITE_AUTHORIZED_BY_PREPARATION=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
