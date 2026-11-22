#!/usr/bin/env python3
"""One fail-closed Git diff policy for Vercel and GitHub Site candidate CI.

Vercel skips only when nothing affecting the hosted Site changed since the
last successful deployment on the same branch. CI can avoid costly signed
release downloads and Chrome for *PR-only* documentation edits. On pushes,
CI always validates the full candidate; failed or unfinished prior CI must
never be overwritten by a cheap documentation-only green run.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GIT_ROOT = ROOT.parent  # Site is exclusively an ordax-os workspace.
PREFIX = "site/"
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
DOC_FILES = frozenset({PREFIX + "README.md", PREFIX + "AGENTS.md", PREFIX + "URGENTE-LEIA.md"})
DOC_PREFIXES = ("docs/", PREFIX + "docs/")
HOST_ONLY_PREFIXES = (PREFIX + "tests/", PREFIX + ".github/")

# Only code used by the public Site (and its canonical gateway) can invalidate
# the deployment. Native OS, Desktop and Forge remain independent.
SITE_DEPLOYMENT_PREFIXES = (
    PREFIX,
    "api/",
    "tools/vercel/",
    "infra/supabase/functions/_shared/",
    "infra/supabase/functions/ordax-public-account-gateway/",
)
SITE_DEPLOYMENT_FILES = frozenset({
    "lib/account-proxy-core.mjs",
    "package.json",
    "package-lock.json",
})

def changed_paths(baseline: str | None) -> tuple[str, ...] | None:
    """Return every changed tracked path; None is an uncertain/invalid diff."""
    if not isinstance(baseline, str) or SHA40.fullmatch(baseline) is None:
        return None
    try:
        result = subprocess.run(
            ["git", "diff", "--no-ext-diff", "--no-textconv", "--no-renames",
             "--name-only", "-z", baseline, "HEAD", "--"],
            cwd=GIT_ROOT, check=False, capture_output=True, timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    try:
        paths = result.stdout.decode("utf-8").split("\0")
    except UnicodeError:
        return None
    return tuple(item for item in paths if item)


def is_doc(path: str) -> bool:
    return path in DOC_FILES or path.startswith(DOC_PREFIXES)


def affects_site_deployment(path: str) -> bool:
    """Only canonical owners of Site source and shared gateway require a build."""
    # This contract is in docs/, but it is executable ownership state.
    if path.startswith("docs/contracts/public-site") and path.endswith(".json"):
        return True
    if is_doc(path) or path.startswith(HOST_ONLY_PREFIXES):
        return False
    return path in SITE_DEPLOYMENT_FILES or path.startswith(SITE_DEPLOYMENT_PREFIXES)


def may_skip_vercel(paths: tuple[str, ...] | None) -> bool:
    # Missing/unreadable diffs fail closed and build the site.
    return paths is not None and not any(map(affects_site_deployment, paths))


def may_skip_full_ci(paths: tuple[str, ...] | None, event: str) -> bool:
    # PR checks still run compile, source audit, legal/i18n and Python tests.
    # Pushes always compile/test the actual main; a previous failed push can
    # otherwise be concealed by a following documentation-only commit.
    return event == "pull_request" and bool(paths) and all(map(is_doc, paths))


def main() -> int:
    if sys.argv[1:] == ["--vercel"]:
        paths = changed_paths(os.environ.get("VERCEL_GIT_PREVIOUS_SHA"))
        skip = may_skip_vercel(paths)
        print("SITE_VERCEL_BUILD=" + ("SKIPPED_UNCHANGED" if skip else "REQUIRED"))
        return 0 if skip else 1

    if sys.argv[1:] == ["--ci"]:
        paths = changed_paths(os.environ.get("ORDAX_CI_BASE_SHA"))
        light = may_skip_full_ci(paths, os.environ.get("ORDAX_CI_EVENT", ""))
        output = os.environ.get("GITHUB_OUTPUT")
        if not output:
            raise SystemExit("missing-github-output")
        with open(output, "a", encoding="utf-8") as stream:
            stream.write("full=" + ("false" if light else "true") + "\n")
        print("SITE_CI_IMPACT=" + ("DOCS_ONLY" if light else "FULL_CANDIDATE"))
        return 0

    raise SystemExit("usage: build_impact.py --vercel | --ci")


if __name__ == "__main__":
    raise SystemExit(main())
