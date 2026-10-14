#!/usr/bin/env python3
"""Generate Native metadata/query and lifecycle gates from component policy SSOT.

The generated module grants only narrowly scoped Native capabilities. Metadata,
verified runtime reads, probation/health mutation and pending-decision execution
remain distinct. Generating a gate does not mount an endpoint or lifecycle owner.
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
PROBE_MODES = frozenset({"import-contract", "mount-contract"})


class MetadataPolicyError(ValueError):
    pass


def _probation_probe_modes(payload: dict, probation_ids: list[str]) -> dict[str, str]:
    modes = payload.get("runtime_health_bridge_probe_mode_by_component")
    if (
        not isinstance(modes, dict)
        or set(modes) != set(probation_ids)
        or any(not isinstance(component_id, str) or not APP_ID_RE.fullmatch(component_id) for component_id in modes)
        or any(mode not in PROBE_MODES for mode in modes.values())
    ):
        raise MetadataPolicyError(
            "Native probation probe modes must exactly cover the canonical probation scope"
        )
    return modes


def _pending_decision_gates(payload: dict) -> tuple[bool, bool, bool, bool]:
    execution_enabled = payload.get("component_promotion_policy_executes_actions")
    slot_activation = payload.get("slot_activation_available")
    pending_promotion = payload.get("pending_health_promotion_available")
    trust_pinned = payload.get("canonical_component_trust_anchor_pinned")
    for value, label in (
        (execution_enabled, "pending-decision execution"),
        (slot_activation, "component-slot activation"),
        (pending_promotion, "pending-health promotion"),
        (trust_pinned, "canonical component trust"),
    ):
        if not isinstance(value, bool):
            raise MetadataPolicyError(f"{label} gate in canonical policy must be boolean")
    if pending_promotion and not slot_activation:
        raise MetadataPolicyError(
            "pending-health promotion cannot exceed component-slot activation"
        )
    if (slot_activation or pending_promotion) and not trust_pinned:
        raise MetadataPolicyError(
            "component activation/promotion requires canonical component trust"
        )
    return execution_enabled, trust_pinned, slot_activation, pending_promotion


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
    probation_modes = _probation_probe_modes(payload, probation_ids)
    execution_enabled, trust_pinned, slot_activation, pending_promotion = _pending_decision_gates(payload)
    metadata_ids = sorted(set(package_sources) | set(module_ids))

    def format_ids(ids: list[str]) -> str:
        return "\n".join(f'    "{app_id}",' for app_id in ids)

    def format_probe_modes(modes: dict[str, str], indent: str = "    ") -> str:
        return "\n".join(
            f'{indent}"{component_id}": "{modes[component_id]}",'
            for component_id in sorted(modes)
        )

    return (
        "# GENERATED FILE. DO NOT EDIT BY HAND.\n"
        "# Source of truth: docs/contracts/runtime-component-package.json\n"
        "# Generator: tools/app-policy/render_native_store_metadata_policy.py\n"
        "# Metadata, runtime reads, health writes and pending decisions have DISTINCT gates.\n\n"
        "from types import MappingProxyType\n\n"
        "STORE_METADATA_COMPONENT_IDS = frozenset({\n"
        + format_ids(metadata_ids) + "\n})\n\n"
        "NATIVE_MODULE_READ_COMPONENT_IDS = frozenset({\n"
        + format_ids(sorted(module_ids)) + "\n})\n\n"
        "NATIVE_HEALTH_MUTATION_COMPONENT_IDS = frozenset({\n"
        + format_ids(sorted(health_ids)) + "\n})\n\n"
        "NATIVE_PROBATION_COMPONENT_IDS = frozenset({\n"
        + format_ids(sorted(probation_ids)) + "\n})\n\n"
        "NATIVE_PROBATION_PROBE_MODE_BY_COMPONENT = MappingProxyType({\n"
        + format_probe_modes(probation_modes) + "\n})\n\n"
        f"NATIVE_PENDING_DECISION_EXECUTION_ENABLED = {execution_enabled!r}\n"
        f"NATIVE_CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED = {trust_pinned!r}\n"
        f"NATIVE_SLOT_ACTIVATION_AVAILABLE = {slot_activation!r}\n"
        f"NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE = {pending_promotion!r}\n"
    )


def render_surface_probation_policy(payload: dict) -> str:
    # The Native and WebKit host consume the same canonical probation scope.
    # This module describes probes; it does not grant install or promote rights.
    render(payload)  # Validate IDs, owner/read/health subsets, probe modes and lifecycle gates once.
    ids = sorted(payload["runtime_health_bridge_supported_components"])
    modes = _probation_probe_modes(payload, ids)
    members = "\n".join(f'  "{component_id}",' for component_id in ids)
    mode_members = "\n".join(
        f'  "{component_id}": "{modes[component_id]}",'
        for component_id in ids
    )
    return (
        "// GENERATED FILE. DO NOT EDIT BY HAND.\n"
        "// Source of truth: docs/contracts/runtime-component-package.json\n"
        "// Generator: tools/app-policy/render_native_store_metadata_policy.py\n\n"
        "export const NATIVE_COMPONENT_PROBATION_IDS = Object.freeze([\n"
        + members + "\n]);\n"
        "export const NATIVE_COMPONENT_PROBE_MODE_BY_ID = Object.freeze({\n"
        + mode_members + "\n});\n"
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
