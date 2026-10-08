#!/usr/bin/env python3
"""Repository namespace transfer audit: report unresolved live owner bindings.

This checker deliberately does not rewrite sources, authorize a repository
transfer, mutate signing roots, or treat GitHub redirects as authority.
Its only SSOT inputs are the existing ownership and migration contracts.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OWNERSHIP_PATH = Path("docs/contracts/repository-ownership.json")
STATUS_PATH = Path("docs/contracts/repository-migration-status.json")
PREVIOUS_OWNER = "washingtonmsdj"
REPOSITORY_NAME = "prototipo-ordax-os"
PLATFORM_REPOSITORY_ID = "1371063347"

ACTIVE_PREFIXES = (".github/workflows/", "bootstrap/", "system/", "tools/", "tests/")
ACTIVE_CONTRACT_PREFIX = "docs/contracts/"
ACTIVE_DOC = "docs/REPOSITORY-OWNERSHIP.md"
IGNORED_SUFFIXES = (".pack", ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".exe")
# Previously issued, pinned artifacts are provenance; rewriting their source
# owner would falsify old signing/physical authorization evidence.
IMMUTABLE_HISTORICAL_PATHS = frozenset({
    "docs/contracts/canonical-v4-signing-request.json",
    "docs/contracts/physical-write-authorization.json",
    "system/profile-content-sources/developer-core/v0.1.0/manifest.json",
})


def is_operational(path: str) -> bool:
    if path in IMMUTABLE_HISTORICAL_PATHS:
        return False
    if path == ACTIVE_DOC or path.startswith(ACTIVE_CONTRACT_PREFIX):
        return True
    return path.startswith(ACTIVE_PREFIXES) and not path.endswith(IGNORED_SUFFIXES)


def count_old_references(files: list[tuple[str, str]], old_full_name: str) -> dict:
    operational: list[str] = []
    historical: list[str] = []
    for path, contents in files:
        if old_full_name not in contents:
            continue
        (operational if is_operational(path) else historical).append(path)
    return {
        "operational_count": len(operational),
        "historical_count": len(historical),
        "operational_paths": sorted(operational),
        "historical_paths": sorted(historical),
    }


def tracked_references(root: Path, old_full_name: str) -> dict:
    # Git's binary-safe index is faster and more faithful than reading
    # every checked-out file, including large assets and Git LFS pointers.
    result = subprocess.run(
        ["git", "grep", "-l", "-z", "-I", "-F", old_full_name, "--"],
        cwd=root,
        capture_output=True,
        check=False,
        timeout=40,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError("Unable to inspect tracked repository owner references")
    paths = [name.decode("utf-8") for name in result.stdout.split(b"\x00") if name]
    operational = sorted(name for name in paths if is_operational(name))
    historical = sorted(name for name in paths if not is_operational(name))
    return {
        "operational_count": len(operational),
        "historical_count": len(historical),
        "operational_paths": operational,
        "historical_paths": historical,
    }

def validate_contracts(ownership: dict, state: dict) -> dict:
    migration = ownership["namespace_migration"]
    canonical = ownership["repositories"]
    status = state["canonical_repositories"]
    target = migration["canonical_targets"]["platform"]
    current = canonical["platform"]["repo"]
    if target != "ordaxsystems/prototipo-ordax-os":
        raise ValueError("Unexpected destination, cannot transfer the wrong repository")
    if migration["cutover_order"] != ["runtime", "apps", "control_plane", "platform"]:
        raise ValueError("Namespace transfer order no longer canonical")
    if migration["target_namespace"] != "ordaxsystems":
        raise ValueError("Target organization drifted")
    if any(migration.get(k) is not False for k in (
        "redirect_dependency_allowed", "mirror_repository_allowed",
        "dual_authority_allowed", "provenance_rewrite_allowed",
        "repository_name_changes_during_transfer",
    )):
        raise ValueError("Namespace authority policies were relaxed")
    if status["platform"] != current:
        raise ValueError("Platform owner SSOT and migration status disagree")
    for role in ("runtime", "apps", "control_plane"):
        if canonical[role]["repo"] != status[role]:
            raise ValueError(f"Other owner mismatch: {role}")
    if current == "washingtonmsdj/prototipo-ordax-os":
        if (
            migration["current_namespace"] != PREVIOUS_OWNER
            or migration["status"] != "in-progress"
            or migration["completed_transfers"] != ["runtime", "apps", "control_plane"]
        ):
            raise ValueError("Pre-transfer state has inconsistent authority")
        phase = "pre-transfer"
    elif current == target:
        if (
            migration["current_namespace"] != "ordaxsystems"
            or migration["status"] != "complete"
            or migration["completed_transfers"]
            != ["runtime", "apps", "control_plane", "platform"]
        ):
            raise ValueError("Post-transfer state has inconsistent authority")
        phase = "post-transfer"
    else:
        raise ValueError("Platform has an unrecognized owner")
    return {"phase": phase, "canonical": current, "destination": target}


def inspect(root: Path) -> dict:
    ownership = json.loads((root / OWNERSHIP_PATH).read_text(encoding="utf-8"))
    status = json.loads((root / STATUS_PATH).read_text(encoding="utf-8"))
    contract = validate_contracts(ownership, status)
    matches = tracked_references(root, f"{PREVIOUS_OWNER}/{REPOSITORY_NAME}")
    return {**contract, **matches}


def cutover_ready(report: dict, environ: dict[str, str]) -> tuple[bool, str]:
    if report["phase"] != "post-transfer":
        return False, "physical_transfer_and_ssot_cutover_not_completed"
    if report["operational_count"]:
        return False, "old_operational_owner_references_remaining"
    if environ.get("GITHUB_REPOSITORY") != report["destination"]:
        return False, "github_workflow_repository_identity_not_verified"
    if environ.get("GITHUB_REPOSITORY_ID") != PLATFORM_REPOSITORY_ID:
        return False, "github_workflow_repository_id_not_preserved"
    return True, "canonical_namespace_verified"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require-cutover", action="store_true")
    parser.add_argument("--max-paths", type=int, default=15)
    args = parser.parse_args()
    if args.max_paths < 0 or args.max_paths > 500:
        parser.error("--max-paths must be between 0 and 500")
    try:
        report = inspect(ROOT)
        ready, reason = cutover_ready(report, os.environ)
        print(json.dumps({
            "schema": "prototype-ordax.repository-transfer-preflight/1",
            "authority": "none",
            "phase": report["phase"],
            "current_repository": report["canonical"],
            "destination": report["destination"],
            "expected_repository_id": PLATFORM_REPOSITORY_ID,
            "old_operational_file_count": report["operational_count"],
            "preserved_historical_file_count": report["historical_count"],
            "old_operational_paths_sample": report["operational_paths"][:args.max_paths],
            "cutover_ready": ready,
            "reason": reason,
        }, indent=2, ensure_ascii=False))
        return 0 if not args.require_cutover or ready else 1
    except (ValueError, OSError, RuntimeError, KeyError, subprocess.SubprocessError) as error:
        print(f"REPOSITORY_TRANSFER_PREFLIGHT=FAIL: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
