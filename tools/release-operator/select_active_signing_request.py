#!/usr/bin/env python3
"""Choose a new canonical unsigned request without rewriting the historical request.

This is an eligibility classification, NOT signature, release, or physical
authorization. A missing active request is explicitly blocked but does not
cause the historical request to be interpreted as the active request.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

from validate_canonical_v4_signing_request import (
    REPOSITORY,
    UNSAFE_FIELDS,
    ValidationError,
    _load_json,
    _regular_bytes,
    validate_request_document,
)

ROOT = Path(__file__).resolve().parents[2]
HISTORICAL_PATH = Path("docs/contracts/canonical-v4-signing-request.json")
ACTIVE_PATH = Path("docs/contracts/canonical-v4-signing-request-active.json")
HISTORICAL_GIT_BLOB = "be7e9afe1ff26416ead79cf8ff7bcf4bc8294370"
HISTORICAL_OWNER = "washingtonmsdj/prototipo-ordax-os"


def load_historical_request(root: Path) -> dict:
    """Preserve the original source-controlled request as non-authorizing evidence."""
    original = _regular_bytes(root / HISTORICAL_PATH, "historical operator request")
    blob = hashlib.sha1(b"blob " + str(len(original)).encode("ascii") + b"\0" + original).hexdigest()
    if blob != HISTORICAL_GIT_BLOB:
        raise ValidationError("historical signing-request provenance changed")
    historical, _ = _load_json(root / HISTORICAL_PATH, "historical operator request")
    if historical.get("source_repository") != HISTORICAL_OWNER:
        raise ValidationError("historical signing-request owner drifted")
    if any(historical.get(field) is not False for field in UNSAFE_FIELDS):
        raise ValidationError("historical signing request claims an unsafe action")
    return historical


def assert_new_canonical_request(request: dict, historical: dict) -> None:
    """Single source of truth for owner, historical and cross-kind identity checks."""
    validate_request_document(request)
    if request["source_commit"] == historical["source_commit"]:
        raise ValidationError("active signing request cannot reuse historical source commit")
    run_ids, artifact_ids = set(), set()
    for kind, old in historical["operator_artifacts"].items():
        entry = request["operator_artifacts"][kind]
        if entry["run_id"] == old["run_id"] or entry["artifact_id"] == old["artifact_id"]:
            raise ValidationError(f"active {kind} signing request reuses historical run/artifact identity")
        if entry["run_id"] in run_ids or entry["artifact_id"] in artifact_ids:
            raise ValidationError("operator run/artifact identities must be distinct between kinds")
        run_ids.add(entry["run_id"])
        artifact_ids.add(entry["artifact_id"])



def selection(root: Path, *, execution_repository: str | None = None) -> dict:
    historical = load_historical_request(root)

    # GitHub Actions supplies its actual owner/name independently of the
    # source's release identity. During a repository rename a stale source
    # request must never trigger assembly through GitHub URL redirects.
    if execution_repository is not None and execution_repository != REPOSITORY:
        return {
            "status": "blocked-execution-repository-identity-mismatch",
            "active": False,
            "historical_request_preserved": True,
            "source_repository": REPOSITORY,
            "execution_repository": execution_repository,
            "signing_performed": False,
            "publication_performed": False,
        }

    active = root / ACTIVE_PATH
    if not active.exists():
        if active.is_symlink():
            raise ValidationError("dangling active signing-request symlink")
        return {
            "status": "blocked-no-canonical-operator-request",
            "active": False,
            "historical_request_preserved": True,
            "signing_performed": False,
            "publication_performed": False,
        }
    request, _ = _load_json(active, "active canonical signing request")
    assert_new_canonical_request(request, historical)

    return {
        "status": "eligible-for-unsigned-assembly",
        "active": True,
        "source_repository": REPOSITORY,
        "source_commit": request["source_commit"],
        "historical_request_preserved": True,
        "signing_performed": False,
        "publication_performed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--github-output", type=Path, help="Append only active=true|false for this workflow")
    parser.add_argument("--require-active", action="store_true")
    args = parser.parse_args()
    try:
        # In the Actions workflow this identity is supplied by GitHub, not
        # by the JSON request. Missing identity also fails closed.
        execution_repository = os.environ.get("GITHUB_REPOSITORY")
        if not execution_repository:
            raise ValidationError("GitHub execution repository identity is unavailable")
        result = selection(ROOT, execution_repository=execution_repository)
        if args.require_active and not result["active"]:
            raise ValidationError("canonical signing request has not been supplied")
        if args.github_output:
            with args.github_output.open("a", encoding="utf-8") as out:
                out.write("active=" + str(result["active"]).lower() + "\n")
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValidationError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({"status": "blocked", "error": str(exc), "active": False}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
