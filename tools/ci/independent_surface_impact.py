#!/usr/bin/env python3
"""Classify whether a delta can change Independent Surface EROFS bytes.

The policy is intentionally small and fail-closed. Only known contract/test/docs/CI
changes are lightweight. Buildroot source/config/builder/kernel SSOT changes are
heavy because they can alter the generated graphical runtime.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import re
import subprocess
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
SHA40 = re.compile(r"^[0-9a-f]{40}$")

HEAVY_EXACT = {
    "bootstrap/surface-runtime/build.py",
    "bootstrap/surface-runtime/prepare_config.py",
    "bootstrap/surface-runtime/source.json",
    "bootstrap/independent-base/source.json",
    "bootstrap/kernel/source.json",
}
HEAVY_PREFIXES = (
    "bootstrap/surface-runtime/configs/",
)
LIGHT_EXACT = {
    ".github/workflows/independent-surface-runtime.yml",
    ".github/workflows/portable-v2-qemu-boot-proof.yml",
    ".github/workflows/portable-qemu-impact-contract.yml",
    "bootstrap/surface-runtime/README.md",
    "bootstrap/surface-runtime/CUTOVER-CHECKLIST.md",
    "tests/test_independent_surface_runtime.py",
    "tests/test_independent_surface_qemu_binding.py",
    "tests/test_independent_surface_impact.py",
    "tests/test_independent_surface_component_cache.py",
    "tests/test_independent_surface_cutover_audit.py",
    "tests/test_independent_surface_cold_health_contract.py",
    "tests/test_independent_surface_portable_impact.py",
    "tests/test_portable_v2_qemu_boot_proof_contract.py",
    "tests/test_portable_component_reuse_workflow.py",
    "tests/test_portable_qemu_impact.py",
    "tools/ci/independent_surface_impact.py",
    "tools/ci/independent_surface_component_cache.py",
    "tools/ci/independent_surface_cutover_audit.py",
    "tools/ci/portable_qemu_impact.py",
    "docs/contracts/ci-supply-chain.json",
}


@dataclass(frozen=True)
class ImpactResult:
    required: bool
    reasons: tuple[str, ...]
    changed_paths: tuple[str, ...]


def normalize(value: str) -> str:
    value = value.strip().replace("\\", "/")
    while value.startswith("./"):
        value = value[2:]
    return value


def classify_paths(paths: Iterable[str]) -> ImpactResult:
    changed = tuple(sorted({path for raw in paths if (path := normalize(raw))}))
    if not changed:
        return ImpactResult(False, ("no-changes",), changed)

    reasons: list[str] = []
    for path in changed:
        if path in HEAVY_EXACT:
            reasons.append(f"surface-byte-owner:{path}")
            continue
        if path.startswith(HEAVY_PREFIXES):
            reasons.append(f"surface-config:{path}")
            continue
        if path in LIGHT_EXACT or path.endswith(".md"):
            continue
        reasons.append(f"unclassified:{path}")

    return ImpactResult(bool(reasons), tuple(reasons) or ("contract-only",), changed)


def changed_paths_between(base: str, head: str, *, root: Path = ROOT) -> tuple[str, ...]:
    if SHA40.fullmatch(base or "") is None or SHA40.fullmatch(head or "") is None:
        raise ValueError("base/head must be exact lowercase 40-hex commits")
    if base == "0" * 40:
        raise ValueError("zero base is not classifiable")
    result = subprocess.run(
        ["git", "-C", str(root), "diff", "--name-only", "--no-renames", base, head, "--"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return tuple(line.strip() for line in result.stdout.splitlines() if line.strip())


def write_output(path: Path, result: ImpactResult) -> None:
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"required={'true' if result.required else 'false'}\n")
        handle.write(f"reason={';'.join(result.reasons)}\n")
        handle.write(f"changed_count={len(result.changed_paths)}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="")
    parser.add_argument("--head", default="")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()

    if args.force:
        result = ImpactResult(True, ("explicit-force",), tuple())
    else:
        try:
            result = classify_paths(changed_paths_between(args.base, args.head))
        except Exception as exc:
            result = ImpactResult(True, (f"classification-failed:{type(exc).__name__}",), tuple())

    print(
        f"INDEPENDENT_SURFACE_BUILD_REQUIRED={'YES' if result.required else 'NO'} "
        f"reason={';'.join(result.reasons)} changed={len(result.changed_paths)}"
    )
    if args.github_output:
        write_output(args.github_output, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
