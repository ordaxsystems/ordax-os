#!/usr/bin/env python3
"""Emit Git exclusions for *proven* Linux-only files in the existing OS SSOT.

Exit nonzero on unknown content. Vercel will build instead of skipping.
The output consists solely of fixed-prefix, whitespace-free Git pathspecs.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

ROOT = Path.cwd()
AUTONOMY = ROOT / "docs/contracts/build-autonomy.json"
SAFE = re.compile(r"[a-z0-9][a-z0-9._/-]*\Z")


def linux_only_exclusions() -> list[str]:
    source = json.loads(AUTONOMY.read_text(encoding="utf-8"))
    client = source["client_build_independence"]
    boot = client["windows_package_forbidden_linux_boot_paths"]
    shells = client["windows_package_forbidden_linux_shell_paths"]
    probes = client["linux_only_client_probe_paths"]
    hosts = client["linux_only_client_host_entrypoints"]
    manifest = client["linux_only_client_package_manifest"]
    if manifest != "surface/runtime/packages.txt":
        raise ValueError("unrecognized Linux package manifest")
    if not isinstance(boot, list) or not isinstance(shells, list) or len(boot) != 4 or not shells:
        raise ValueError("missing canonical Linux-only source classification")
    if (not isinstance(probes, list) or len(probes) != 4
            or any(not isinstance(item, str) or not re.fullmatch(
                r"surface/runtime/(?:media_runtime|physical_(?:ata|kernel_log|performance))_probe\.py",
                item) for item in probes)):
        raise ValueError("invalid Linux-only probes")
    if (not isinstance(hosts, list) or len(hosts) != 2
            or len(set(map(str, hosts))) != 2
            or any(not isinstance(p, str) or not re.fullmatch(
                r"surface/runtime/(?:native_host_server|ordax_browser_host)\.py", p)
                   for p in hosts)):
        raise ValueError("unverified Linux graphical host classification")
    linux_launcher = ROOT / "system/surface/bin/ordax-surface"
    if linux_launcher.is_symlink() or not linux_launcher.is_file():
        raise ValueError("Linux graphical launcher missing")
    launcher = linux_launcher.read_text(encoding="utf-8")
    if not launcher.startswith("#!/bin/sh\n"):
        raise ValueError("Linux graphical launcher not POSIX")
    for path in hosts:
        if path not in launcher:
            raise ValueError("Unconsumed Linux graphical host")
        source_file = ROOT / "system" / path
        if (source_file.is_symlink() or not source_file.is_file()
                or source_file.stat().st_size > 512 * 1024):
            raise ValueError("Linux graphical host unavailable")
        source = source_file.read_text(encoding="utf-8")
        signature = ("from http.server import" if path.endswith("native_host_server.py")
                     else 'gi.require_version("WebKit2", "4.1")')
        if not source.startswith("#!/usr/bin/env python3\n") or signature not in source:
            raise ValueError("Linux graphical host identity changed")
    paths = boot + shells + probes + hosts
    if len(set(paths)) != len(paths):
        raise ValueError("duplicate Linux exclusion")
    for rel in paths:
        if (not isinstance(rel, str) or not SAFE.fullmatch(rel)
                or any(segment in ("", ".", "..") for segment in rel.split("/"))
                or (rel not in boot and rel not in probes and
                    not rel.endswith(".sh") and
                    not re.fullmatch(r"surface/bin/ordax-[a-z0-9-]+", rel))):
            raise ValueError("unsafe Linux exclusion")
        file = ROOT / "system" / rel
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 512 * 1024:
            raise ValueError("unverified Linux source")
        with file.open("rb") as handle:
            expected = b"#!/usr/bin/env python3\n" if rel in probes or rel in hosts else b"#!/bin/sh\n"
            if handle.read(len(expected)) != expected:
                raise ValueError("unverified Linux-only executable")
    # Alpine package selection is a Linux producer, never a Web client input.
    # Fail closed on an absent, linked, oversized or unexpected manifest.
    package_source = ROOT / "system" / manifest
    if (package_source.is_symlink() or not package_source.is_file()
            or package_source.stat().st_size > 16 * 1024):
        raise ValueError("unverified Linux package manifest")
    manifest_bytes = package_source.read_bytes()
    if (not manifest_bytes or not manifest_bytes.endswith(b"\n")
            or any(re.fullmatch(rb"[a-z0-9][a-z0-9+._-]{0,79}", item) is None
                   for item in manifest_bytes.splitlines())):
        raise ValueError("malformed Linux-only package list")
    return [":(exclude)system/" + rel for rel in [*paths, manifest]]


if __name__ == "__main__":
    try:
        print(" ".join(linux_only_exclusions()))
    except (OSError, ValueError, KeyError, TypeError, UnicodeError) as error:
        print("Web dependency impact inconclusive: " + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
