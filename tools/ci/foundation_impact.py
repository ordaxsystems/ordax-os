#!/usr/bin/env python3
"""Select a Foundation validation tier from the exact Git change set.

Only an exact documentation allowlist or modified test modules can use a
focused tier. Any source, contract, workflow, added/deleted test, invalid
base, or unclassifiable delta keeps the complete Foundation suite.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
SHA40 = re.compile(r"^[0-9a-f]{40}$")
TEST_MODULE = re.compile(r"^tests/test_[A-Za-z0-9_]+\.(?:py|mjs)$")

DOCS_ONLY = frozenset({
    "AGENTS.md",
    "README.md",
    "URGENTE-LEIA.md",
    "docs/README.md",
    "URGENTE-CONSOLIDACAO-ORDAX.md",
    "docs/DEVELOPMENT-WORKFLOW.md",
    "docs/DECISIONS.md",
    "docs/BUILD-AUTONOMY.md",
    "docs/CURRENT-STATE.md",
    "docs/CAPABILITY-FABRIC.md",
})


@dataclass(frozen=True)
class FoundationImpact:
    mode: str
    changed_paths: tuple[str, ...] = ()
    test_paths: tuple[str, ...] = ()
    reason: str = ""


def normalize(path: str) -> str:
    return path.strip().replace("\\", "/").removeprefix("./")


def classify_changes(
    changes: Iterable[tuple[str, str]], *, root: Path = ROOT
) -> FoundationImpact:
    normalized = tuple(sorted({(status, normalize(path)) for status, path in changes}))
    if not normalized:
        return FoundationImpact("full", reason="empty-diff-fails-closed")

    paths = tuple(path for _, path in normalized)
    if all(status in {"M", "A", "D"} and path in DOCS_ONLY for status, path in normalized):
        return FoundationImpact("docs", paths, reason="exact-documentation-allowlist")

    if all(status == "M" and TEST_MODULE.fullmatch(path) for status, path in normalized):
        for _, path in normalized:
            candidate = root.joinpath(*PurePosixPath(path).parts)
            if candidate.is_symlink() or not candidate.is_file():
                return FoundationImpact("full", paths, reason="test-module-not-regular")
        return FoundationImpact(
            "tests",
            paths,
            tuple(path for path in paths),
            reason="modified-test-modules-only",
        )

    return FoundationImpact("full", paths, reason="source-or-unknown-change")


def changed_paths_between(
    base: str,
    head: str,
    *,
    root: Path = ROOT,
    use_merge_base: bool = False,
) -> tuple[tuple[str, str], ...]:
    if SHA40.fullmatch(base or "") is None or SHA40.fullmatch(head or "") is None:
        raise ValueError("base/head must be exact lowercase 40-hex commits")
    if base == "0" * 40:
        raise ValueError("zero base cannot be classified")

    command = ["git", "-C", str(root), "diff", "--name-status", "-z", "--no-renames"]
    if use_merge_base:
        command.append("--merge-base")
    command.extend([base, head, "--"])
    result = subprocess.run(
        command,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
    )
    fields = result.stdout.decode("utf-8").split("\0")
    if fields and fields[-1] == "":
        fields.pop()
    if len(fields) % 2:
        raise ValueError("Git returned malformed name-status records")
    return tuple(
        (fields[index], fields[index + 1])
        for index in range(0, len(fields), 2)
    )


def write_output(path: Path, impact: FoundationImpact) -> None:
    payload = {
        "mode": impact.mode,
        "node_tests": str(any(item.endswith(".mjs") for item in impact.test_paths)).lower(),
        "tests_json": json.dumps(impact.test_paths, separators=(",", ":")),
    }
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        for name, value in payload.items():
            handle.write(f"{name}={value}\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="")
    parser.add_argument("--head", default="")
    parser.add_argument("--event", default="")
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()

    if args.event not in {"pull_request", "push"}:
        impact = FoundationImpact("full", reason="event-is-not-comparable")
    else:
        try:
            changes = changed_paths_between(
                args.base,
                args.head,
                use_merge_base=args.event == "pull_request",
            )
            impact = classify_changes(changes)
        except Exception as exc:
            impact = FoundationImpact(
                "full", reason=f"classification-failed:{type(exc).__name__}"
            )

    print(
        f"FOUNDATION_MODE={impact.mode} changed={len(impact.changed_paths)} "
        f"reason={impact.reason}",
        file=sys.stderr,
    )
    if args.github_output:
        write_output(args.github_output, impact)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
