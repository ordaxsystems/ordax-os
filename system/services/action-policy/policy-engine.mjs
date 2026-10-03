import {
  ACTION_POLICY_PORT_SCHEMA,
  validateActionPolicyRule,
  validateActionPolicyVerdict,
} from "../../contracts/action-policy.mjs";
import { validateActionRequest } from "../../contracts/action-gateway.mjs";

const RESTRICTIVENESS = new Map([
  ["allow-if-authorized", 0],
  ["approval-required", 1],
  ["handoff-to-user", 2],
  ["deny", 3],
]);

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
      let outcome = "allow-if-authorized";
      for (const rule of matched) {
        if (RESTRICTIVENESS.get(rule.outcome) > RESTRICTIVENESS.get(outcome)) {
          outcome = rule.outcome;
        }
      }

      const reason = matched.length === 0
        ? "No restrictive policy rule matched; existing authority is still required."
        : `Most restrictive matching policy outcome is ${outcome}.`;

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
