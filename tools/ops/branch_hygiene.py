#!/usr/bin/env python3
"""Plan and apply safe repository branch cleanup through the GitHub CLI.

The cleanup is intentionally single-process so the merged, closed-unmerged and
fully-contained rules cannot race each other. Every destructive delete is
revalidated against the branch SHA observed during planning.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import re
import subprocess
import sys
import urllib.parse
from collections.abc import Callable, Iterable
from typing import Any

PROTECTED_BRANCHES = frozenset({"main", "ordax-rescue"})
# The release operator binds three immutable workflow receipts to this exact
# ref until the canonical request is reviewed. The ordinary "contained in
# main" cleanup must not invalidate the operator's cryptographic provenance.
# This is retention only, never release/signing/physical-write authority.
FROZEN_CANDIDATE_REF = re.compile(r"release-candidate/[0-9a-f]{40}\Z")


def is_protected_ref(ref: str, source_sha: str | None = None) -> bool:
    if ref in PROTECTED_BRANCHES:
        return True
    # A similarly named branch pointing at other bytes is not a frozen
    # operator candidate and remains eligible for normal cleanup.
    return (
        isinstance(source_sha, str)
        and FROZEN_CANDIDATE_REF.fullmatch(ref) is not None
        and ref == f"release-candidate/{source_sha}"
    )



@dataclass(frozen=True)
class DeleteCandidate:
    ref: str
    expected_sha: str
    reason: str


def _same_repo_head(pr: dict[str, Any], repository: str) -> bool:
    head = pr.get("head") or {}
    head_repo = head.get("repo") or {}
    return head_repo.get("full_name") == repository and bool(head.get("ref"))


def _latest_pr_by_ref(
    prs: Iterable[dict[str, Any]],
    repository: str,
    *,
    merged: bool,
) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for pr in prs:
        if not _same_repo_head(pr, repository):
            continue
        if bool(pr.get("merged_at")) is not merged:
            continue
        ref = pr["head"]["ref"]
        timestamp = (
            pr.get("merged_at")
            if merged
            else pr.get("closed_at") or pr.get("updated_at") or ""
        )
        current = latest.get(ref)
        current_timestamp = ""
        if current is not None:
            current_timestamp = (
                current.get("merged_at")
                if merged
                else current.get("closed_at") or current.get("updated_at") or ""
            ) or ""
        if current is None or (timestamp or "") > current_timestamp:
            latest[ref] = pr
    return latest


def plan_deletions(
    repository: str,
    open_prs: list[dict[str, Any]],
    closed_prs: list[dict[str, Any]],
    branches: list[dict[str, Any]],
    compare_ahead_by: Callable[[str, str], int],
) -> list[DeleteCandidate]:
    """Return each deletable branch at most once, in deterministic order."""

    open_heads = {
        pr["head"]["ref"]
        for pr in open_prs
        if _same_repo_head(pr, repository)
    }
    current = {
        branch["name"]: branch["commit"]["sha"]
        for branch in branches
        if branch.get("name") and (branch.get("commit") or {}).get("sha")
    }
    preserve = {ref for ref in current if is_protected_ref(ref, current[ref])} | open_heads
    selected: dict[str, DeleteCandidate] = {}

    latest_merged = _latest_pr_by_ref(closed_prs, repository, merged=True)
    for ref, pr in sorted(latest_merged.items()):
        if ref in preserve or ref not in current:
            continue
        expected_sha = pr["head"]["sha"]
        if current[ref] == expected_sha:
            selected[ref] = DeleteCandidate(ref, expected_sha, "merged-head-unchanged")

    latest_unmerged = _latest_pr_by_ref(closed_prs, repository, merged=False)
    for ref, pr in sorted(latest_unmerged.items()):
        if ref in preserve or ref not in current or ref in selected:
            continue
        expected_sha = pr["head"]["sha"]
        if current[ref] == expected_sha:
            selected[ref] = DeleteCandidate(ref, expected_sha, "closed-unmerged-head-unchanged")

    for ref, expected_sha in sorted(current.items()):
        if ref in preserve or ref in selected:
            continue
        if compare_ahead_by(ref, expected_sha) == 0:
            selected[ref] = DeleteCandidate(ref, expected_sha, "fully-contained-in-main")

    return [selected[ref] for ref in sorted(selected)]


class GitHubApi:
    def __init__(self, repository: str):
        self.repository = repository

    def _run(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["gh", "api", *args],
            check=False,
            capture_output=True,
            text=True,
        )

    @staticmethod
    def _raise(result: subprocess.CompletedProcess[str], operation: str) -> None:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown gh api failure"
        raise RuntimeError(f"{operation} failed: {detail}")

    def list_paginated(self, endpoint: str) -> list[dict[str, Any]]:
        result = self._run("--paginate", "--slurp", endpoint)
        if result.returncode != 0:
            self._raise(result, f"list {endpoint}")
        pages = json.loads(result.stdout)
        return [item for page in pages for item in page]

    def get_branch_sha(self, ref: str) -> str | None:
        encoded = urllib.parse.quote(ref, safe="")
        result = self._run(f"repos/{self.repository}/branches/{encoded}", "--jq", ".commit.sha")
        if result.returncode == 0:
            value = result.stdout.strip()
            if not value:
                raise RuntimeError(f"branch lookup returned an empty SHA: {ref}")
            return value
        if "HTTP 404" in result.stderr:
            return None
        self._raise(result, f"read branch {ref}")
        raise AssertionError("unreachable")

    def compare_ahead_by(self, ref: str, expected_sha: str) -> int:
        # Compare the immutable snapshot SHA, not the branch name. This avoids
        # ref-path escaping ambiguity and keeps the containment decision bound
        # to the exact value that will later be revalidated before deletion.
        result = self._run(
            f"repos/{self.repository}/compare/main...{expected_sha}",
            "--jq",
            ".ahead_by",
        )
        if result.returncode != 0:
            self._raise(result, f"compare main...{ref}@{expected_sha}")
        try:
            return int(result.stdout.strip())
        except ValueError as error:
            raise RuntimeError(
                f"compare main...{ref}@{expected_sha} returned an invalid ahead_by"
            ) from error

    def delete_branch(self, ref: str) -> bool:
        encoded_ref = urllib.parse.quote(f"heads/{ref}", safe="")
        result = self._run("--method", "DELETE", f"repos/{self.repository}/git/refs/{encoded_ref}")
        if result.returncode == 0:
            return True
        # An external actor may remove the exact ref after our immediate
        # revalidation. That is the one idempotent delete race we accept.
        if "Reference does not exist" in result.stderr:
            return False
        self._raise(result, f"delete branch {ref}")
        raise AssertionError("unreachable")


def apply_candidates(api: GitHubApi, candidates: Iterable[DeleteCandidate]) -> dict[str, int]:
    summary = {"deleted": 0, "already_absent": 0, "changed": 0}
    for candidate in candidates:
        current_sha = api.get_branch_sha(candidate.ref)
        if current_sha is None:
            print(f"Already absent: {candidate.ref}")
            summary["already_absent"] += 1
            continue
        if current_sha != candidate.expected_sha:
            print(
                f"Preserving {candidate.ref}: changed after planning "
                f"({candidate.expected_sha} -> {current_sha})"
            )
            summary["changed"] += 1
            continue
        deleted = api.delete_branch(candidate.ref)
        if deleted:
            print(f"Deleted {candidate.ref}: {candidate.reason}")
            summary["deleted"] += 1
        else:
            print(f"Already absent at delete boundary: {candidate.ref}")
            summary["already_absent"] += 1
    return summary


def prune(repository: str) -> int:
    api = GitHubApi(repository)
    open_prs = api.list_paginated(f"repos/{repository}/pulls?state=open&per_page=100")
    closed_prs = api.list_paginated(f"repos/{repository}/pulls?state=closed&per_page=100")
    branches = api.list_paginated(f"repos/{repository}/branches?per_page=100")
    candidates = plan_deletions(
        repository,
        open_prs,
        closed_prs,
        branches,
        api.compare_ahead_by,
    )
    print(f"Branch cleanup candidates: {len(candidates)}")
    summary = apply_candidates(api, candidates)
    print(json.dumps(summary, sort_keys=True))
    return 0


def delete_merged_head(repository: str, head_ref: str, merged_head_sha: str) -> int:
    if is_protected_ref(head_ref, merged_head_sha):
        print(f"Preserving protected project branch: {head_ref}")
        return 0
    api = GitHubApi(repository)
    current_sha = api.get_branch_sha(head_ref)
    if current_sha is None:
        print(f"Branch already absent: {head_ref}")
        return 0
    if current_sha != merged_head_sha:
        print(f"Preserving {head_ref}: branch changed after merged PR")
        return 0
    deleted = api.delete_branch(head_ref)
    if deleted:
        print(f"Deleted merged branch: {head_ref}")
    else:
        print(f"Branch already absent at delete boundary: {head_ref}")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    prune_parser = subparsers.add_parser("prune")
    prune_parser.add_argument("--repository", required=True)

    merged_parser = subparsers.add_parser("delete-merged-head")
    merged_parser.add_argument("--repository", required=True)
    merged_parser.add_argument("--head-ref", required=True)
    merged_parser.add_argument("--merged-head-sha", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.command == "prune":
        return prune(args.repository)
    if args.command == "delete-merged-head":
        return delete_merged_head(args.repository, args.head_ref, args.merged_head_sha)
    raise AssertionError(f"unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
