#!/usr/bin/env python3
"""Read-only live-artifact admission before unsigned canonical v4 assembly.

Rebuild the request from the exact GitHub metadata using the *existing*
canonical builder; never trust syntactically valid but expired artifact IDs.
No artifact downloads, signatures, releases, device writes or activation.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError

from build_canonical_v4_request import (
    build_request,
    fetch_json,
)
from select_active_signing_request import (
    ACTIVE_PATH,
    ROOT,
    REPOSITORY,
    ValidationError,
    load_historical_request,
    selection,
)


def live_request_matches(root: Path, request: dict, token: str, *, fetch=fetch_json) -> bool:
    """Use builder's single metadata authority for all three operator kinds."""
    runs, inventories = {}, {}
    for kind, binding in request["operator_artifacts"].items():
        run_id = binding["run_id"]
        runs[kind] = fetch(f"/actions/runs/{run_id}", token)
        inventories[kind] = fetch(f"/actions/runs/{run_id}/artifacts?per_page=100", token)
    live = build_request(request["source_commit"], runs, inventories, load_historical_request(root))
    return live == request


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args(argv)

    def report(active: bool, reason: str) -> int:
        if args.github_output:
            with args.github_output.open("a", encoding="utf-8") as stream:
                stream.write("active=" + str(active).lower() + "\n")
        print(json.dumps({
            "status": "live-artifacts-verified" if active else "blocked",
            "active": active, "reason": reason,
            "signing_performed": False, "publication_performed": False,
            "physical_write_performed": False,
        }, sort_keys=True))
        return 0

    token = os.environ.get("GH_TOKEN")
    if not token or os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
        print("LIVE_OPERATOR_PREFLIGHT=FAIL reason=missing-canonical-readonly-GitHub-context", file=sys.stderr)
        return 2
    try:
        state = selection(ROOT, execution_repository=REPOSITORY)
        if not state["active"]:
            return report(False, "no-active-request")
        request = json.loads((ROOT / ACTIVE_PATH).read_text(encoding="utf-8"))
        try:
            if not live_request_matches(ROOT, request, token):
                return report(False, "operator-artifact-identity-drift")
        except ValidationError:
            return report(False, "operator-artifacts-expired-or-inconsistent")
        return report(True, "exact-three-operator-artifacts-live")
    except (HTTPError, URLError, OSError, ValueError, KeyError, ValidationError) as exc:
        # A network/auth outage must not be mistaken for a normal expired
        # payload. Fail CI; never initiate signing/assembly on uncertain data.
        print("LIVE_OPERATOR_PREFLIGHT=FAIL reason=" + type(exc).__name__, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
