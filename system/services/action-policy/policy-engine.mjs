import {
  ACTION_POLICY_PORT_SCHEMA,
  validateActionPolicyRule,
  validateActionPolicyVerdict,
} from "../../contracts/action-policy.mjs";
import { validateActionRequest } from "../../contracts/action-gateway.mjs";
import { SYSTEM_POLICY_DECISION_SCHEMA } from "../../contracts/system-foundation.mjs";
import { evaluateSystemPolicyDecisions } from "../system-foundation/runtime.mjs";

const SYSTEM_EFFECT_FOR_OUTCOME = Object.freeze({
  "allow-if-authorized": "pass",
  "approval-required": "require-approval",
  "handoff-to-user": "deny",
  deny: "deny",
});

function schemeOf(resourceRef) {
  if (resourceRef == null) return null;
  const index = resourceRef.indexOf(":");
  return index > 0 ? resourceRef.slice(0, index).toLowerCase() : null;
}

function sameNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

function matches(rule, request) {
  return (rule.toolId === null || rule.toolId === request.toolId)
    && (rule.actionId === null || rule.actionId === request.actionId)
    && (rule.effect === null || rule.effect === request.effect)
    && (rule.ownerKind === null || rule.ownerKind === request.ownerKind)
    && (rule.ownerId === null || rule.ownerId === request.ownerId)
    && (rule.spaceId === null || sameNullable(rule.spaceId, request.spaceId))
    && (rule.projectId === null || sameNullable(rule.projectId, request.projectId))
    && (rule.resourceScheme === null || rule.resourceScheme === schemeOf(request.resourceRef));
}

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Action Policy clock must return a non-negative epoch millisecond");
  }
  return value;
}

function systemDecisionForRule(rule) {
  return {
    schema: SYSTEM_POLICY_DECISION_SCHEMA,
    effect: SYSTEM_EFFECT_FOR_OUTCOME[rule.outcome],
    reasonCode: `action-policy.${rule.layer}.${rule.outcome}`,
    source: "action-policy",
  };
}

function actionOutcomeForRootDecision(rootDecision, matched) {
  if (rootDecision.effect === "pass") return "allow-if-authorized";
  if (rootDecision.effect === "require-approval") return "approval-required";

  // Both handoff and hard deny intentionally map to the root `deny` effect.
  // The action specialization keeps the stricter tie-break without inventing
  // a second generic policy hierarchy.
  return matched.some((rule) => rule.outcome === "deny") ? "deny" : "handoff-to-user";
}

export function createActionPolicyEngine({ rules = [], now = Date.now } = {}) {
  if (!Array.isArray(rules) || rules.length > 256) {
    throw new TypeError("Action Policy rules must be a bounded array");
  }
  if (typeof now !== "function") {
    throw new TypeError("Action Policy requires a clock function");
  }

  const validatedRules = Object.freeze(rules.map(validateActionPolicyRule));
  const ids = validatedRules.map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Action Policy rule ids must be unique");
  }

  return Object.freeze({
    schema: ACTION_POLICY_PORT_SCHEMA,
    evaluate(requestValue) {
      const request = validateActionRequest(requestValue);
      const matched = validatedRules.filter((rule) => matches(rule, request));
      const rootDecision = evaluateSystemPolicyDecisions(matched.map(systemDecisionForRule));
      const outcome = actionOutcomeForRootDecision(rootDecision, matched);

      const reason = matched.length === 0
        ? "System policy found no additional restriction; existing action authority is still required."
        : `System policy reduced matching action rules to ${rootDecision.effect}; action outcome is ${outcome}.`;

      return validateActionPolicyVerdict({
        workItemId: request.workItemId,
        actionId: request.actionId,
        outcome,
        authority: "none",
        matchedRuleIds: matched.map((rule) => rule.id),
        reason,
        evaluatedAt: new Date(readClock(now)).toISOString(),
      });
    },
  });
}
