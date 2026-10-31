#!/usr/bin/env python3
"""Classify whether a repository delta requires the heavy Portable/QEMU proof.

The policy is deliberately fail-closed at boot/host boundaries. High-level system
source is covered by focused contract/Surface gates even when imported by Native startup,
so it does not justify rebuilding initramfs or booting QEMU by itself. Unknown system
roots and every non-system path reaching this workflow remain heavy by default, except
explicitly classified producer-neutral helpers or roots.
"""
from __future__ import annotations

import argparse
import json
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
QEMU_WORKFLOW = Path(".github/workflows/portable-v2-qemu-boot-proof.yml")

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
    "system/composition/native/",
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
    ".github/workflows/owner-remote-recovery-contract.yml",
    "bootstrap/dev-base/ordax-run",
    "docs/REMOTE-CONTROL.md",
    "tests/test_dev_base_helper_refresh.py",
    "tests/test_dev_git_flow.py",
    "tests/test_owner_remote_recovery.py",
}
OWNER_DEVELOPMENT_LIGHT_PREFIXES = (
    "bootstrap/base-update/owner-development/",
)
CI_GOVERNANCE_LIGHT_EXACT = {
    # Creator USB workflow routing and its contract tests do not produce
    # Portable boot artifacts. The Creator still executes its own full USB gates.
    ".github/workflows/creator-owner-dev-git.yml",
    "tests/test_creator_owner_external_source.py",
    "tools/ci/creator_owner_impact.py",
    "tests/test_creator_owner_impact.py",
    ".github/workflows/account-memory-local-continuity-flush.yml",
    ".github/workflows/account-memory-protected-mutations.yml",
    ".github/workflows/account-memory-sync-foundation.yml",
    ".github/workflows/application-action-capability-foundation.yml",
    ".github/workflows/component-trusted-context.yml",
    ".github/workflows/first-party-app-delivery.yml",
    ".github/workflows/intelligence-foundation.yml",
    ".github/workflows/native-intelligence-service-foundation.yml",
    ".github/workflows/pre-usb-nova-ordax-audit.yml",
    ".github/workflows/runtime-component-candidate.yml",
    ".github/workflows/app-sdk-contract.yml",
    ".github/workflows/notes-externalization-boundary.yml",
    ".github/workflows/service-update-inventory.yml",
    "tools/ci/app_sdk_impact.mjs",
    "tools/ci/service_update_impact.mjs",
    "tests/test_causal_workflow_impact.mjs",
}
# App lifecycle/Store policy is validated by focused application and
# signed-delivery gates. These exact contracts do not produce kernel, initramfs,
# offline Surface EROFS or Portable boot bytes.
APP_DELIVERY_LIGHT_EXACT = {
    "docs/contracts/app-distribution.json",
    "docs/contracts/first-party-app-delivery.json",
    "docs/contracts/mvp-app-delivery.json",
    "tests/test_first_party_app_delivery.mjs",
    "tests/test_mvp_app_delivery.mjs",
    "tests/test_zero_removable_bootstrap.mjs",
}
# Windows Desktop has its own installed-Electron, Native and offline inference gates.
# These source owners do not enter Linux Portable boot artifacts.
WINDOWS_DESKTOP_LIGHT_PREFIXES = (
    "tools/windows-desktop/",
    "tools/windows-emulator/",
)
WINDOWS_DESKTOP_LIGHT_EXACT = {
    ".github/workflows/windows-desktop-dev.yml",
    "tests/test_windows_desktop_local_ai_host.mjs",
    "tests/test_windows_desktop_local_ai_package.mjs",
    # The signed-current Desktop bridge has its own Windows Native and
    # Component Trusted Context proofs. These isolated test fixtures and
    # Chromium-only smoke never produce Portable boot or offline EROFS bytes.
    # Keep Native shared runtime/boot hosts fail-closed under the normal graph.
    "tests/test_native_signed_current_compatibility.mjs",
    "tests/test_native_verified_installed_apps.mjs",
    "tools/surface-web/browser-smoke.mjs",
}
WINDOWS_LOCAL_AI_SOURCE_LOCK = "system/services/local-ai/source-lock.json"
SURFACE_VISUAL_SOURCE_LOCK = "docs/contracts/surface-source.json"

ACCOUNT_GATEWAY_DEPLOY_LIGHT_EXACT = {
    # Exact high-level Account HTTP transport and contract tests.
    "docs/contracts/native-account-session.json",
    "infra/supabase/functions/_shared/space_create_contract.mjs",
    "tests/test_native_account_gateway.py",
    "tests/test_native_account_session_contract.py",
    "tests/test_space_create_bridge.mjs",
    ".github/workflows/ordax-account-gateway-destination.yml",
    "docs/contracts/ci-supply-chain.json",
    "tools/account/resolve_account_gateway_destination.py",
    "tests/test_account_gateway_destination_deploy.py",
}
NATIVE_ACCOUNT_TRANSPORT_LIGHT_EXACT = {
    "system/surface/runtime/native_account_gateway.py",
}
IMPACT_POLICY_LIGHT_EXACT = {
    ".github/workflows/portable-qemu-impact-contract.yml",
    "tools/ci/portable_qemu_impact.py",
    "tests/test_portable_qemu_impact.py",
    "tests/test_heavy_workflow_path_scope.py",
    "tests/test_native_memory_integration.py",
    "tests/test_surface_boot_screen.py",
    "tests/test_power_actions.mjs",
    "tests/test_update_presentation_pinned.mjs",
    "tests/test_portable_qemu_high_level_light.py",
    # Source-only Intelligence composition uses isolated Native/Owner/release
    # gates. Kernel, rootfs and real Native boot changes still remain heavy.
    "tools/intelligence-source/compose.py",
    "tests/test_native_release_intelligence_source.py",
    ".github/workflows/local-ai-runtime-candidate.yml",
}
PRODUCT_DEVICE_PRESENCE_LIGHT_EXACT = {
    "docs/contracts/product-device-presence.json",
    "system/services/device-agent/product-presence-report.sh",
    "tests/test_product_device_presence_agent.py",
}
ACCOUNT_SPACE_SEMANTICS_LIGHT_EXACT = {
    # Exact, focused SQL owner-authority repair; no boot or initramfs code.
    "infra/supabase/product/migrations/20261031051500_space_owner_ssot_creation_fix_v1.sql",
    "tests/sql/test_space_creation_authority_v1.sql",
    "tests/test_space_creation_authority.mjs",
    ".github/workflows/space-creation-authority-v1-proof.yml",
    "infra/supabase/functions/ordax-account-gateway/index.ts",
    "infra/supabase/product/migrations/20261015153000_space_semantics_v1.sql",
    "infra/supabase/product/migrations/20261015195800_space_semantics_write_guard_v1.sql",
    "services/public-identity/supabase_account.py",
    "tests/test_account_spaces_source.py",
    "tests/test_spaces_catalog.mjs",
    "tests/test_supabase_account_provider.py",
}
SPACE_COMPOSITION_LIGHT_EXACT = {
    "docs/contracts/spaces-and-profile-packs.json",
    "tests/test_account_canonical_navigation.py",
    "tests/test_space_aura_provider.mjs",
    "tests/test_space_experience.mjs",
    "tests/test_space_presentation.mjs",
    "tests/test_space_switcher.mjs",
}
ALWAYS_HEAVY_EXACT = {
    "system/entrypoint",
    "system/supervisor",
    "system/surface/entrypoint",
    "system/services/telemetry/base-agent.sh",
    "system/services/telemetry/relay.json",
    "system/services/base-update/agent.sh",
    "system/services/local-ai/source-lock.json",
    "system/services/local-ai/runtime.mjs",
    "system/services/components/probation-orchestrator.mjs",
    "system/composition/native/component-probation.mjs",
    ".github/workflows/portable-v2-qemu-boot-proof.yml",
}
ALWAYS_HEAVY_PREFIXES = (
    "system/surface/bin/",
    "system/surface/runtime/",
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
WORKFLOW_PATH_ITEM_RE = re.compile(r"^ {6}-\s+([\'\"])(.+)\1\s*$")


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


def workflow_path_patterns(root: Path = ROOT) -> tuple[str, ...]:
    """Return the single canonical push/PR path scope from the workflow YAML.

    The workflow intentionally duplicates its path list for ``push`` and
    ``pull_request``. Both blocks must remain byte-for-byte equivalent here;
    drift makes impact classification fail closed instead of guessing.
    """
    workflow = root / QEMU_WORKFLOW
    try:
        lines = workflow.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise ValueError(f"workflow-unreadable:{type(exc).__name__}") from exc

    blocks: list[tuple[str, ...]] = []
    index = 0
    while index < len(lines):
        if lines[index] != "    paths:":
            index += 1
            continue
        index += 1
        patterns: list[str] = []
        while index < len(lines):
            line = lines[index]
            if not line.strip():
                index += 1
                continue
            indent = len(line) - len(line.lstrip(" "))
            if indent <= 4:
                break
            match = WORKFLOW_PATH_ITEM_RE.fullmatch(line)
            if match is None:
                raise ValueError(f"unsupported-workflow-path-line:{index + 1}")
            patterns.append(match.group(2))
            index += 1
        if not patterns:
            raise ValueError("empty-workflow-path-block")
        blocks.append(tuple(patterns))

    if len(blocks) != 2:
        raise ValueError(f"expected-two-workflow-path-blocks:found-{len(blocks)}")
    if blocks[0] != blocks[1]:
        raise ValueError("push-pull-workflow-path-scope-drift")
    return blocks[0]


def _github_glob_regex(pattern: str) -> re.Pattern[str]:
    """Compile the bounded glob syntax currently used by this workflow."""
    if not pattern or pattern.startswith("!"):
        raise ValueError("glob-pattern-must-be-positive")
    out = ["^"]
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if char == "*":
            if index + 1 < len(pattern) and pattern[index + 1] == "*":
                index += 2
                if index < len(pattern) and pattern[index] == "/":
                    out.append("(?:.*/)?")
                    index += 1
                else:
                    out.append(".*")
                continue
            out.append("[^/]*")
        elif char == "?":
            out.append("[^/]")
        elif char in "[]{}":
            # The current workflow does not use character classes or brace
            # expansion. Reject future syntax until matching semantics are added.
            raise ValueError(f"unsupported-workflow-glob-syntax:{char}")
        else:
            out.append(re.escape(char))
        index += 1
    out.append("$")
    return re.compile("".join(out))


def _path_matches_workflow(path: str, patterns: tuple[str, ...]) -> bool:
    matched = False
    for raw_pattern in patterns:
        negative = raw_pattern.startswith("!")
        pattern = raw_pattern[1:] if negative else raw_pattern
        if _github_glob_regex(pattern).fullmatch(path):
            matched = not negative
    return matched


def workflow_scoped_paths(paths: Iterable[str], *, root: Path = ROOT) -> tuple[str, ...]:
    patterns = workflow_path_patterns(root)
    normalized = {_normalise_path(raw) for raw in paths}
    return tuple(
        sorted(
            path
            for path in normalized
            if path and _path_matches_workflow(path, patterns)
        )
    )


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
                continue
            pending.append(target)

    return frozenset(reachable), tuple(sorted(set(errors)))


def classify_paths(
    paths: Iterable[str], *, root: Path = ROOT, windows_lock_verified: bool = False,
    surface_visual_lock_verified: bool = False,
) -> ImpactResult:
    changed = tuple(sorted({p for raw in paths if (p := _normalise_path(raw))}))
    if not changed:
        return ImpactResult(False, ("no-changes",), changed)

    reachable, graph_errors = native_startup_import_graph(root)
    if graph_errors:
        return ImpactResult(True, tuple(f"runtime-graph:{item}" for item in graph_errors), changed)

    reasons: list[str] = []
    for path in changed:
        # Verified visual-source lock updates do not change kernel, boot or
        # graphical runtime bytes. Source Consumer and Windows gates own them.
        if path == SURFACE_VISUAL_SOURCE_LOCK and surface_visual_lock_verified:
            continue
        if path in ALWAYS_HEAVY_EXACT:
            # This exception is authorized by commit-level JSON comparison,
            # never merely from an untrusted filename list.
            if path == WINDOWS_LOCAL_AI_SOURCE_LOCK and windows_lock_verified:
                continue
            reasons.append(f"heavy-exact:{path}")
            continue
        if path in NATIVE_ACCOUNT_TRANSPORT_LIGHT_EXACT:
            continue
        if path.startswith(ALWAYS_HEAVY_PREFIXES):
            reasons.append(f"heavy-prefix:{path}")
            continue
        if path in WINDOWS_DESKTOP_LIGHT_EXACT:
            continue
        if path.startswith(WINDOWS_DESKTOP_LIGHT_PREFIXES):
            continue
        if path in PRODUCER_NEUTRAL_LIGHT_EXACT:
            continue
        if path.startswith(PRODUCER_NEUTRAL_LIGHT_PREFIXES):
            continue
        if path in OWNER_DEVELOPMENT_LIGHT_EXACT:
            continue
        if path.startswith(OWNER_DEVELOPMENT_LIGHT_PREFIXES):
            continue
        if (
            path in APP_DELIVERY_LIGHT_EXACT
            or path in CI_GOVERNANCE_LIGHT_EXACT
            or path in ACCOUNT_GATEWAY_DEPLOY_LIGHT_EXACT
            or path in IMPACT_POLICY_LIGHT_EXACT
            or path in PRODUCT_DEVICE_PRESENCE_LIGHT_EXACT
            or path in SPACE_COMPOSITION_LIGHT_EXACT
            or path in ACCOUNT_SPACE_SEMANTICS_LIGHT_EXACT
        ):
            continue
        # Markdown and Surface presentation sources cannot alter boot artifacts.
        # Classify them before the non-system fail-closed rule so docs/*.md do not
        # accidentally rebuild kernel/initramfs/QEMU.
        if _is_presentation_light(path):
            continue
        if not path.startswith("system/"):
            reasons.append(f"heavy-non-system:{path}")
            continue
        # High-level Native JS is checked by focused contracts/Surface gates. QEMU is
        # reserved for explicit boot/host-coupled owners above and unknown roots.
        if path.startswith(HIGH_LEVEL_LIGHT_PREFIXES):
            continue
        if path in reachable:
            reasons.append(f"native-runtime-reachable:{path}")
            continue
        reasons.append(f"heavy-unclassified-system:{path}")

    return ImpactResult(bool(reasons), tuple(reasons) or ("no-heavy-portable-impact",), changed)


def verified_surface_visual_source_lock_delta(
    base: str, head: str, *, root: Path = ROOT
) -> bool:
    """Skip boot proof only for an exact visual-only source-pin advancement.

    The external Surface is materialized exclusively under the two presentation
    roots; Source Consumer verifies the referenced commit and bytes separately.
    Reject other contract changes, invalid revisions, rollback and absent pins.
    """
    if not all(re.fullmatch(r"[0-9a-f]{40}", x or "") for x in (base, head)):
        return False

    def load(revision: str) -> dict:
        output = subprocess.run(
            ["git", "-C", str(root), "show", f"{revision}:{SURFACE_VISUAL_SOURCE_LOCK}"],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stdout
        if len(output) > 2 * 1024 * 1024:
            raise ValueError("oversized Surface source lock")
        value = json.loads(output.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("invalid Surface source lock")
        return value

    try:
        old, new = load(base), load(head)
        if (old.get("source_repository") != "ordaxsystems/ordax-surface"
            or new.get("source_repository") != old["source_repository"]
            or new.get("visual_source_paths") != [
                "system/surface/ui", "system/surface/workspace"
            ] or old.get("visual_source_paths") != new["visual_source_paths"]):
            return False
        before, after = old.get("source_commit"), new.get("source_commit")
        if (not isinstance(before, str) or not isinstance(after, str)
            or not re.fullmatch(r"[0-9a-f]{40}", before)
            or not re.fullmatch(r"[0-9a-f]{40}", after) or before == after):
            return False
        old.pop("source_commit")
        new.pop("source_commit")
        return old == new
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        return False


def verified_windows_only_local_ai_lock_delta(
    base: str, head: str, *, root: Path = ROOT
) -> bool:
    """Verify Linux Local AI source lock stays unchanged at exact Git SHAs.

    Only changes to engine.windows_artifact may avoid Portable QEMU.
    Any invalid revision, file, or change to a shared field requires QEMU.
    """
    if not all(re.fullmatch(r"[0-9a-f]{40}", x or "") for x in (base, head)):
        return False

    def load(revision: str) -> dict:
        result = subprocess.run(
            ["git", "-C", str(root), "show", f"{revision}:{WINDOWS_LOCAL_AI_SOURCE_LOCK}"],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if len(result.stdout) > 2 * 1024 * 1024:
            raise ValueError("oversized Local AI source lock")
        value = json.loads(result.stdout.decode("utf-8"))
        if not isinstance(value, dict) or not isinstance(value.get("engine"), dict):
            raise ValueError("malformed Local AI lock")
        return value

    try:
        old, new = load(base), load(head)
        before = old["engine"].get("windows_artifact")
        after = new["engine"].get("windows_artifact")
        if before == after or not isinstance(after, dict):
            return False
        if (
            after.get("platform") != "windows-x86_64"
            or after.get("architecture") != "x64"
            or after.get("binary_format") != "PE"
            or after.get("source_commit") != new["engine"].get("commit")
            or not isinstance(after.get("files"), list)
            or not 10 <= len(after["files"]) <= 32
        ):
            return False
        required = {
            "ggml-base.dll", "ggml.dll", "llama-common.dll",
            "llama-server-impl.dll", "llama-server.exe", "llama.dll", "mtmd.dll",
            "ggml-cpu-x64.dll", "ggml-cpu-sandybridge.dll", "ggml-cpu-haswell.dll",
        }
        entries = after["files"]
        if any(not isinstance(item, dict) for item in entries):
            return False
        names = [item.get("name") for item in entries]
        if (
            any(not isinstance(name, str) for name in names)
            or len(set(names)) != len(names)
            or not required.issubset(set(names))
            or any(name not in required and not re.fullmatch(r"ggml-cpu-[a-z0-9]+\.dll", name)
                   for name in names)
            or any(
                not isinstance(item.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])
                or not isinstance(item.get("size_bytes"), int)
                or isinstance(item["size_bytes"], bool)
                or item["size_bytes"] < 1
                for item in entries
            )
        ):
            return False
        old["engine"].pop("windows_artifact", None)
        new["engine"].pop("windows_artifact", None)
        return old == new
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        return False


def classify_workflow_paths(
    paths: Iterable[str], *, root: Path = ROOT, windows_lock_verified: bool = False,
    surface_visual_lock_verified: bool = False,
) -> ImpactResult:
    """Classify only files that belong to the workflow's canonical YAML scope."""
    changed = tuple(sorted({p for raw in paths if (p := _normalise_path(raw))}))
    try:
        scoped = workflow_scoped_paths(changed, root=root)
    except Exception as exc:
        return ImpactResult(
            True,
            (f"workflow-scope:{type(exc).__name__}:{exc}",),
            changed,
        )
    if not scoped:
        return ImpactResult(False, ("outside-workflow-scope-only",), scoped)
    return classify_paths(
        scoped, root=root, windows_lock_verified=windows_lock_verified,
        surface_visual_lock_verified=surface_visual_lock_verified,
    )


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
            windows_lock_verified = (
                WINDOWS_LOCAL_AI_SOURCE_LOCK in paths
                and verified_windows_only_local_ai_lock_delta(args.base, args.head)
            )
            surface_visual_lock_verified = (
                SURFACE_VISUAL_SOURCE_LOCK in paths
                and verified_surface_visual_source_lock_delta(args.base, args.head)
            )
            result = classify_workflow_paths(
                paths, windows_lock_verified=windows_lock_verified,
                surface_visual_lock_verified=surface_visual_lock_verified,
            )
        except Exception as exc:
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