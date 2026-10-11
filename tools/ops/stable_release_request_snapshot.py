#!/usr/bin/env python3
"""Read-only Stable candidate/request identity comparison; never a release gate.

The existing release-operator selector remains authoritative for validating
historical provenance, canonical owner and the active request. This diagnostic
only compares that validated request to one explicitly supplied source SHA.
It performs no network, signing, artifact download, publishing or device I/O.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SELECTOR = Path("tools/release-operator/select_active_signing_request.py")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
SCHEMA = "prototype-ordax.stable-release-request-snapshot/1"


def evaluate(root: Path, source_commit: str, *, execution_repository: str = "ordaxsystems/ordax-os") -> dict:
    if HEX40.fullmatch(source_commit) is None:
        raise ValueError("expected source commit must be exactly 40 lowercase hex characters")
    if execution_repository != "ordaxsystems/ordax-os":
        # No name redirect or caller-provided repository may silently
        # classify the old signing request as a valid source of new releases.
        selection = {"status": "blocked-execution-repository-identity-mismatch", "active": False}
    else:
        selector = root / SELECTOR
        if not selector.is_file() or selector.is_symlink():
            raise ValueError("canonical request selector is unavailable")
        env = dict(os.environ, GITHUB_REPOSITORY=execution_repository)
        run = subprocess.run(
            [sys.executable, str(selector)],
            cwd=root, env=env, capture_output=True, text=True, timeout=15,
            check=False,
        )
        if run.returncode != 0:
            selection = {"status": "blocked-canonical-request-validation-failed", "active": False}
        else:
            try:
                selection = json.loads(run.stdout)
            except (ValueError, TypeError) as exc:
                raise ValueError("canonical selector produced invalid JSON") from exc
            if not isinstance(selection, dict) or not isinstance(selection.get("active"), bool):
                raise ValueError("canonical selector response invalid")

    active = selection.get("active") is True
    request_sha = selection.get("source_commit") if active else None
    if active and (not isinstance(request_sha, str) or HEX40.fullmatch(request_sha) is None):
        raise ValueError("canonical selector returned an invalid source commit")
    same = active and request_sha == source_commit
    return {
        "$schema": SCHEMA,
        "status": "exact-source-request-present" if same else (
            "source-request-differs" if active else "no-validated-request"
        ),
        "snapshot_source_commit": source_commit,
        "validated_request_source_commit": request_sha,
        "canonical_request_selector_status": selection.get("status", "blocked"),
        "canonical_request_validated_locally": active,
        "request_matches_snapshot_commit": same,
        "requested_commit_may_be_a_frozen_release_candidate": active and not same,
        "operator_artifact_bytes_checked_by_this_snapshot": False,
        "artifact_expiration_checked_by_this_snapshot": False,
        "canonical_private_key_read": False,
        "release_signed_by_this_snapshot": False,
        "release_published_by_this_snapshot": False,
        "physical_target_selected": False,
        "physical_write_authorized": False,
        "physical_write_performed": False,
        "next_action": (
            "verify-exact-request-artifacts-and-run-canonical-signing-ceremony"
            if same else (
                "confirm-frozen-candidate-or-build-new-exact-source-request"
                if active else "prepare-valid-active-operator-request"
            )
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--require-exact-source", action="store_true")
    args = parser.parse_args()
    try:
        result = evaluate(
            args.repo_root.resolve(), args.source_commit,
            execution_repository=os.environ.get("GITHUB_REPOSITORY", "ordaxsystems/ordax-os"),
        )
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"$schema": SCHEMA, "status": "blocked", "error": str(exc)}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True, indent=2))
    if args.require_exact_source and result["request_matches_snapshot_commit"] is not True:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
