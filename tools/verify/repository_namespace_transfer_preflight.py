#!/usr/bin/env python3
"""Repository namespace transfer audit: report unresolved live owner bindings.

This checker deliberately does not rewrite sources, authorize a repository
transfer, mutate signing roots, or treat GitHub redirects as authority.
Its only SSOT inputs are the existing ownership and migration contracts.
"""
from __future__ import annotations

import argparse
import hashlib
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
# Existing owner remains authoritative until the exact physical rename is verified.
# Both names are allowed as *values* of the single ownership SSOT, never in parallel.
POST_TRANSFER_SLUGS = frozenset({
    "ordaxsystems/prototipo-ordax-os",
    "ordaxsystems/ordax-os",
})

ACTIVE_PREFIXES = (".github/workflows/", "boot/", "bootstrap/", "sdk/", "system/", "tools/", "tests/")
ACTIVE_CONTRACT_PREFIX = "docs/contracts/"
ACTIVE_DOCS = frozenset({"docs/REPOSITORY-OWNERSHIP.md", "docs/RELEASE-CHANNEL.md"})
IGNORED_SUFFIXES = (".pack", ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".exe")
# Previously issued, pinned artifacts are provenance; rewriting their source
# owner would falsify old signing/physical authorization evidence.
IMMUTABLE_HISTORICAL_PATHS = frozenset({
    "docs/contracts/canonical-v4-signing-request.json",
    "docs/contracts/physical-write-authorization.json",
    "system/profile-content-sources/developer-core/v0.1.0/manifest.json",
})


NEGATIVE_AUTHORITY_FIXTURES = frozenset({
    "tools/verify/repository_namespace_transfer_preflight.py",
    "tests/test_repository_namespace_transfer_preflight.py",
})

def is_operational(path: str) -> bool:
    if path in IMMUTABLE_HISTORICAL_PATHS or path in NEGATIVE_AUTHORITY_FIXTURES:
        return False
    if path in ACTIVE_DOCS or path.startswith(ACTIVE_CONTRACT_PREFIX):
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


# These are historical *negative* assertions, not an executable authority.
# Each exemption is valid only while the whole old-owner reference matches
# exactly the documented assertion. Any extra old-owner use fails closed.
NEGATIVE_HISTORICAL_ASSERTIONS = {
    "tests/test_canonical_v4_signing_request.py":
        'self.assertEqual(request["source_repository"], "washingtonmsdj/prototipo-ordax-os")',
    "tests/test_release_agent_seed_restore_identity.py":
        'self.assertNotIn("washingtonmsdj/prototipo-ordax-os", script)',
    # Exact historical negative assertions are not an operational owner fallback.
    "tools/release-operator/select_active_signing_request.py":
        'HISTORICAL_OWNER = "washingtonmsdj/prototipo-ordax-os"',
    "tests/test_build_canonical_v4_request.py":
        '{"repository": {"full_name": "washingtonmsdj/prototipo-ordax-os", "id": builder.REPOSITORY_ID}},',
}


def verified_negative_historical_assertion(root: Path, name: str, old: str) -> bool:
    expected = NEGATIVE_HISTORICAL_ASSERTIONS.get(name)
    if expected is None:
        return False
    try:
        lines = (root / name).read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return False
    actual = [line.strip() for line in lines if old in line]
    return actual == [expected]


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
    operational = []
    historical = []
    for name in paths:
        if is_operational(name) and not verified_negative_historical_assertion(
            root, name, old_full_name
        ):
            operational.append(name)
        else:
            historical.append(name)
    operational.sort()
    historical.sort()
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
    if target not in POST_TRANSFER_SLUGS:
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



def release_pointer_integrity(root: Path, owner: str) -> dict:
    """Prove the discovery pointer bytes remain covered by bootstrap authority."""
    release = json.loads(
        (root / "docs/contracts/release-channel.json").read_text(encoding="utf-8")
    )
    bootstrap = json.loads(
        (root / "docs/contracts/minimal-bootstrap.json").read_text(encoding="utf-8")
    )
    expected_url = (
        f"https://github.com/{owner}/releases/latest/download/release-envelope.json"
    )
    data = (root / "bootstrap/config/release-envelope-url").read_bytes()
    source = release["source_authority"]["repository"]
    publication = release["publication"]["latest_envelope_url"]
    group = next(
        (item for item in bootstrap["artifact_groups"]
         if item.get("id") == "bootstrap-release-channel"),
        None,
    )
    if group is None or len(group.get("artifacts", [])) != 1:
        raise ValueError("bootstrap release channel binding is missing or ambiguous")
    artifact = group["artifacts"][0]
    digest = hashlib.sha256(data).hexdigest()
    expected_digest = artifact["sha256"]
    paths_match = (
        artifact["source_path"] == "bootstrap/config/release-envelope-url"
        and artifact["target_path"] == "/ordax/bootstrap/config/release-envelope-url"
    )
    reason = (
        "canonical_release_pointer_verified"
        if (
            source == owner
            and publication == expected_url
            and data == (expected_url + "\n").encode("utf-8")
            and digest == expected_digest
            and paths_match
        )
        else "release_pointer_identity_or_bootstrap_digest_mismatch"
    )
    return {
        "release_pointer_integrity_verified": reason == "canonical_release_pointer_verified",
        "release_pointer_integrity_reason": reason,
        "release_pointer_sha256": digest,
        "bootstrap_pinned_sha256": expected_digest,
    }


def sdk_package_projection_integrity(root: Path) -> dict:
    """The SDK public view must be identical to the canonical package policy."""
    source = (root / "docs/contracts/runtime-component-package.json").read_bytes()
    snapshot = (root / "sdk/app-sdk-v1/runtime-component-package-policy.json").read_bytes()
    if not source or not snapshot:
        raise ValueError("runtime component source policy and SDK snapshot must not be empty")
    return {
        "sdk_package_projection_verified": source == snapshot,
        "sdk_package_source_sha256": hashlib.sha256(source).hexdigest(),
        "sdk_package_snapshot_sha256": hashlib.sha256(snapshot).hexdigest(),
    }


def inspect(root: Path) -> dict:
    ownership = json.loads((root / OWNERSHIP_PATH).read_text(encoding="utf-8"))
    status = json.loads((root / STATUS_PATH).read_text(encoding="utf-8"))
    contract = validate_contracts(ownership, status)
    matches = tracked_references(root, f"{PREVIOUS_OWNER}/{REPOSITORY_NAME}")
    # The first namespace cutover is complete. On the final repository rename,
    # the intermediate slug must stop being an operational authority too.
    retired_slug = (
        tracked_references(root, "ordaxsystems/prototipo-ordax-os")
        if contract["destination"] == "ordaxsystems/ordax-os"
        else {"operational_count": 0, "historical_count": 0,
              "operational_paths": [], "historical_paths": []}
    )
    pointer = release_pointer_integrity(root, contract["canonical"])
    snapshot = sdk_package_projection_integrity(root)
    return {
        **contract, **matches, **pointer, **snapshot,
        "retired_slug_operational_count": retired_slug["operational_count"],
        "retired_slug_operational_paths": retired_slug["operational_paths"],
        "retired_slug_historical_count": retired_slug["historical_count"],
    }


def cutover_ready(report: dict, environ: dict[str, str]) -> tuple[bool, str]:
    if report["phase"] != "post-transfer":
        return False, "physical_transfer_and_ssot_cutover_not_completed"
    if report["operational_count"]:
        return False, "old_operational_owner_references_remaining"
    if report["destination"] == "ordaxsystems/ordax-os":
        count = report.get("retired_slug_operational_count")
        if type(count) is not int or count < 0:
            return False, "retired_slug_audit_not_proven"
        if count:
            return False, "intermediate_repository_slug_still_operational"
    if report.get("release_pointer_integrity_verified") is not True:
        return False, "release_pointer_identity_or_bootstrap_digest_mismatch"
    if report.get("sdk_package_projection_verified") is not True:
        return False, "sdk_package_policy_projection_drift"
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
            "retired_slug_operational_file_count": report["retired_slug_operational_count"],
            "retired_slug_historical_file_count": report["retired_slug_historical_count"],
            "retired_slug_operational_paths_sample": report["retired_slug_operational_paths"][:args.max_paths],
            "release_pointer_integrity_verified": report["release_pointer_integrity_verified"],
            "release_pointer_sha256": report["release_pointer_sha256"],
            "bootstrap_pinned_sha256": report["bootstrap_pinned_sha256"],
            "sdk_package_projection_verified": report["sdk_package_projection_verified"],
            "sdk_package_source_sha256": report["sdk_package_source_sha256"],
            "sdk_package_snapshot_sha256": report["sdk_package_snapshot_sha256"],
            "cutover_ready": ready,
            "reason": reason,
        }, indent=2, ensure_ascii=False))
        return 0 if not args.require_cutover or ready else 1
    except (ValueError, OSError, RuntimeError, KeyError, subprocess.SubprocessError) as error:
        print(f"REPOSITORY_TRANSFER_PREFLIGHT=FAIL: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
