#!/usr/bin/env python3
"""Platform lifecycle owner for exact pending-component decisions.

This module is deliberately not mounted by the Native host yet. It consumes only
canonical authority-free decision plans produced by the component probation /
promotion policy path and delegates mutation to native_component_pending_decision.
Execution gates come exclusively from the generated Native projection of
runtime-component-package.json; callers cannot supply or override them.
"""

from __future__ import annotations

from dataclasses import dataclass
import re

from native_component_pending_decision import (
    ComponentPendingDecisionError,
    promote_component_pending,
    reject_component_pending,
)
from native_store_metadata_policy import (
    NATIVE_PENDING_DECISION_EXECUTION_ENABLED,
    NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE,
    NATIVE_PROBATION_COMPONENT_IDS,
    NATIVE_SLOT_ACTIVATION_AVAILABLE,
)

PLAN_SCHEMA = "ordax.component-pending-decision-plan/1"
RESULT_SCHEMA = "ordax.native-component-pending-decision-owner/1"

_COMPONENT_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_SEMVER_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$"
)
_SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
_REASON_RE = re.compile(r"^[a-z][a-z0-9-]{0,127}$")
_ACTIONS = frozenset({"hold", "reject", "promote"})
_HEALTH = frozenset({"healthy", "failed"})
_PLAN_FIELDS = frozenset({
    "schema",
    "componentId",
    "version",
    "sourceCommit",
    "revision",
    "health",
    "action",
    "reason",
    "authority",
})


class ComponentPendingDecisionOwnerError(RuntimeError):
    pass


@dataclass(frozen=True)
class ComponentPendingDecisionOwnerResult:
    schema: str
    component_id: str
    version: str
    source_commit: str
    revision: int
    action: str
    state: str
    mutated: bool
    reason: str


def _validate_plan(value: object) -> dict:
    if not isinstance(value, dict) or frozenset(value) != _PLAN_FIELDS:
        raise ComponentPendingDecisionOwnerError(
            "component pending decision plan fields are not canonical"
        )
    if value.get("schema") != PLAN_SCHEMA or value.get("authority") != "none":
        raise ComponentPendingDecisionOwnerError(
            "component pending decision plan schema/authority is invalid"
        )

    component_id = value.get("componentId")
    version = value.get("version")
    source_commit = value.get("sourceCommit")
    revision = value.get("revision")
    health = value.get("health")
    action = value.get("action")
    reason = value.get("reason")

    if (
        not isinstance(component_id, str)
        or component_id not in NATIVE_PROBATION_COMPONENT_IDS
        or _COMPONENT_RE.fullmatch(component_id) is None
    ):
        raise ComponentPendingDecisionOwnerError(
            "unsupported component pending decision plan"
        )
    if not isinstance(version, str) or _SEMVER_RE.fullmatch(version) is None:
        raise ComponentPendingDecisionOwnerError(
            "component pending decision version is invalid"
        )
    if not isinstance(source_commit, str) or _SHA40_RE.fullmatch(source_commit) is None:
        raise ComponentPendingDecisionOwnerError(
            "component pending decision source commit is invalid"
        )
    if (
        not isinstance(revision, int)
        or isinstance(revision, bool)
        or revision <= 0
    ):
        raise ComponentPendingDecisionOwnerError(
            "component pending decision revision is invalid"
        )
    if health not in _HEALTH or action not in _ACTIONS:
        raise ComponentPendingDecisionOwnerError(
            "component pending decision health/action is invalid"
        )
    if not isinstance(reason, str) or _REASON_RE.fullmatch(reason) is None:
        raise ComponentPendingDecisionOwnerError(
            "component pending decision reason is invalid"
        )

    if action == "reject" and health != "failed":
        raise ComponentPendingDecisionOwnerError(
            "component pending rejection requires failed health"
        )
    if action == "promote" and health != "healthy":
        raise ComponentPendingDecisionOwnerError(
            "component pending promotion requires healthy health"
        )
    if action == "hold" and health != "healthy":
        raise ComponentPendingDecisionOwnerError(
            "failed probation cannot be converted into a hold"
        )

    return {
        "component_id": component_id,
        "version": version,
        "source_commit": source_commit,
        "revision": revision,
        "health": health,
        "action": action,
        "reason": reason,
    }


def _result(plan: dict, *, state: str, mutated: bool, reason: str, revision: int | None = None):
    return ComponentPendingDecisionOwnerResult(
        schema=RESULT_SCHEMA,
        component_id=plan["component_id"],
        version=plan["version"],
        source_commit=plan["source_commit"],
        revision=plan["revision"] if revision is None else revision,
        action=plan["action"],
        state=state,
        mutated=mutated,
        reason=reason,
    )


def execute_component_pending_decision_plan(
    raw_plan: object,
    *,
    helper_path: str,
    trust_path: str,
    slot_root: str,
    timeout_seconds: float = 3.0,
) -> ComponentPendingDecisionOwnerResult:
    """Validate one exact plan and apply it only when canonical gates permit.

    `hold` is always non-mutating. `reject` and `promote` remain blocked while
    the canonical promotion policy is planning-only. Promotion additionally
    requires both canonical component-slot activation and pending-health
    promotion gates. No caller argument can override those gates.
    """

    plan = _validate_plan(raw_plan)
    action = plan["action"]

    if action == "hold":
        return _result(
            plan,
            state="held",
            mutated=False,
            reason=plan["reason"],
        )

    if not NATIVE_PENDING_DECISION_EXECUTION_ENABLED:
        return _result(
            plan,
            state="blocked",
            mutated=False,
            reason="pending-decision-execution-disabled",
        )

    if action == "promote" and not (
        NATIVE_SLOT_ACTIVATION_AVAILABLE
        and NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE
    ):
        return _result(
            plan,
            state="blocked",
            mutated=False,
            reason="component-promotion-gates-closed",
        )

    try:
        if action == "reject":
            applied = reject_component_pending(
                helper_path=helper_path,
                component_id=plan["component_id"],
                version=plan["version"],
                source_commit=plan["source_commit"],
                expected_revision=plan["revision"],
                slot_root=slot_root,
                timeout_seconds=timeout_seconds,
            )
        else:
            applied = promote_component_pending(
                helper_path=helper_path,
                trust_path=trust_path,
                component_id=plan["component_id"],
                version=plan["version"],
                source_commit=plan["source_commit"],
                expected_revision=plan["revision"],
                slot_root=slot_root,
                timeout_seconds=timeout_seconds,
            )
    except ComponentPendingDecisionError as exc:
        raise ComponentPendingDecisionOwnerError(
            "runtime component pending decision mutation failed closed"
        ) from exc

    if applied.action != action:
        raise ComponentPendingDecisionOwnerError(
            "runtime component pending decision adapter action drifted"
        )

    return _result(
        plan,
        state="applied",
        mutated=True,
        reason=plan["reason"],
        revision=applied.revision,
    )
