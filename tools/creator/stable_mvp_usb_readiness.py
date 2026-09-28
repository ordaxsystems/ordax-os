#!/usr/bin/env python3
"""Report the single read-only Stable/MVP USB release-readiness state.

This command composes the canonical Nova OrdaX source audit with the physical
promotion preflight. It never reads private signing-key contents, selects a
physical device, records owner consent, invokes a writer, materializes a
destructive candidate, or performs a physical write.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
AUDIT_PATH = Path(__file__).with_name("pre_usb_nova_ordax_audit.py")
PROMOTION_PATH = Path(__file__).with_name("physical_promotion.py")
AUTHORIZATION_PATH = Path("docs/contracts/physical-write-authorization.json")
STATUS_SCHEMA = "prototype-ordax.stable-mvp-usb-readiness/1"
HANDOFF_DOCUMENT = "docs/MVP-PRE-PHYSICAL-HANDOFF.md"
PRE_PROOF_AUTHORIZATION_STATUS = "blocked-canonical-v4-release-proof-pending"

POST_AUTHORIZATION_PHYSICAL_GATES = (
    "physical-target-selection-and-live-revalidation",
    "target-specific-destructive-confirmation-and-windows-uac",
    "physical-write-and-exact-17-artifact-readback",
    "canonical-stable-boot-oobe-surface-and-app-smoke",
    "physical-cold-health-known-good-and-offline-reboot",
    "physical-broken-candidate-rollback-and-recovery",
    "stable-channel-publication-after-physical-proof",
)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


audit = _load("ordax_pre_usb_readiness_audit", AUDIT_PATH)
promotion = _load("ordax_physical_promotion_readiness", PROMOTION_PATH)


def classify(
    source_status: dict[str, Any],
    promotion_status: dict[str, Any],
    authorization_status: str | None = None,
) -> str:
    if source_status.get("source_ready") is not True:
        return "source-blocked"
    # A cryptographically valid receipt may remain in evidence after its release
    # was superseded by source hardening. The authorization state is authoritative
    # for whether that receipt is current enough to advance toward owner consent.
    if authorization_status == PRE_PROOF_AUTHORIZATION_STATUS:
        return "canonical-v4-release-proof-pending"
    if promotion_status.get("canonical_v4_release_proof_valid") is not True:
        return "canonical-v4-release-proof-pending"
    if promotion_status.get("pre_authorization_ready") is not True:
        return "promotion-pre-authorization-blocked"
    if promotion_status.get("ready") is True:
        if promotion_status.get("authorized_candidate_materialization_allowed") is not True:
            return "promotion-state-inconsistent"
        return "authorized-candidate-ready-for-separate-physical-flow"
    if promotion_status.get("owner_authorization_required") is True:
        return "explicit-owner-authorization-pending"
    return "promotion-state-inconsistent"


def remaining_gates(stage: str) -> list[str]:
    """Return the ordered gates still required after the current read-only stage."""

    physical = list(POST_AUTHORIZATION_PHYSICAL_GATES)
    if stage == "source-blocked":
        return ["pre-usb-source-closure"]
    if stage == "canonical-v4-release-proof-pending":
        return [
            "canonical-v4-release-proof",
            "physical-promotion-pre-authorization",
            "explicit-owner-authorization",
            *physical,
        ]
    if stage == "promotion-pre-authorization-blocked":
        return [
            "physical-promotion-pre-authorization",
            "explicit-owner-authorization",
            *physical,
        ]
    if stage == "explicit-owner-authorization-pending":
        return ["explicit-owner-authorization", *physical]
    if stage == "authorized-candidate-ready-for-separate-physical-flow":
        return physical
    return ["repair-promotion-state-consistency"]


def evaluate(repo_root: Path) -> dict[str, Any]:
    root = repo_root.resolve()
    source_status = audit.evaluate(root)
    promotion_status = promotion.evaluate(root)
    authorization = json.loads((root / AUTHORIZATION_PATH).read_text(encoding="utf-8"))
    authorization_status = authorization.get("status")
    proof_requirement_current = (
        isinstance(authorization.get("requirements"), dict)
        and authorization["requirements"].get("canonical_v4_release_proof_bound") is True
    )
    stage = classify(source_status, promotion_status, authorization_status)

    source_blockers = list(source_status.get("blockers", []))
    promotion_blockers = list(promotion_status.get("blockers", []))
    blockers = sorted(set([*source_blockers, *promotion_blockers]))

    source_ready = source_status.get("source_ready") is True
    canonical_proof_valid = promotion_status.get("canonical_v4_release_proof_valid") is True
    canonical_proof_current = (
        canonical_proof_valid
        and authorization_status != PRE_PROOF_AUTHORIZATION_STATUS
        and proof_requirement_current
    )
    owner_authorization_recorded = promotion_status.get("ready") is True

    if stage == "canonical-v4-release-proof-pending":
        next_stage = "canonical-v4-release-proof"
    elif stage == "source-blocked":
        next_stage = "pre-usb-source-closure"
    else:
        next_stage = promotion_status.get("next_stage")

    if canonical_proof_current:
        release_boundary = "pass"
    elif canonical_proof_valid:
        release_boundary = "superseded-replacement-required"
    else:
        release_boundary = "pending"

    return {
        "$schema": STATUS_SCHEMA,
        "status": "ready" if stage == "authorized-candidate-ready-for-separate-physical-flow" else "blocked",
        "stage": stage,
        "source_ready": source_ready,
        "pre_usb_product_source_complete": source_ready,
        "pre_usb_source_audit_status": source_status.get("status"),
        "physical_authorization_status": authorization_status,
        "canonical_v4_release_proof_valid": canonical_proof_valid,
        "canonical_v4_release_proof_current": canonical_proof_current,
        "canonical_v4_release_proof_bound_requirement": proof_requirement_current,
        "canonical_v4_release_binding_resolved": promotion_status.get("canonical_v4_release_binding_resolved") is True,
        "pre_authorization_ready": promotion_status.get("pre_authorization_ready") is True,
        "owner_authorization_required": promotion_status.get("owner_authorization_required") is True,
        "owner_authorization_recorded": owner_authorization_recorded,
        "authorized_candidate_materialization_allowed": promotion_status.get("authorized_candidate_materialization_allowed") is True,
        "next_stage": next_stage,
        "release_sequence": promotion_status.get("release_sequence"),
        "canonical_v4_release_source_commit": promotion_status.get("canonical_v4_release_source_commit"),
        "blockers": blockers,
        "remaining_gates": remaining_gates(stage),
        "handoff_document": HANDOFF_DOCUMENT,
        "proof_boundaries": {
            "pre_usb_product_source": "pass" if source_ready else "blocked",
            "canonical_v4_release_candidate": release_boundary,
            "physical_write_authorization": "pass" if owner_authorization_recorded else "pending",
            "canonical_stable_graphical_session": "requires-physical-proof",
            "canonical_system_runtime": "requires-physical-proof",
            "stable_publication": "requires-separate-post-physical-promotion",
        },
        "physical_target_selected": False,
        "target_specific_destructive_confirmation_recorded": False,
        "writer_invoked": False,
        "physical_write_performed": False,
        "physical_proof_completed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    parser.add_argument("--require-authorized-candidate", action="store_true")
    args = parser.parse_args()

    try:
        status = evaluate(args.repo_root)
    except Exception as exc:
        status = {
            "$schema": STATUS_SCHEMA,
            "status": "blocked",
            "stage": "readiness-evaluation-failed",
            "blockers": ["readiness-evaluation-failed"],
            "remaining_gates": ["repair-readiness-evaluation"],
            "handoff_document": HANDOFF_DOCUMENT,
            "error": str(exc),
            "physical_target_selected": False,
            "writer_invoked": False,
            "physical_write_performed": False,
            "physical_proof_completed": False,
        }

    print(json.dumps(status, indent=2, sort_keys=True))
    if args.require_authorized_candidate and status.get("status") != "ready":
        return 2
    return 0 if status.get("stage") != "readiness-evaluation-failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
