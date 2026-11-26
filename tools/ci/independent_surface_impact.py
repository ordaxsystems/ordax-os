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
    # Base transport, firmware pruning, and Creator consumption do not change
    # the Surface builder's exact source/config/kernel inputs. Their own Base,
    # Creator and Portable integration gates still apply. Unknown paths stay heavy.
    ".github/workflows/dev-base-channel.yml",
    ".github/workflows/independent-base-experiment.yml",
    ".github/workflows/independent-portable-v2-integration.yml",
    "bootstrap/base/firmware_policy.py",
    "bootstrap/independent-base/post-build.sh",
    "creator/tools/owner_dev_qemu_filesystem_proof.py",
    "creator/tools/owner_dev_qemu_partition_readonly.py",
    "creator/tools/owner_dev_qemu_partition_snapshot.py",
    "creator/tools/owner_dev_usb_update_preflight.py",
    "creator/tools/owner_usb_git_delivery.py",
    "creator/tools/test_owner_usb_git_delivery.py",
    "system/services/base-update/dev_channel.py",
    "tests/test_base_update_activation_readiness.py",
    "tests/test_base_update_dev_stage.py",
    "tests/test_dev_base_channel.py",
    "tests/test_dev_base_symlink_policy.py",
    "tests/test_firmware_policy_neutral.py",
    "tests/test_independent_owner_profile.py",
    "tests/test_independent_portable_boot_integration.py",
    "tools/dev-base-channel/build.py",
    ".github/workflows/creator-owner-dev-git.yml",
    ".github/workflows/creator-ux-baseline.yml",
    "tests/test_owner_dev_offline_runtime_release_gate.py",
    "tests/test_owner_surface_cache_contract.py",
    ".github/workflows/independent-surface-runtime.yml",
    ".github/workflows/portable-v2-qemu-boot-proof.yml",
    ".github/workflows/portable-qemu-impact-contract.yml",
    "bootstrap/surface-runtime/README.md",
    "bootstrap/surface-runtime/CUTOVER-CHECKLIST.md",
    "tests/test_independent_surface_runtime.py",
    "tests/test_ci_two_stage_release_gate.py",
    "tests/test_independent_surface_qemu_binding.py",
    "tests/test_independent_surface_impact.py",
    "tests/test_independent_surface_component_cache.py",
    "tests/test_independent_surface_cutover_audit.py",
    "tests/test_independent_surface_cold_health_contract.py",
    "tests/test_independent_surface_portable_impact.py",
    "tests/test_portable_v2_qemu_boot_proof_contract.py",
    "tests/test_portable_component_reuse_workflow.py",
    "tests/test_portable_qemu_impact.py",
    "tests/test_ci_git_diff_exact_paths.py",
    "tests/test_creator_owner_impact.py",
    # Foundation's suite selector, workflow and graph contract only affect CI
    # selection; they cannot change the produced Surface EROFS bytes.
    ".github/workflows/foundation.yml",
    "docs/contracts/build-autonomy.json",
    "tests/test_build_autonomy_contract.py",
    "tests/test_foundation_impact.py",
    "tests/test_kernel_candidate_ci_scope.py",
    "tools/ci/foundation_impact.py",
    # Other impact policies only choose CI jobs; they do not change Surface EROFS bytes.
    "tools/ci/creator_owner_impact.py",
    "tools/ci/independent_surface_impact.py",
    "tools/ci/independent_surface_component_cache.py",
    "tools/ci/independent_surface_cutover_audit.py",
    "tools/ci/portable_qemu_impact.py",
    # These scripts only validate/coordinate immutable external source locks;
    # neither can alter Buildroot, EROFS contents or the Surface producer.
    ".github/workflows/external-source-lock-integration.yml",
    "tests/test_source_integration_advance.py",
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


def changed_paths_between(
    base: str,
    head: str,
    *,
    root: Path = ROOT,
    use_merge_base: bool = False,
) -> tuple[str, ...]:
    if SHA40.fullmatch(base or "") is None or SHA40.fullmatch(head or "") is None:
        raise ValueError("base/head must be exact lowercase 40-hex commits")
    if base == "0" * 40:
        raise ValueError("zero base is not classifiable")
    # Git's default quoted paths are not repository filenames; use -z and
    # UTF-8 to preserve accented names and other characters without escapes.
    command = ["git", "-C", str(root), "diff"]
    if use_merge_base:
        # Match GitHub's PR file list when the source branch is behind the
        # target branch. Commits added to the target after the PR fork are not
        # part of the PR delta and must not trigger its producer.
        command.append("--merge-base")
    command.extend(
        ["--name-only", "-z", "--no-renames", base, head, "--"]
    )
    result = subprocess.run(
        command,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
    )
    return tuple(path for path in result.stdout.decode("utf-8").split("\0") if path)


def write_output(path: Path, result: ImpactResult) -> None:
    # Filenames can contain line breaks; never let a reason inject GITHUB_OUTPUT records.
    reason = ";".join(result.reasons).replace("\r", "\\r").replace("\n", "\\n")
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"required={'true' if result.required else 'false'}\n")
        handle.write(f"reason={reason}\n")
        handle.write(f"changed_count={len(result.changed_paths)}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="")
    parser.add_argument("--head", default="")
    parser.add_argument("--merge-base", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()

    if args.force:
        result = ImpactResult(True, ("explicit-force",), tuple())
    else:
        try:
            result = classify_paths(
                changed_paths_between(
                    args.base, args.head, use_merge_base=args.merge_base
                )
            )
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
