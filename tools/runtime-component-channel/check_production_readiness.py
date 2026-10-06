#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

TRUST_POLICY = Path("docs/contracts/runtime-component-trust-policy.json")
PACKAGE_POLICY = Path("docs/contracts/runtime-component-package.json")

TRUST_POLICY_SCHEMA = "prototype-ordax.runtime-component-trust-policy/1"
PACKAGE_POLICY_SCHEMA = "prototype-ordax.runtime-component-package-policy/1"
TRUST_DOMAIN = "runtime-components"
KEY_ID = "ordax-runtime-components-v1"

BLOCKERS = {
    "canonical_component_trust_anchor_pinned": "canonical-runtime-component-trust-anchor-not-pinned",
    "component_publish_allowed": "component-publication-not-authorized",
    "production_component_slot_activation_allowed": "production-component-slot-activation-not-authorized",
}


class ReadinessError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ReadinessError(message)


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"cannot load {label}: {exc}")
    if not isinstance(value, dict):
        fail(f"{label} must contain one JSON object")
    return value


def evaluate(root: Path) -> dict:
    trust = load_json(root / TRUST_POLICY, "runtime-component trust policy")
    package = load_json(root / PACKAGE_POLICY, "runtime-component package policy")

    if trust.get("$schema") != TRUST_POLICY_SCHEMA:
        fail("runtime-component trust policy schema drifted")
    if package.get("$schema") != PACKAGE_POLICY_SCHEMA:
        fail("runtime-component package policy schema drifted")
    if trust.get("trust_domain") != TRUST_DOMAIN or package.get("trust_domain") != TRUST_DOMAIN:
        fail("runtime-component trust domain drifted")
    if trust.get("key_id") != KEY_ID:
        fail("runtime-component trust key id drifted")

    gates = trust.get("current_gates")
    if not isinstance(gates, dict):
        fail("runtime-component trust policy gates are missing")
    for name in BLOCKERS:
        if not isinstance(gates.get(name), bool):
            fail(f"runtime-component trust gate must be boolean: {name}")

    anchor = gates["canonical_component_trust_anchor_pinned"]
    publish = gates["component_publish_allowed"]
    activate = gates["production_component_slot_activation_allowed"]

    if publish and not anchor:
        fail("component publication cannot be authorized before canonical trust")
    if activate and not publish:
        fail("production component-slot activation cannot be authorized before publication")

    if package.get("canonical_component_trust_anchor_pinned") is not anchor:
        fail("package policy canonical trust state disagrees with trust policy")
    if package.get("publish_allowed") is not publish:
        fail("package policy publication state disagrees with trust policy")
    if package.get("slot_activation_available") is not activate:
        fail("package policy activation state disagrees with trust policy")

    required_foundation = {
        "signature_required_before_activation": True,
        "activation_allowed_from_unsigned_candidate": False,
        "direct_activation_allowed_from_signed_package": False,
        "pending_health_required_before_promotion": True,
        "immutable_slot_staging_available": True,
        "activation_state_machine_available": True,
        "activation_state_revalidates_signed_slots": True,
        "activation_state_requires_component_slot_release_mode": True,
        "verified_runtime_file_read_available": True,
        "runtime_file_read_revalidates_slot_and_hash": True,
        "runtime_health_bridge_available": True,
        "component_promotion_policy_available": True,
        "component_promotion_policy_requires_canonical_trust_for_promote": True,
        "component_promotion_policy_requires_activation_gate_for_promote": True,
        "whole_os_release_trust_may_be_implicitly_reused": False,
    }
    for field, expected in required_foundation.items():
        if package.get(field) is not expected:
            fail(f"runtime-component package foundation drifted: {field}")

    if activate:
        activation_requirements = {
            "pending_health_promotion_available": True,
            "rollback_slot_activation_available": True,
            "native_slot_serving_available": True,
        }
        for field, expected in activation_requirements.items():
            if package.get(field) is not expected:
                fail(
                    "production activation is authorized but package runtime capability "
                    f"is not ready: {field}"
                )

    blockers = [
        blocker
        for gate, blocker in BLOCKERS.items()
        if gates[gate] is False
    ]

    if activate and blockers:
        fail("production activation cannot be authorized with unresolved blockers")
    if not activate and not blockers:
        fail("production activation is disabled without any declared blocker")

    return {
        "authorized": activate,
        "anchor_pinned": anchor,
        "publication_allowed": publish,
        "activation_allowed": activate,
        "blockers": blockers,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only runtime-component production readiness checker."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Repository root containing docs/contracts.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        result = evaluate(args.root.resolve())
    except ReadinessError as exc:
        raise SystemExit(f"RUNTIME_COMPONENT_PRODUCTION_READINESS=FAIL\n{exc}")

    print("RUNTIME_COMPONENT_PRODUCTION_READINESS=PASS")
    print(
        "CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED="
        + ("YES" if result["anchor_pinned"] else "NO")
    )
    print(
        "COMPONENT_PUBLISH_ALLOWED="
        + ("YES" if result["publication_allowed"] else "NO")
    )
    print(
        "PRODUCTION_COMPONENT_SLOT_ACTIVATION_ALLOWED="
        + ("YES" if result["activation_allowed"] else "NO")
    )
    for blocker in result["blockers"]:
        print(f"BLOCKER={blocker}")


if __name__ == "__main__":
    main()
