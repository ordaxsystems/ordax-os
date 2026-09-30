#!/usr/bin/env python3
"""Validate the exact Alpine Wine packaging input used by OrdaX build proofs."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "wine-packaging-inputs.json"
PATCH_PATH = HERE / "alpine-wine-rpath.patch"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
SHA128 = re.compile(r"^[0-9a-f]{128}$")


class WinePackagingInputError(RuntimeError):
    pass


def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WinePackagingInputError(f"cannot load Wine packaging input contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.windows-compat-wine-packaging-inputs/1":
        raise WinePackagingInputError("unexpected Wine packaging input schema")
    if value.get("status") != "alpine-wine-packaging-input-pinned-not-runtime-promoted":
        raise WinePackagingInputError("Wine packaging input status drifted")
    if value.get("runtime_id") != "wine-11.0-wow64-x86_64-candidate" or value.get("wine_version") != "11.0":
        raise WinePackagingInputError("Wine packaging runtime identity drifted")
    return value


def validate() -> dict:
    value = load_contract()
    authority = value.get("authority", {})
    expected_authority = {
        "distribution": "alpine",
        "repository": "alpinelinux/aports",
        "commit_sha": "359eb9ae4f36cb7699db0945cc18c32c562cd5fc",
        "apkbuild_path": "community/wine/APKBUILD",
        "apkbuild_git_blob_sha": "74e0efc2f6150cd32ff0cee8e8207af682f03e30",
        "patch_path": "community/wine/rpath.patch",
        "patch_git_blob_sha": "07d4b8db7af40e16c086c82425eb0ab9303ad19a",
        "apkbuild_declared_patch_sha512": "72f64ed66ce24cf51f278874edc351c9297ebbad22adedd3036f1ead5113b0a09660f7fff4034c7b6a05bd7c15d42d9d7d203e8bd8a7fe1027643b6f49470ff3",
    }
    if authority != expected_authority:
        raise WinePackagingInputError("Alpine Wine packaging authority drifted")
    if not SHA40.fullmatch(authority["commit_sha"]) or not SHA40.fullmatch(authority["patch_git_blob_sha"]):
        raise WinePackagingInputError("invalid Alpine Git identity")

    local = value.get("local_patch", {})
    if local.get("path") != PATCH_PATH.name or local.get("size_bytes") != 1569:
        raise WinePackagingInputError("local Wine packaging patch metadata drifted")
    if not SHA64.fullmatch(str(local.get("sha256", ""))) or not SHA128.fullmatch(str(local.get("sha512", ""))):
        raise WinePackagingInputError("invalid Wine packaging patch digest")
    try:
        raw = PATCH_PATH.read_bytes()
    except OSError as exc:
        raise WinePackagingInputError(f"cannot read Wine packaging patch: {exc}") from exc
    if len(raw) != local["size_bytes"]:
        raise WinePackagingInputError("Wine packaging patch size drifted")
    if hashlib.sha256(raw).hexdigest() != local["sha256"]:
        raise WinePackagingInputError("Wine packaging patch SHA-256 drifted")
    actual_sha512 = hashlib.sha512(raw).hexdigest()
    if actual_sha512 != local["sha512"] or actual_sha512 != authority["apkbuild_declared_patch_sha512"]:
        raise WinePackagingInputError("Wine packaging patch SHA-512 diverged from Alpine APKBUILD authority")

    semantics = value.get("semantics", {})
    expected_semantics = {
        "host_os": "linux-musl",
        "linker_flag": "-Wl,-rpath,$ORIGIN",
        "wine_variable": "UNIXLDFLAGS",
        "purpose": "make staged Wine Unixlibs resolve sibling DT_NEEDED Unixlibs through their own directory without ambient LD_LIBRARY_PATH",
        "ambient_ld_library_path_required": False,
        "global_wine_directory_search_fallback_allowed": False,
        "basename_fallback_allowed": False,
    }
    if semantics != expected_semantics:
        raise WinePackagingInputError("Wine packaging semantics drifted")
    text = raw.decode("utf-8", errors="strict")
    if "UNIXLDFLAGS" not in text or "rpath" not in text or "$ORIGIN" not in text:
        raise WinePackagingInputError("Wine packaging patch no longer proves $ORIGIN Unixlib semantics")

    promotion = value.get("promotion", {})
    if promotion.get("packaging_patch_content_pinned") is not True:
        raise WinePackagingInputError("Wine packaging patch content pin is not asserted")
    forbidden = (
        "runtime_dependency_inventory_complete",
        "runtime_package_content_hashes_pinned",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "wine_executed",
        "windows_payload_executed",
    )
    if any(promotion.get(key) is not False for key in forbidden):
        raise WinePackagingInputError("Wine packaging input crossed a forbidden runtime/execution boundary")
    return value


def main() -> int:
    validate()
    print("windows compatibility Wine packaging input: PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except WinePackagingInputError as exc:
        print(f"windows-compat-wine-packaging: {exc}", file=sys.stderr)
        raise SystemExit(2)
