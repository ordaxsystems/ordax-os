#!/usr/bin/env python3
"""Guard generated-C completeness against the Wine generated Makefile graph.

A post-build filesystem scan alone cannot prove completeness if a recipe could
compile a temporary C file and remove it. The generated Wine Makefile closes
that gap: for every materialized object target, every literal C prerequisite is
classified as either exact pinned-archive source or a materialized build-tree C
pathname. An object depending on C that is absent from both surfaces fails
closed.
"""

from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path, PurePosixPath
import re
import sys

HERE = Path(__file__).resolve().parent
PROBE_PATH = HERE / "runtime_generated_source_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-generated-source-makefile-guard-proof/1"
SAFE_LITERAL_RE = re.compile(r"^[A-Za-z0-9_./+@-]+$")


class GeneratedSourceMakefileGuardError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise GeneratedSourceMakefileGuardError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PROBE = load_module("ordax_generated_source_probe_for_makefile_guard", PROBE_PATH)


def logical_lines(text: str) -> list[str]:
    values: list[str] = []
    current = ""
    for physical in text.splitlines():
        if current:
            current += physical.lstrip()
        else:
            current = physical
        stripped = current.rstrip()
        if stripped.endswith("\\"):
            current = stripped[:-1] + " "
            continue
        values.append(current)
        current = ""
    if current:
        raise GeneratedSourceMakefileGuardError("generated Makefile ends in an unterminated continuation")
    return values


def safe_literal(value: str, label: str) -> str:
    if not SAFE_LITERAL_RE.fullmatch(value):
        raise GeneratedSourceMakefileGuardError(f"unsafe {label}: {value!r}")
    pure = PurePosixPath(value)
    if pure.is_absolute() or not pure.parts:
        raise GeneratedSourceMakefileGuardError(f"unsafe absolute/empty {label}: {value!r}")
    return pure.as_posix()


def parse_rules(text: str) -> list[dict]:
    rules: list[dict] = []
    for line in logical_lines(text):
        if not line or line[0].isspace() or line.startswith("#") or ":" not in line:
            continue
        colon = line.find(":")
        equals = line.find("=")
        if equals >= 0 and equals < colon + 2:  # assignments including :=
            continue
        lhs, rhs = line[:colon].strip(), line[colon + 1:].strip()
        if not lhs:
            continue
        targets = [token for token in lhs.split() if "$" not in token and "%" not in token]
        prerequisites = [
            token for token in rhs.split()
            if token != "|" and "$" not in token and "%" not in token and not token.startswith("#")
        ]
        if not targets:
            continue
        rules.append({"targets": targets, "prerequisites": prerequisites})
    return rules


def normalize_source_reference(value: str, archive_root: str) -> str | None:
    """Map a Makefile C prerequisite to an archive-relative path when possible."""
    raw = value.replace("\\", "/")
    marker = f"wine-source/{archive_root}/"
    if marker in raw:
        suffix = raw.split(marker, 1)[1]
        pure = PurePosixPath(suffix)
        if not pure.is_absolute() and ".." not in pure.parts and pure.parts:
            return pure.as_posix()
        return None
    pure = PurePosixPath(raw)
    if pure.is_absolute():
        return None
    parts: list[str] = []
    for part in pure.parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if parts:
                parts.pop()
            else:
                return None
        else:
            parts.append(part)
    if not parts:
        return None
    return PurePosixPath(*parts).as_posix()


def materialized_object(target: str, build_root: Path) -> bool:
    if not target.endswith(".o") or "$" in target or "%" in target:
        return False
    pure = PurePosixPath(target)
    if pure.is_absolute() or ".." in pure.parts or not pure.parts:
        return False
    path = build_root.joinpath(*pure.parts)
    return path.is_file() or path.is_symlink()


def validate_compiled_c_graph(
    makefile_text: str,
    build_root: Path,
    archive_entries: dict[str, dict],
    materialized_c_paths: set[str],
    archive_root: str,
) -> dict:
    rules = parse_rules(makefile_text)
    if not rules:
        raise GeneratedSourceMakefileGuardError("generated Makefile produced no parseable rules")

    built_object_rules = 0
    c_edges = 0
    archive_edges = 0
    generated_edges = 0
    unique_c: set[str] = set()
    generated_c: set[str] = set()
    unresolved: list[dict] = []

    for rule in rules:
        built_targets = [target for target in rule["targets"] if materialized_object(target, build_root)]
        if not built_targets:
            continue
        built_object_rules += 1
        for prerequisite in rule["prerequisites"]:
            if not prerequisite.endswith(".c"):
                continue
            c_edges += 1
            unique_c.add(prerequisite)

            # Build-tree C references are relative to wine-output and must have
            # been included in the materialized generated-C scan.
            pure = PurePosixPath(prerequisite)
            if not pure.is_absolute() and ".." not in pure.parts and prerequisite in materialized_c_paths:
                generated_edges += 1
                generated_c.add(prerequisite)
                continue

            source_rel = normalize_source_reference(prerequisite, archive_root)
            if source_rel is not None and source_rel in archive_entries:
                archive_edges += 1
                continue

            # A direct archive-relative source path can appear without an
            # explicit wine-source prefix.
            if not pure.is_absolute() and ".." not in pure.parts and prerequisite in archive_entries:
                archive_edges += 1
                continue

            unresolved.append({
                "objects": sorted(built_targets),
                "c_prerequisite": prerequisite,
            })

    if built_object_rules == 0 or c_edges == 0:
        raise GeneratedSourceMakefileGuardError("generated Makefile produced no built object C dependency graph")
    if unresolved:
        preview = ", ".join(
            f"{item['objects'][0]} <- {item['c_prerequisite']}" for item in unresolved[:10]
        )
        suffix = "" if len(unresolved) <= 10 else f" (+{len(unresolved) - 10} more)"
        raise GeneratedSourceMakefileGuardError(
            f"built objects depend on C outside archive/materialized build inventory: {preview}{suffix}"
        )
    if c_edges != archive_edges + generated_edges:
        raise GeneratedSourceMakefileGuardError("compiled C graph accounting does not balance")

    return {
        "makefile_rule_count": len(rules),
        "built_object_rules": built_object_rules,
        "compiled_c_edges": c_edges,
        "archive_source_c_edges": archive_edges,
        "materialized_generated_c_edges": generated_edges,
        "unique_compiled_c_prerequisites": len(unique_c),
        "unique_generated_c_prerequisites": len(generated_c),
        "generated_c_prerequisites": sorted(generated_c),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check"])
    parser.parse_args()
    contract = PROBE.load_contract()
    inspection = contract["inspection"]
    for key in (
        "generated_makefile_c_target_graph_required",
        "built_object_dependency_check_required",
        "every_built_object_c_prerequisite_accounted",
        "unreferenced_materialized_generated_c_allowed",
    ):
        if inspection.get(key) is not True:
            raise GeneratedSourceMakefileGuardError(f"generated Makefile guard contract drifted: {key}")
    if inspection.get("unmaterialized_c_prerequisite_for_built_object_allowed") is not False:
        raise GeneratedSourceMakefileGuardError("generated Makefile missing-C boundary drifted")
    print("windows compatibility generated C Makefile graph guard: PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (GeneratedSourceMakefileGuardError, PROBE.GeneratedSourceProofError) as exc:
        print(f"windows-compat-runtime-generated-source-makefile-guard: {exc}", file=sys.stderr)
        raise SystemExit(2)
