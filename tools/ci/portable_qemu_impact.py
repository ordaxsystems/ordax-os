#!/usr/bin/env python3
"""Classify whether a repository delta requires the heavy Portable/QEMU proof.

The policy is deliberately fail-closed. High-level system source is lightweight only
when it is not part of the Native startup import graph and is not a known host/boot
owner. Unknown system roots and every non-system path reaching this workflow remain
heavy by default.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
NATIVE_COMPOSITION_ROOT = PurePosixPath("system/composition/native/main.mjs")

PRESENTATION_LIGHT_PREFIXES = (
    "system/surface/ui/",
    "system/surface/workspace/",
)
HIGH_LEVEL_LIGHT_PREFIXES = (
    "system/apps/",
    "system/adapters/",
    "system/contracts/",
    "system/services/",
    "system/network/",
    "system/profile-content-sources/",
    "system/profile-packs/",
    "system/components/",
    "system/diagnostics/",
)
ALWAYS_HEAVY_EXACT = {
    "system/entrypoint",
    "system/supervisor",
    "system/surface/entrypoint",
    "system/services/telemetry/base-agent.sh",
    "system/services/telemetry/relay.json",
    "system/services/base-update/agent.sh",
    "system/services/local-ai/source-lock.json",
    ".github/workflows/portable-v2-qemu-boot-proof.yml",
    "tools/ci/portable_qemu_impact.py",
    "tests/test_portable_qemu_impact.py",
    "tests/test_heavy_workflow_path_scope.py",
}
ALWAYS_HEAVY_PREFIXES = (
    "system/surface/bin/",
    "system/surface/runtime/",
    "system/composition/native/",
)
IMPORT_RE = re.compile(
    r"(?:^|\n)\s*(?:import|export)\s+(?:[^\"']*?\s+from\s+)?[\"'](\.[^\"']+)[\"']"
    r"|import\s*\(\s*[\"'](\.[^\"']+)[\"']\s*\)",
    re.MULTILINE,
)
IMPORT_EXTENSIONS = (".mjs", ".js", ".cjs", ".json")


@dataclass(frozen=True)
class ImpactResult:
    required: bool
    reasons: tuple[str, ...]
    changed_paths: tuple[str, ...]


def _normalise_path(value: str) -> str:
    path = value.strip().replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    return path


def _is_presentation_light(path: str) -> bool:
    return path.endswith(".md") or path.startswith(PRESENTATION_LIGHT_PREFIXES)


def _resolve_relative_import(source: Path, specifier: str, root: Path) -> Path | None:
    candidate = (source.parent / specifier).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None

    choices: list[Path] = [candidate]
    if candidate.suffix == "":
        choices.extend(candidate.with_suffix(ext) for ext in IMPORT_EXTENSIONS)
        choices.extend(candidate / f"index{ext}" for ext in IMPORT_EXTENSIONS)
    for choice in choices:
        if choice.is_file():
            return choice
    return None


def native_startup_import_graph(root: Path = ROOT) -> tuple[frozenset[str], tuple[str, ...]]:
    start = root / NATIVE_COMPOSITION_ROOT.as_posix()
    if not start.is_file():
        return frozenset(), (f"missing-startup-root:{NATIVE_COMPOSITION_ROOT.as_posix()}",)

    pending = [start.resolve()]
    visited: set[Path] = set()
    reachable: set[str] = set()
    errors: list[str] = []

    while pending:
        source = pending.pop()
        if source in visited:
            continue
        visited.add(source)
        relative = source.relative_to(root.resolve()).as_posix()
        reachable.add(relative)

        if _is_presentation_light(relative) or source.suffix not in {".mjs", ".js", ".cjs"}:
            continue
        try:
            text = source.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            errors.append(f"unreadable:{relative}:{type(exc).__name__}")
            continue

        for match in IMPORT_RE.finditer(text):
            specifier = match.group(1) or match.group(2)
            target = _resolve_relative_import(source, specifier, root)
            if target is None:
                errors.append(f"unresolved:{relative}:{specifier}")
                continue
            target_relative = target.relative_to(root.resolve()).as_posix()
            if _is_presentation_light(target_relative):
                # Presentation has dedicated Surface gates and is intentionally not a
                # kernel/QEMU causal input. Do not traverse its dependency subtree here.
                continue
            pending.append(target)

    return frozenset(reachable), tuple(sorted(set(errors)))


def classify_paths(paths: Iterable[str], *, root: Path = ROOT) -> ImpactResult:
    changed = tuple(sorted({p for raw in paths if (p := _normalise_path(raw))}))
    if not changed:
        return ImpactResult(False, ("no-changes",), changed)

    reachable, graph_errors = native_startup_import_graph(root)
    if graph_errors:
        return ImpactResult(True, tuple(f"startup-graph:{item}" for item in graph_errors), changed)

    reasons: list[str] = []
    for path in changed:
        if path in ALWAYS_HEAVY_EXACT:
            reasons.append(f"heavy-exact:{path}")
            continue
        if path.startswith(ALWAYS_HEAVY_PREFIXES):
            reasons.append(f"heavy-prefix:{path}")
            continue
        if not path.startswith("system/"):
            # The workflow trigger already limits non-system paths to Portable/boot/
            # release inputs. Treat any such path as heavy rather than maintaining a
            # second permissive allowlist here.
            reasons.append(f"heavy-non-system:{path}")
            continue
        if _is_presentation_light(path):
            continue
        if path in reachable:
            reasons.append(f"native-startup-reachable:{path}")
            continue
        if path.startswith(HIGH_LEVEL_LIGHT_PREFIXES):
            continue
        # New or unclassified system roots fail closed until their impact class is
        # made explicit.
        reasons.append(f"heavy-unclassified-system:{path}")

    return ImpactResult(bool(reasons), tuple(reasons) or ("high-level-not-startup-reachable",), changed)


def changed_paths_between(base: str, head: str, *, root: Path = ROOT) -> tuple[str, ...]:
    sha = re.compile(r"^[0-9a-f]{40}$")
    if sha.fullmatch(base or "") is None or sha.fullmatch(head or "") is None:
        raise ValueError("base/head must be lowercase 40-hex commits")
    if base == "0" * 40:
        raise ValueError("zero base commit requires fail-closed execution")
    completed = subprocess.run(
        ["git", "-C", str(root), "diff", "--name-only", "--no-renames", base, head, "--"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return tuple(line.strip() for line in completed.stdout.splitlines() if line.strip())


def write_github_output(path: Path, result: ImpactResult) -> None:
    reason = ";".join(result.reasons)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"required={'true' if result.required else 'false'}\n")
        handle.write(f"reason={reason}\n")
        handle.write(f"changed_count={len(result.changed_paths)}\n")


def command_classify(args: argparse.Namespace) -> int:
    if args.force:
        result = ImpactResult(True, ("explicit-force",), tuple())
    else:
        try:
            paths = changed_paths_between(args.base, args.head)
            result = classify_paths(paths)
        except Exception as exc:  # CI impact classification must fail closed.
            result = ImpactResult(True, (f"classification-failed:{type(exc).__name__}",), tuple())

    print(
        f"PORTABLE_QEMU_REQUIRED={'YES' if result.required else 'NO'} "
        f"reason={';'.join(result.reasons)} changed={len(result.changed_paths)}"
    )
    if args.github_output:
        write_github_output(Path(args.github_output), result)
    return 0


def command_paths(args: argparse.Namespace) -> int:
    result = classify_paths(args.paths)
    print("required=true" if result.required else "required=false")
    for reason in result.reasons:
        print(f"reason={reason}")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    sub = root.add_subparsers(dest="command", required=True)

    classify = sub.add_parser("classify")
    classify.add_argument("--base", default="")
    classify.add_argument("--head", default="")
    classify.add_argument("--force", action="store_true")
    classify.add_argument("--github-output")
    classify.set_defaults(func=command_classify)

    paths = sub.add_parser("paths")
    paths.add_argument("paths", nargs="+")
    paths.set_defaults(func=command_paths)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
