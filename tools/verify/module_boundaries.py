#!/usr/bin/env python3
"""Fail CI when source imports cross canonical OrdaX module boundaries."""

from __future__ import annotations

import ast
import json
import posixpath
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
# Reuse the exact canonical source-path policy used by Web and component
# packaging, rather than maintaining a separate symlink/path scanner.
TOOLS = ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))
from source_graph import SourceGraphError, iter_trusted_source_files

CONTRACT_PATH = ROOT / "docs" / "contracts" / "module-boundaries.json"
CODE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go"}
IGNORED_DIRS = frozenset({".git", "node_modules", "vendor", "dist", "build", "out", "coverage"})

# ESM import/export declarations may span multiple lines. Do not let a
# newline conceal a cross-layer dependency from the canonical verifier.
JS_FROM_RE = re.compile(
    r"\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?[\"']([^\"']+)[\"']"
)
JS_CALL_RE = re.compile(r"\b(?:require(?:\.resolve)?|import)\s*\(\s*[\"']([^\"']+)[\"']\s*\)")
QUOTED_REPO_PATH_RE = re.compile(
    r"[\"']((?:github\.com/ordaxsystems/ordax-os/)?(?:system|bootstrap|tools/creator)/[^\"']+)[\"']"
)


def load_contract(root: Path = ROOT) -> dict:
    path = root / "docs" / "contracts" / "module-boundaries.json"
    return json.loads(path.read_text(encoding="utf-8"))


def python_import_specifiers(text: str) -> set[str]:
    """Use Python's AST so relative imports and comma-separated imports count.

    ImportFrom.level follows Python semantics: one dot refers to the current
    package, two dots to its parent, and so on. Convert that notation into
    filesystem-style relative specifiers for the one boundary resolver.
    """
    specs: set[str] = set()
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.Import):
            specs.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level:
                prefix = "../" * (node.level - 1) + "./" if node.level == 1 else "../" * (node.level - 1)
                if module:
                    specs.add(prefix + module.replace(".", "/"))
                else:
                    specs.update(prefix + alias.name.replace(".", "/")
                                 for alias in node.names if alias.name != "*")
            elif module:
                specs.add(module)
                if module in {"system", "bootstrap", "tools.creator"}:
                    specs.update(module + "." + alias.name
                                 for alias in node.names if alias.name != "*")
    return specs


def extract_import_specifiers(path: Path, text: str) -> set[str]:
    suffix = path.suffix.lower()
    specs: set[str] = set()
    if suffix in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}:
        specs.update(JS_FROM_RE.findall(text))
        specs.update(JS_CALL_RE.findall(text))
    elif suffix == ".py":
        specs.update(python_import_specifiers(text))
    elif suffix == ".go":
        specs.update(QUOTED_REPO_PATH_RE.findall(text))
    return specs


def normalize_specifier(source_rel: PurePosixPath, specifier: str) -> str | None:
    spec = specifier.strip().replace("\\", "/")
    if not spec:
        return None

    if spec.startswith("github.com/ordaxsystems/ordax-os/"):
        spec = spec.removeprefix("github.com/ordaxsystems/ordax-os/")

    if spec.startswith("@ordax/"):
        spec = "system/" + spec.removeprefix("@ordax/")
    elif spec.startswith(("system.", "bootstrap.", "tools.creator.")):
        spec = spec.replace(".", "/")

    if spec.startswith("."):
        candidate = posixpath.normpath(
            str(PurePosixPath(source_rel.parent) / PurePosixPath(spec))
        )
    elif spec.startswith(("system/", "bootstrap/", "tools/creator/")):
        candidate = posixpath.normpath(spec)
    else:
        return None

    if candidate == ".." or candidate.startswith("../") or candidate.startswith("/"):
        # Never treat an import into an adjacent checkout as an unrecognized
        # npm/stdlib dependency. The existing boundary check must fail closed
        # even if that checkout is not present on the CI runner.
        raise ValueError("relative import escapes canonical repository root")
    return candidate


def layer_for_path(rel_path: str, contract: dict) -> str | None:
    normalized = rel_path.rstrip("/")
    matches = []
    for layer in contract["layers"]:
        root = layer["root"].rstrip("/")
        if normalized == root or normalized.startswith(root + "/"):
            matches.append((len(root), layer["id"]))
    if not matches:
        return None
    return max(matches)[1]


def adapter_mode_for_path(rel_path: str, contract: dict) -> str | None:
    prefix = "system/adapters/"
    if not rel_path.startswith(prefix):
        return None
    tail = rel_path[len(prefix):]
    mode = tail.split("/", 1)[0]
    return mode if mode in set(contract.get("adapter_modes", [])) else None


def iter_source_files(root: Path) -> Iterable[Path]:
    for relative in (
        PurePosixPath("system"),
        PurePosixPath("bootstrap"),
        PurePosixPath("tools/creator"),
    ):
        top = root / relative
        if not top.exists() and not top.is_symlink():
            continue
        for file in iter_trusted_source_files(
            root, relative, ignored_dirs=IGNORED_DIRS
        ):
            if file.suffix.lower() in CODE_SUFFIXES:
                yield root / file


def find_violations(root: Path, contract: dict | None = None) -> list[str]:
    contract = contract or load_contract(root)
    layers = {entry["id"]: entry for entry in contract["layers"]}
    violations: list[str] = []

    creator_root = contract["external_boundaries"]["creator"]["root"].rstrip("/")
    bootstrap_root = contract["external_boundaries"]["bootstrap"]["root"].rstrip("/")

    try:
        sources = list(iter_source_files(root))
    except (OSError, SourceGraphError) as exc:
        # Fail the entire boundary audit rather than examining a partial list
        # after an untrusted linked directory was silently skipped.
        return [f"non-canonical OS source tree: {exc}"]

    for path in sources:
        source_rel = PurePosixPath(path.relative_to(root).as_posix())
        source_str = str(source_rel)
        source_layer = layer_for_path(source_str, contract)
        source_adapter_mode = adapter_mode_for_path(source_str, contract)
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            violations.append(f"{source_str}: source is not readable UTF-8")
            continue

        try:
            specifiers = extract_import_specifiers(path, text)
        except SyntaxError as exc:
            violations.append(f"{source_str}: invalid Python imports: {exc.msg}")
            continue

        for specifier in sorted(specifiers):
            try:
                target = normalize_specifier(source_rel, specifier)
            except ValueError:
                violations.append(
                    f"{source_str}: source may not import outside repository via {specifier!r}"
                )
                continue
            if target is None:
                continue
            target_layer = layer_for_path(target, contract)

            if source_layer and target_layer and source_layer != target_layer:
                if target_layer not in set(layers[source_layer]["allowed_dependencies"]):
                    violations.append(
                        f"{source_str}: {source_layer} may not import {target_layer} via {specifier!r} -> {target}"
                    )

            if (
                source_layer == "adapters"
                and target_layer == "adapters"
                and not contract["principles"]["adapter_modes_may_import_each_other"]
            ):
                target_mode = adapter_mode_for_path(target, contract)
                if source_adapter_mode and target_mode and source_adapter_mode != target_mode:
                    violations.append(
                        f"{source_str}: adapter mode {source_adapter_mode} may not import {target_mode} via {specifier!r}"
                    )

            if source_layer and (target == creator_root or target.startswith(creator_root + "/")):
                if not contract["external_boundaries"]["creator"]["system_source_direct_import_allowed"]:
                    violations.append(
                        f"{source_str}: system source may not import Creator implementation via {specifier!r}"
                    )

            if source_layer and (target == bootstrap_root or target.startswith(bootstrap_root + "/")):
                if not contract["external_boundaries"]["bootstrap"]["system_source_direct_import_allowed"]:
                    violations.append(
                        f"{source_str}: system source may not import bootstrap implementation via {specifier!r}"
                    )

            if (source_str == creator_root or source_str.startswith(creator_root + "/")) and target_layer:
                violations.append(
                    f"{source_str}: Creator source may not import shared system implementation via {specifier!r}"
                )

            if (source_str == bootstrap_root or source_str.startswith(bootstrap_root + "/")) and target_layer:
                violations.append(
                    f"{source_str}: bootstrap source may not import shared system implementation via {specifier!r}"
                )

    return sorted(set(violations))


def main() -> int:
    contract = load_contract(ROOT)
    violations = find_violations(ROOT, contract)
    if violations:
        print("MODULE_BOUNDARY_CHECK=FAIL")
        for violation in violations:
            print("VIOLATION=" + violation)
        return 1
    print("MODULE_BOUNDARY_CHECK=PASS")
    print(f"MODULE_BOUNDARY_SCHEMA={contract['$schema']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
