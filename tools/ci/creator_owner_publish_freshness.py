#!/usr/bin/env python3
"""Fail-closed freshness fence for the mutable Owner/Development Creator USB release.

The OS source commit is immutable. A build may replace the rolling Creator
asset only while the official main branch contains no newer USB producer
changes. This does not replace physical boot/build/health proof.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess

if __package__:
    from .creator_owner_impact import classify
else:
    from creator_owner_impact import classify

ROOT = Path(__file__).resolve().parents[2]
OFFICIAL_REMOTE = frozenset({
    "https://github.com/ordaxsystems/ordax-os",
    "https://github.com/ordaxsystems/ordax-os.git",
})
SHA = re.compile(r"[0-9a-f]{40}\Z")
MAIN = "refs/heads/main"
# Enough to retain ordinary queued main ancestry without fetching every blob.
# If main moves farther or is rewritten, fail closed rather than guess.
MAIN_FETCH_DEPTH = 128


def _git(root: Path, *args: str, timeout: int = 35) -> str:
    completed = subprocess.run(
        ["git", "-C", str(root), *args],
        check=True, capture_output=True, text=True, timeout=timeout,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )
    return completed.stdout.strip()


def freshness_decision(source: str, latest: str, *, root: Path = ROOT) -> tuple[bool, str]:
    """Pure Git decision: newer docs-only main is allowed; newer USB bytes are not."""
    if not SHA.fullmatch(source or "") or not SHA.fullmatch(latest or ""):
        raise ValueError("invalid source/latest SHA")
    if source == latest:
        return True, "current-main"
    try:
        subprocess.run(
            ["git", "-C", str(root), "merge-base", "--is-ancestor", source, latest],
            check=True, capture_output=True, text=True, timeout=20,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise ValueError("main ancestry missing or history rewritten") from exc
    needs_usb, reason = classify(source, latest, root=root, event="push")
    if needs_usb:
        return False, "superseded-usb-producer:" + reason
    return True, "newer-main-nonproducer-only"


def check_official_main(source: str, *, root: Path = ROOT) -> tuple[bool, str, str]:
    if not SHA.fullmatch(source or ""):
        raise ValueError("invalid candidate source SHA")
    if _git(root, "rev-parse", "HEAD") != source:
        raise ValueError("running checkout is not the exact Creator source")
    if _git(root, "remote", "get-url", "origin") not in OFFICIAL_REMOTE:
        raise ValueError("untrusted Owner OS origin")
    response = _git(root, "ls-remote", "--exit-code", "origin", MAIN)
    fields = response.split()
    if len(fields) != 2 or fields[1] != MAIN or not SHA.fullmatch(fields[0]):
        raise ValueError("official main discovery is missing or malformed")
    latest = fields[0]
    if source != latest:
        # Fetch exactly the observed revision, not a moving branch alias.
        # Git's object model and the ancestry check reject shallow/rewritten
        # histories; missing objects cannot silently permit publication.
        _git(root, "fetch", "--no-tags", "--filter=blob:none",
             f"--depth={MAIN_FETCH_DEPTH}", "origin", latest, timeout=90)
        if _git(root, "rev-parse", "FETCH_HEAD") != latest:
            raise ValueError("latest main fetch does not match discovery")
    publish, reason = freshness_decision(source, latest, root=root)
    return publish, reason, latest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="exact checked-out OS SHA")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    try:
        allowed, reason, latest = check_official_main(args.source, root=args.root)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        parser.exit(1, f"CREATOR_MAIN_FRESHNESS_BLOCKED: {exc}\n")
    # Only an already verified Git ancestry/non-producer diff can skip a
    # superseded build. Unexpected network/status failures stop the workflow.
    output = {
        "publish_allowed": "true" if allowed else "false",
        "reason": reason,
        "latest_sha": latest,
    }
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8") as handle:
            handle.writelines(f"{key}={value}\n" for key, value in output.items())
    print("CREATOR_MAIN_FRESHNESS=" + ("ALLOW" if allowed else "SKIP")
          + " reason=" + reason + " latest=" + latest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
