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


def selection(root: Path) -> dict:
    historical_path = root / HISTORICAL_PATH
    original = _regular_bytes(historical_path, "historical operator request")
    # Git blob identity is a source-control integrity pin, NEVER a signature.
    blob = hashlib.sha1(b"blob " + str(len(original)).encode("ascii") + b"\0" + original).hexdigest()
    if blob != HISTORICAL_GIT_BLOB:
        raise ValidationError("historical signing-request provenance changed")
    historical, _ = _load_json(historical_path, "historical operator request")
    if historical.get("source_repository") != HISTORICAL_OWNER:
        raise ValidationError("historical signing-request owner drifted")
    if any(historical.get(field) is not False for field in UNSAFE_FIELDS):
        raise ValidationError("historical signing request claims an unsafe action")

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
    validate_request_document(request)
    if request["source_commit"] == historical["source_commit"]:
        raise ValidationError("active signing request cannot reuse historical source commit")
    for kind, original_entry in historical["operator_artifacts"].items():
        proposed = request["operator_artifacts"][kind]
        if proposed["run_id"] == original_entry["run_id"] or proposed["artifact_id"] == original_entry["artifact_id"]:
            raise ValidationError(f"active {kind} signing request reuses historical run/artifact identity")

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
        result = selection(ROOT)
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
