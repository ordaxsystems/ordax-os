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
    if not isinstance(boot, list) or not isinstance(shells, list) or len(boot) != 3 or not shells:
        raise ValueError("missing canonical Linux-only source classification")
    paths = boot + shells
    if len(set(paths)) != len(paths):
        raise ValueError("duplicate Linux exclusion")
    for rel in paths:
        if (not isinstance(rel, str) or not SAFE.fullmatch(rel)
                or any(segment in ("", ".", "..") for segment in rel.split("/"))
                or (rel not in boot and not rel.endswith(".sh") and not re.fullmatch(
                    r"surface/bin/ordax-[a-z0-9-]+", rel))):
            raise ValueError("unsafe Linux exclusion")
        file = ROOT / "system" / rel
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 512 * 1024:
            raise ValueError("unverified Linux source")
        with file.open("rb") as handle:
            if handle.read(10) != b"#!/bin/sh\n":
                raise ValueError("exclusion is not a Linux shell entrypoint")
    return [":(exclude)system/" + rel for rel in paths]


if __name__ == "__main__":
    try:
        print(" ".join(linux_only_exclusions()))
    except (OSError, ValueError, KeyError, TypeError, UnicodeError) as error:
        print("Web dependency impact inconclusive: " + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
