#!/usr/bin/env python3
"""Emit the canonical kernel release for exact-source GitHub Actions consumers.

This script owns *only* the kernel artifact version mapping. It does not
authorize physical media and never substitutes candidate versions for
bootstrap/kernel/source.json.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
CANONICAL_SOURCE = ROOT / "bootstrap/kernel/source.json"
VERSION = re.compile(r"[0-9]+[.][0-9]+[.][0-9]+")


class KernelCIError(RuntimeError):
    pass


def canonical_version(path: Path = CANONICAL_SOURCE) -> str:
    if path.is_symlink() or not path.is_file():
        raise KernelCIError("canonical kernel source is missing or unsafe")
    try:
        source = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise KernelCIError(f"invalid canonical kernel source: {exc}") from exc
    version = source.get("version")
    if (
        source.get("$schema") != "prototype-ordax.kernel-source/1"
        or not isinstance(version, str)
        or VERSION.fullmatch(version) is None
    ):
        raise KernelCIError("invalid canonical kernel source schema or version")
    return version


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--github-env", type=Path, help="GitHub Actions GITHUB_ENV file")
    args = parser.parse_args()
    try:
        version = canonical_version()
        if args.github_env:
            if "GITHUB_ENV" not in os.environ or args.github_env != Path(os.environ["GITHUB_ENV"]):
                raise KernelCIError("GITHUB_ENV destination is not the runner-provided path")
            with args.github_env.open("a", encoding="utf-8") as stream:
                stream.write(f"ORDAX_KERNEL_VERSION={version}\n")
        print(f"ORDAX_KERNEL_VERSION={version}")
    except (KernelCIError, OSError) as exc:
        print(f"KERNEL_CI_ENV=FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
