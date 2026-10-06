#!/usr/bin/env python3
"""System-owned bridge from component probation receipts to Native health state."""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from native_component_slots import (
    ComponentHealthRecord,
    ComponentSlotError,
    record_component_pending_health,
)

PROBATION_SCHEMA = "ordax.component-probation-result/1"
PROBE_MODE = "import-contract"
SUPPORTED_COMPONENTS = frozenset({"internet", "notes"})


class ComponentProbationReceiptError(ValueError):
    pass


@dataclass(frozen=True)
class ComponentProbationOutcome:
    actionable: bool
    recorded: ComponentHealthRecord | None
    reason: str


def record_system_component_probation(
    *,
    payload: object,
    expected_nonce: str,
    helper_path: str,
    slot_root: str,
) -> ComponentProbationOutcome:
    if not isinstance(expected_nonce, str) or not expected_nonce:
        raise ComponentProbationReceiptError("component probation nonce is unavailable")
    if not isinstance(payload, dict) or set(payload) != {"type", "nonce", "result"}:
        raise ComponentProbationReceiptError("invalid component probation message")
    nonce = payload.get("nonce")
    if not isinstance(nonce, str) or not secrets.compare_digest(nonce, expected_nonce):
        raise ComponentProbationReceiptError("invalid component probation receipt nonce")

    result = payload.get("result")
    if not isinstance(result, dict):
        raise ComponentProbationReceiptError("invalid component probation receipt")
    if result.get("schema") != PROBATION_SCHEMA:
        raise ComponentProbationReceiptError("invalid component probation receipt schema")
    component_id = result.get("componentId")
    if component_id not in SUPPORTED_COMPONENTS:
        raise ComponentProbationReceiptError("invalid component probation receipt component")
    if result.get("probeMode") != PROBE_MODE:
        raise ComponentProbationReceiptError("invalid component probation probe mode")

    version = result.get("version")
    source_commit = result.get("sourceCommit")
    revision = result.get("revision")
    health = result.get("health")

    # No complete pending identity means the system had nothing actionable to
    # persist (for example no pending slot, trust unavailable, or metadata
    # rejected before identity resolution).
    if version is None or source_commit is None or revision is None:
        return ComponentProbationOutcome(
            actionable=False,
            recorded=None,
            reason="no-actionable-pending-identity",
        )
    if health not in {"healthy", "failed"}:
        raise ComponentProbationReceiptError("invalid component probation health")

    try:
        record = record_component_pending_health(
            helper_path=helper_path,
            component_id=component_id,
            version=version,
            source_commit=source_commit,
            expected_revision=revision,
            health=health,
            slot_root=slot_root,
        )
    except ComponentSlotError as exc:
        return ComponentProbationOutcome(
            actionable=True,
            recorded=None,
            reason=f"health-recorder-rejected:{exc}",
        )

    return ComponentProbationOutcome(
        actionable=True,
        recorded=record,
        reason="recorded",
    )
