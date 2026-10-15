#!/usr/bin/env python3
"""Classify whether a repository delta requires the heavy Portable/QEMU proof.

The policy is deliberately fail-closed. High-level system source is lightweight only
when it is not part of the Native runtime import graph and is not a known host/boot
owner. Unknown system roots and every non-system path reaching this workflow remain
heavy by default, except explicitly classified producer-neutral helpers or roots.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import sys
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
NATIVE_COMPOSITION_INDEX = Path("system/composition/native/index.html")
NATIVE_COMPOSITION_MAIN = Path("system/composition/native/main.mjs")
NATIVE_BROWSER_HOST = Path("system/surface/runtime/ordax_browser_host.py")

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
PRODUCER_NEUTRAL_LIGHT_EXACT = {
    ".github/workflows/independent-base-experiment.yml",
    "bootstrap/kernel/module_archive.py",
    "tests/test_independent_kernel_module_workflow.py",
    "tests/test_kernel_module_archive.py",
}
PRODUCER_NEUTRAL_LIGHT_PREFIXES = (
    "bootstrap/independent-base/",
)
OWNER_DEVELOPMENT_LIGHT_EXACT = {
    "docs/REMOTE-CONTROL.md",
    "tests/test_dev_base_helper_refresh.py",
    "tests/test_owner_remote_recovery.py",
}
OWNER_DEVELOPMENT_LIGHT_PREFIXES = (
    "bootstrap/base-update/owner-development/",
)
IMPACT_POLICY_LIGHT_EXACT = {
    "tools/ci/portable_qemu_impact.py",
    "tests/test_portable_qemu_impact.py",
}
ALWAYS_HEAVY_EXACT = {
    "system/entrypoint",
    "system/supervisor",
    "system/surface/entrypoint",
    "system/services/telemetry/base-agent.sh",
    "system/services/telemetry/relay.json",
    "system/services/base-update/agent.sh",
    "system/services/local-ai/source-lock.json",
    ".github/workflows/portable-v2-qemu-boot-proof.yml",
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
BROWSER_NATIVE_IMPORT_RE = re.compile(
    r"[\"'](/composition/native/[^\"'?#\s]+\.(?:mjs|js))[\"']"
)
IMPORT_EXTENSIONS = (".mjs", ".js", ".cjs", ".json")


@dataclass(frozen=True)
class ImpactResult:
    required: bool
    reasons: tuple[str, ...]
    changed_paths: tuple[str, ...]


class _ModuleScriptParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sources: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        values = {key.lower(): value for key, value in attrs}
        if (values.get("type") or "").lower() != "module":
            return
        source = values.get("src")
        if source:
            self.sources.append(source)


def _normalise_path(value: str) -> str:
    path = value.strip().replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    return path


def _is_presentation_light(path: str) -> bool:
    return path.endswith(".md") or path.startswith(PRESENTATION_LIGHT_PREFIXES)


def _path_inside_root(candidate: Path, root: Path) -> Path | None:
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError:
        return None
    return resolved


def _resolve_relative_import(source: Path, specifier: str, root: Path) -> Path | None:
    candidate = _path_inside_root(source.parent / specifier, root)
    if candidate is None:
        return None

    choices: list[Path] = [candidate]
    if candidate.suffix == "":
        choices.extend(candidate.with_suffix(ext) for ext in IMPORT_EXTENSIONS)
        choices.extend(candidate / f"index{ext}" for ext in IMPORT_EXTENSIONS)
    for choice in choices:
        if choice.is_file():
            return choice
    return None


def _native_runtime_roots(root: Path) -> tuple[tuple[Path, ...], tuple[str, ...]]:
    root = root.resolve()
    index = root / NATIVE_COMPOSITION_INDEX
    browser_host = root / NATIVE_BROWSER_HOST
    errors: list[str] = []
    discovered: set[Path] = set()

    if not index.is_file():
        errors.append(f"missing-runtime-root-source:{NATIVE_COMPOSITION_INDEX.as_posix()}")
    else:
        try:
            parser = _ModuleScriptParser()
            parser.feed(index.read_text(encoding="utf-8"))
            for source in parser.sources:
                if not source.startswith("./") or "?" in source or "#" in source:
                    errors.append(f"unsupported-module-script:{source}")
                    continue
                candidate = _path_inside_root(index.parent / source, root)
                if candidate is None or not candidate.is_file():
                    errors.append(f"missing-module-script:{source}")
                    continue
                discovered.add(candidate)
        except (OSError, UnicodeError, ValueError) as exc:
            errors.append(f"unreadable-runtime-index:{type(exc).__name__}")

    if not browser_host.is_file():
        errors.append(f"missing-runtime-root-source:{NATIVE_BROWSER_HOST.as_posix()}")
    else:
        try:
            browser_text = browser_host.read_text(encoding="utf-8")
            for match in BROWSER_NATIVE_IMPORT_RE.finditer(browser_text):
                url_path = match.group(1)
                candidate = _path_inside_root(root / "system" / url_path.lstrip("/"), root)
                if candidate is None or not candidate.is_file():
                    errors.append(f"missing-browser-native-import:{url_path}")
                    continue
                discovered.add(candidate)
        except (OSError, UnicodeError) as exc:
            errors.append(f"unreadable-browser-host:{type(exc).__name__}")

    required_main = (root / NATIVE_COMPOSITION_MAIN).resolve()
    if required_main not in discovered:
        errors.append(f"missing-required-runtime-root:{NATIVE_COMPOSITION_MAIN.as_posix()}")

    return tuple(sorted(discovered)), tuple(sorted(set(errors)))


def native_startup_import_graph(root: Path = ROOT) -> tuple[frozenset[str], tuple[str, ...]]:
    runtime_roots, root_errors = _native_runtime_roots(root)
    if root_errors:
        return frozenset(), root_errors

    resolved_root = root.resolve()
    pending = list(runtime_roots)
    visited: set[Path] = set()
    reachable: set[str] = set()
    errors: list[str] = []

    while pending:
        source = pending.pop()
        if source in visited:
            continue
        visited.add(source)
        relative = source.relative_to(resolved_root).as_posix()
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
            target_relative = target.relative_to(resolved_root).as_posix()
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
        return ImpactResult(True, tuple(f"runtime-graph:{item}" for item in graph_errors), changed)

    reasons: list[str] = []
    for path in changed:
        if path in ALWAYS_HEAVY_EXACT:
            reasons.append(f"heavy-exact:{path}")
            continue
        if path.startswith(ALWAYS_HEAVY_PREFIXES):
            reasons.append(f"heavy-prefix:{path}")
            continue
        if path in PRODUCER_NEUTRAL_LIGHT_EXACT:
            continue
        if path.startswith(PRODUCER_NEUTRAL_LIGHT_PREFIXES):
            continue
        if path in OWNER_DEVELOPMENT_LIGHT_EXACT:
            continue
        if path.startswith(OWNER_DEVELOPMENT_LIGHT_PREFIXES):
            continue
        if path in IMPACT_POLICY_LIGHT_EXACT:
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
            reasons.append(f"native-runtime-reachable:{path}")
            continue
        if path.startswith(HIGH_LEVEL_LIGHT_PREFIXES):
            continue
        # New or unclassified system roots fail closed until their impact class is
        # made explicit.
        reasons.append(f"heavy-unclassified-system:{path}")

    return ImpactResult(bool(reasons), tuple(reasons) or ("high-level-not-runtime-reachable",), changed)


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
