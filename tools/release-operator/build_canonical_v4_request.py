#!/usr/bin/env python3
"""Generate one unsigned operator request from immutable GitHub Actions identities.

No signing, publishing, release activation or device access is performed.
Run IDs must be supplied explicitly: there is no "latest run" fallback.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from select_active_signing_request import ROOT, assert_new_canonical_request, load_historical_request
from validate_canonical_v4_signing_request import (
    KIND_SPECS, REPOSITORY, REQUEST_SCHEMA, UNSAFE_FIELDS, ValidationError,
    operator_ref_for_source,
)

REPOSITORY_ID = 1371063347
CUTOVER_COMMIT = "9eb4dbbe7f1898ddf517ccc58948b062ed7db391"
API = f"https://api.github.com/repos/{REPOSITORY}"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
MAX_BYTES = 2 * 1024 * 1024


def fetch_json(path: str, token: str) -> dict:
    url = API + path
    request = Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ordax-canonical-release-operator",
    })
    with urlopen(request, timeout=20) as response:
        if response.status != 200 or response.geturl() != url:
            raise ValidationError("GitHub API returned a redirect or a non-200 response")
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValidationError("GitHub metadata exceeds the maximum size")
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError("GitHub metadata is not valid JSON") from exc
    if not isinstance(data, dict):
        raise ValidationError("GitHub metadata must be an object")
    return data



def _compare_confirms_ancestry(result: dict, expected_base: str) -> bool:
    """Validate the fields GitHub REST actually returns for /compare/{base}...{head}."""
    base = result.get("base_commit")
    merged = result.get("merge_base_commit")
    return (
        result.get("status") in ("ahead", "identical")
        and type(result.get("behind_by")) is int
        and result["behind_by"] == 0
        and isinstance(base, dict) and base.get("sha") == expected_base
        and isinstance(merged, dict) and merged.get("sha") == expected_base
    )


def verify_cutover_ancestry(source_commit: str, token: str) -> None:
    """Verify exact commit existence and GitHub ancestry across the physical cutover."""
    if HEX40.fullmatch(source_commit) is None:
        raise ValidationError("source commit must be exact lowercase 40-hex")
    commit = fetch_json(f"/git/commits/{source_commit}", token)
    if commit.get("sha") != source_commit:
        raise ValidationError("canonical source commit cannot be resolved exactly")
    after_transfer = fetch_json(f"/compare/{CUTOVER_COMMIT}...{source_commit}", token)
    if not _compare_confirms_ancestry(after_transfer, CUTOVER_COMMIT):
        raise ValidationError("source commit does not descend from canonical cutover")
    still_main = fetch_json(f"/compare/{source_commit}...main", token)
    if not _compare_confirms_ancestry(still_main, source_commit):
        raise ValidationError("frozen release source is not an ancestor of current main")



def build_request(source_commit: str, runs: dict, inventories: dict, historical: dict) -> dict:
    if not isinstance(source_commit, str) or HEX40.fullmatch(source_commit) is None:
        raise ValidationError("source commit must be exact lowercase 40-hex")
    tag = "ordax-stable-v4-" + source_commit
    bindings = {}
    source_ref = None
    seen_runs, seen_artifacts = set(), set()
    for kind, spec in KIND_SPECS.items():
        run, inventory = runs[kind], inventories[kind]
        rid = run.get("id")
        if type(rid) is not int or rid <= 0 or rid in seen_runs:
            raise ValidationError(f"{kind} run ID is invalid or reused")
        seen_runs.add(rid)
        run_ref = operator_ref_for_source(source_commit, run.get("head_branch"))
        if source_ref is None:
            source_ref = run_ref
        elif source_ref != run_ref:
            raise ValidationError("operator runs must use exactly the same frozen source ref")
        repo = run.get("repository")
        if not isinstance(repo, dict) or repo.get("full_name") != REPOSITORY or repo.get("id") != REPOSITORY_ID:
            raise ValidationError(f"{kind} run repository identity is invalid")
        if (run.get("event") != "workflow_dispatch"
            or run.get("status") != "completed" or run.get("conclusion") != "success"
            or run.get("head_branch") != source_ref or run.get("head_sha") != source_commit
            or run.get("path") != spec["workflow_path"]):
            raise ValidationError(f"{kind} run is not an exact manual build from the frozen source ref")
        assets = inventory.get("artifacts")
        if not isinstance(assets, list) or inventory.get("total_count") != len(assets):
            raise ValidationError(f"{kind} artifact inventory is missing or incomplete")
        expected_name = spec["artifact_prefix"] + source_commit
        found = [a for a in assets if isinstance(a, dict) and a.get("name") == expected_name]
        if len(found) != 1:
            raise ValidationError(f"{kind} must have exactly one matching operator artifact")
        asset = found[0]
        aid, bound = asset.get("id"), asset.get("workflow_run")
        if type(aid) is not int or aid <= 0 or aid in seen_artifacts:
            raise ValidationError(f"{kind} artifact ID is invalid or reused")
        seen_artifacts.add(aid)
        if (asset.get("expired") is not False or not isinstance(asset.get("digest"), str)
            or DIGEST.fullmatch(asset["digest"]) is None
            or not isinstance(bound, dict) or bound.get("id") != rid
            or bound.get("repository_id") != REPOSITORY_ID
            or bound.get("head_repository_id") != REPOSITORY_ID
            or bound.get("head_branch") != source_ref or bound.get("head_sha") != source_commit):
            raise ValidationError(f"{kind} artifact binding, digest or expiry is invalid")
        bindings[kind] = {
            "workflow_path": spec["workflow_path"],
            "run_id": rid,
            "artifact_id": aid,
            "artifact_name": expected_name,
        }
    prefix = f"https://github.com/{REPOSITORY}/releases/download/{tag}/"
    request = {
        "$schema": REQUEST_SCHEMA,
        "status": "pending-public-assembly",
        "source_repository": REPOSITORY,
        "source_commit": source_commit,
        "operator_ref": source_ref,
        "release_tag": tag,
        "operator_artifacts": bindings,
        "artifact_urls": {name: prefix + name for name in (
            "system.erofs", "native-surface-runtime.erofs", "local-ai-runtime.erofs")},
        **{field: False for field in UNSAFE_FIELDS},
    }
    assert_new_canonical_request(request, historical)
    return request


def verify_frozen_candidate_ref(source_commit: str, source_ref: str, token: str) -> None:
    """Verify immutable candidate ref still points to the exact proven commit."""
    if source_ref == "main":
        return  # Ancestor-of-main proof intentionally permits main to advance.
    operator_ref_for_source(source_commit, source_ref)
    meta = fetch_json(f"/git/ref/heads/{source_ref}", token)
    obj = meta.get("object")
    if (
        meta.get("ref") != f"refs/heads/{source_ref}"
        or not isinstance(obj, dict)
        or obj.get("type") != "commit"
        or obj.get("sha") != source_commit
    ):
        raise ValidationError("frozen candidate ref no longer points to the exact source commit")


def write_once(path: Path, request: dict) -> None:
    if not path.parent.is_dir() or path.parent.is_symlink():
        raise ValidationError("output directory must be an existing real directory")
    data = (json.dumps(request, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags, 0o600)
    except OSError as exc:
        raise ValidationError("refusing to overwrite an existing signing request") from exc
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--system-run", type=int, required=True)
    parser.add_argument("--surface-run", type=int, required=True)
    parser.add_argument("--local-ai-run", type=int, required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        if not token:
            raise ValidationError("GitHub metadata requires a read-only Actions token")
        repo = fetch_json("", token)
        if (repo.get("full_name") != REPOSITORY or repo.get("id") != REPOSITORY_ID
            or repo.get("default_branch") != "main" or repo.get("archived") is not False):
            raise ValidationError("GitHub canonical repository identity is invalid")
        verify_cutover_ancestry(args.source_commit, token)
        ids = {"system": args.system_run, "surface": args.surface_run, "local-ai": args.local_ai_run}
        runs, inventories = {}, {}
        for kind, rid in ids.items():
            if rid <= 0:
                raise ValidationError(f"{kind} run ID must be positive")
            runs[kind] = fetch_json(f"/actions/runs/{rid}", token)
            inventories[kind] = fetch_json(f"/actions/runs/{rid}/artifacts?per_page=100", token)
        request = build_request(args.source_commit, runs, inventories, load_historical_request(ROOT))
        verify_frozen_candidate_ref(args.source_commit, request["operator_ref"], token)
        write_once(args.out, request)
        print(json.dumps({"status": "unsigned-request-drafted", "source_commit": args.source_commit,
                          "output": str(args.out), "signing_performed": False,
                          "publication_performed": False}, sort_keys=True))
        return 0
    except (ValidationError, HTTPError, URLError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({"status": "blocked", "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
