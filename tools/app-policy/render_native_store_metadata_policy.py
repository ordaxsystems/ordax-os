#!/usr/bin/env python3
"""Generate Native metadata-query allowlist from the canonical component policy.

This grants only the ability to ASK the signed helper for verified current/pending
state; it never authorizes runtime module reads, health writes, install or launch.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / "docs/contracts/runtime-component-package.json"
OUTPUT = ROOT / "system/surface/runtime/native_store_metadata_policy.py"
APP_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
SOURCE_OWNER = "ordaxsystems/ordax-apps"


class MetadataPolicyError(ValueError):
    pass


def render(payload: dict) -> str:
    if not isinstance(payload, dict) or payload.get("$schema") != "prototype-ordax.runtime-component-package-policy/1":
        raise MetadataPolicyError("canonical runtime component policy is invalid")
    package_sources = payload.get("canonical_package_source_repository_by_component")
    module_ids = payload.get("native_loopback_broker_supported_components")
    health_ids = payload.get("native_loopback_broker_health_mutation_components")
    probation_ids = payload.get("runtime_health_bridge_supported_components")
    if not isinstance(package_sources, dict) or not package_sources:
        raise MetadataPolicyError("canonical package owners are unavailable")
    for component_id, owner in package_sources.items():
        if not isinstance(component_id, str) or not APP_ID_RE.fullmatch(component_id) or owner != SOURCE_OWNER:
            raise MetadataPolicyError("invalid canonical external component package source")
    for ids, label in (
        (module_ids, "Native module read"),
        (health_ids, "Native health mutation"),
        (probation_ids, "Native probation"),
    ):
        if (
            not isinstance(ids, list)
            or not ids
            or any(not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id) for app_id in ids)
            or len(ids) != len(set(ids))
        ):
            raise MetadataPolicyError(f"{label} scope in canonical policy is invalid")
    platform_ids = payload.get("supported_components")
    packaging_only = payload.get("packaging_only_components")
    if (
        not isinstance(platform_ids, list)
        or not isinstance(packaging_only, list)
        or any(not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id) for app_id in platform_ids)
        or any(not isinstance(app_id, str) or not APP_ID_RE.fullmatch(app_id) for app_id in packaging_only)
        or len(platform_ids) != len(set(platform_ids))
        or len(packaging_only) != len(set(packaging_only))
        or not set(packaging_only).issubset(platform_ids)
    ):
        raise MetadataPolicyError("platform component classification is invalid")
    allowed_read = set(package_sources) | (set(platform_ids) - set(packaging_only))
    if not set(module_ids).issubset(allowed_read):
        raise MetadataPolicyError("Native module read must have a canonical executable source owner")
    if not set(health_ids).issubset(module_ids):
        raise MetadataPolicyError("Native health mutation cannot exceed signed module-read scope")
    if not set(probation_ids).issubset(health_ids):
        raise MetadataPolicyError("Native probation cannot exceed health mutation scope")
    if payload.get("runtime_health_bridge_probe_mode") != "import-contract":
        raise MetadataPolicyError("Native probation requires the canonical import-contract probe mode")
    metadata_ids = sorted(set(package_sources) | set(module_ids))

    def format_ids(ids: list[str]) -> str:
        return "\n".join(f'    "{app_id}",' for app_id in ids)

    return (
        "# GENERATED FILE. DO NOT EDIT BY HAND.\n"
        "# Source of truth: docs/contracts/runtime-component-package.json\n"
        "# Generator: tools/app-policy/render_native_store_metadata_policy.py\n"
        "# Metadata queries, verified executable file reads and health mutations have DISTINCT scopes.\n\n"
        "STORE_METADATA_COMPONENT_IDS = frozenset({\n"
        + format_ids(metadata_ids) + "\n})\n\n"
        "NATIVE_MODULE_READ_COMPONENT_IDS = frozenset({\n"
        + format_ids(sorted(module_ids)) + "\n})\n\n"
        "NATIVE_HEALTH_MUTATION_COMPONENT_IDS = frozenset({\n"
        + format_ids(sorted(health_ids)) + "\n})\n\n"
        "NATIVE_PROBATION_COMPONENT_IDS = frozenset({\n"
        + format_ids(sorted(probation_ids)) + "\n})\n"
    )


def render_surface_probation_policy(payload: dict) -> str:
    # The Native and WebKit host consume the same canonical probation scope.
    # This module describes probes; it does not grant install or promote rights.
    render(payload)  # Validate IDs, owner/read/health subsets and probe mode once.
    ids = sorted(payload["runtime_health_bridge_supported_components"])
    members = "\n".join(f'  "{component_id}",' for component_id in ids)
    return (
        "// GENERATED FILE. DO NOT EDIT BY HAND.\n"
        "// Source of truth: docs/contracts/runtime-component-package.json\n"
        "// Generator: tools/app-policy/render_native_store_metadata_policy.py\n\n"
        "export const NATIVE_COMPONENT_PROBATION_IDS = Object.freeze([\n"
        + members + "\n]);\n"
        'export const NATIVE_COMPONENT_PROBE_MODE = "import-contract";\n'
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, default=POLICY)
    parser.add_argument("--out", type=Path, default=OUTPUT)
    parser.add_argument("--surface-out", type=Path, default=ROOT / "system/services/components/probation-policy.generated.mjs")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        payload = json.loads(args.policy.read_text(encoding="utf-8"))
        rendered = render(payload)
        surface_rendered = render_surface_probation_policy(payload)
        if args.check:
            if args.out.read_text(encoding="utf-8") != rendered:
                raise MetadataPolicyError("generated Native Store metadata allowlist drifted from canonical policy")
            if args.surface_out.read_text(encoding="utf-8") != surface_rendered:
                raise MetadataPolicyError("generated Surface probation scope drifted from canonical policy")
        else:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(rendered, encoding="utf-8", newline="\n")
            args.surface_out.parent.mkdir(parents=True, exist_ok=True)
            args.surface_out.write_text(surface_rendered, encoding="utf-8", newline="\n")
    except (OSError, UnicodeError, json.JSONDecodeError, MetadataPolicyError) as exc:
        print("ORDAX_NATIVE_STORE_METADATA_SSOT=FAIL\n" + str(exc), file=sys.stderr)
        return 1
    print("ORDAX_NATIVE_STORE_METADATA_SSOT=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
