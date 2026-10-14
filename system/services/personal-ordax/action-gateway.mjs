import {
  ACTION_GATEWAY_SCHEMA,
  validateActionRequest,
} from "../../contracts/action-gateway.mjs";
import {
  assertActionPolicyPort,
  validateActionPolicyVerdict,
} from "../../contracts/action-policy.mjs";
import {
  assertActionReviewPort,
  validateActionReviewVerdict,
} from "../../contracts/action-review.mjs";
import { validateExternalEgressGrant } from "../../contracts/external-egress-grant.mjs";
import {
  authorizeIntelligenceToolAction,
  defineIntelligenceTool,
  validateIntelligenceToolGrant,
} from "../../contracts/intelligence-tool.mjs";
import { validatePersonalActionDecision } from "../../contracts/personal-ordax.mjs";

function sameNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

function grantModeForEffect(effect) {
  return effect === "read" ? "read" : "write";
}

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Action Gateway clock must return a non-negative epoch millisecond");
  }
  return value;
}

function decision(request, {
  decision: outcome,
  authoritySource,
  grantRef = null,
  reason,
  decidedAt,
}) {
  return validatePersonalActionDecision({
    workItemId: request.workItemId,
    approvalId: request.approvalId,
    actionId: request.actionId,
    effect: request.effect,
    decision: outcome,
    authoritySource,
    grantRef,
    reason,
    decidedAt,
  });
}

function exactEgressScope(grant, request, grantRef) {
  return grant.grantId === grantRef
    && grant.workItemId === request.workItemId
    && request.approvalId !== null
    && grant.approvalId === request.approvalId
    && grant.toolId === request.toolId
    && grant.toolArtifactSha256 === request.toolArtifactSha256
    && grant.actionId === request.actionId
    && grant.effect === "external-egress"
    && grant.ownerKind === request.ownerKind
    && sameNullable(grant.ownerId, request.ownerId)
    && sameNullable(grant.spaceId, request.spaceId)
    && sameNullable(grant.projectId, request.projectId)
    && grant.resourceRef === request.resourceRef;
}

export function createPersonalOrdaxActionGateway({
  toolResolver,
  grantResolver,
  externalEgressGrantResolver = null,
  readPolicy = null,
  actionPolicyPort = null,
  actionReviewPort = null,
  now = Date.now,
} = {}) {
  if (typeof toolResolver !== "function" || typeof grantResolver !== "function") {
    throw new TypeError("Personal OrdaX Action Gateway requires tool and grant resolvers");
  }
  if (externalEgressGrantResolver !== null && typeof externalEgressGrantResolver !== "function") {
    throw new TypeError("Personal OrdaX Action Gateway external egress grant resolver must be a function");
  }
  if (readPolicy !== null && typeof readPolicy !== "function") {
    throw new TypeError("Personal OrdaX Action Gateway read policy must be a function");
  }
  const actionPolicy = actionPolicyPort === null ? null : assertActionPolicyPort(actionPolicyPort);
  const actionReview = actionReviewPort === null ? null : assertActionReviewPort(actionReviewPort);
  if (typeof now !== "function") {
    throw new TypeError("Personal OrdaX Action Gateway requires a clock function");
  }

  return Object.freeze({
    schema: ACTION_GATEWAY_SCHEMA,
    decide(requestValue, { grantRef = null, userDecision = null } = {}) {
      const request = validateActionRequest(requestValue);
      const decidedAtMs = readClock(now);
      const decidedAt = new Date(decidedAtMs).toISOString();

      if (userDecision !== null && userDecision !== "deny") {
        throw new TypeError("Action Gateway user decision is invalid");
      }
      if (userDecision === "deny" && grantRef != null && grantRef !== "") {
        throw new TypeError("Denied action must not carry an execution grant");
      }
      if (userDecision === "deny") {
        return decision(request, {
          decision: "deny",
          authoritySource: "user-grant",
          reason: "User explicitly denied this action.",
          decidedAt,
        });
      }

      let policyOutcome = "allow-if-authorized";
      if (actionPolicy !== null) {
        try {
          const verdict = validateActionPolicyVerdict(actionPolicy.evaluate(request));
          if (verdict.workItemId !== request.workItemId || verdict.actionId !== request.actionId) {
            throw new TypeError("Action Policy verdict is not bound to the exact request");
          }
          policyOutcome = verdict.outcome;
        } catch {
          return decision(request, {
            decision: "deny",
            authoritySource: "system-policy",
            reason: "Action policy evaluation failed closed.",
            decidedAt,
          });
        }
      }

      if (policyOutcome === "deny" || policyOutcome === "handoff-to-user") {
        return decision(request, {
          decision: "deny",
          authoritySource: "system-policy",
          reason: policyOutcome === "handoff-to-user"
            ? "Action policy requires this operation to be handed off to the user."
            : "Action policy denies this operation.",
          decidedAt,
        });
      }

      if (actionReview !== null) {
        try {
          const verdict = validateActionReviewVerdict(actionReview.review(request));
          if (verdict.workItemId !== request.workItemId || verdict.actionId !== request.actionId) {
            throw new TypeError("Action Review verdict is not bound to the exact request");
          }
          if (verdict.outcome === "block" || verdict.outcome === "needs-human") {
            return decision(request, {
              decision: "deny",
              authoritySource: "system-policy",
              reason: verdict.outcome === "needs-human"
                ? "Independent action review requires human attention before automation may continue."
                : "Independent action review blocked this operation.",
              decidedAt,
            });
          }
        } catch {
          return decision(request, {
            decision: "deny",
            authoritySource: "system-policy",
            reason: "Action review evaluation failed closed.",
            decidedAt,
          });
        }
      }

      if (request.effect === "device-control") {
        return decision(request, {
          decision: "deny",
          authoritySource: "intelligence-tool-grant",
          reason: "Intelligence tool grants cannot authorize device-control effects.",
          decidedAt,
        });
      }

      if (request.effect === "external-egress") {
        if (externalEgressGrantResolver === null) {
          return decision(request, {
            decision: "deny",
            authoritySource: "user-grant",
            reason: "External egress authority is unavailable in this Action Gateway.",
            decidedAt,
          });
        }
        if (grantRef == null || grantRef === "") {
          return decision(request, {
            decision: "approval-required",
            authoritySource: "user-grant",
            reason: policyOutcome === "approval-required"
              ? "Action policy and external egress both require explicit user approval."
              : "Explicit scoped external egress grant is required before this action can execute.",
            decidedAt,
          });
        }

        let grant;
        try {
          grant = validateExternalEgressGrant(externalEgressGrantResolver(grantRef));
        } catch {
          return decision(request, {
            decision: "deny",
            authoritySource: "user-grant",
            reason: "Referenced external egress grant is unavailable or invalid.",
            decidedAt,
          });
        }

        if (!exactEgressScope(grant, request, grantRef)) {
          return decision(request, {
            decision: "deny",
            authoritySource: "user-grant",
            reason: "External egress grant does not match the exact Work, approval, owner, context, resource, tool artifact and action.",
            decidedAt,
          });
        }

        const expiry = Date.parse(grant.expiresAt);
        if (!Number.isFinite(expiry) || expiry <= decidedAtMs) {
          return decision(request, {
            decision: "deny",
            authoritySource: "user-grant",
            reason: "External egress grant is expired or has an invalid expiry.",
            decidedAt,
          });
        }

        return decision(request, {
          decision: "allow",
          authoritySource: "user-grant",
          grantRef: grant.grantId,
          reason: "Exact scoped external egress grant authorizes this action.",
          decidedAt,
        });
      }

      if (grantRef == null || grantRef === "") {
        if (
          policyOutcome !== "approval-required"
          && request.effect === "read"
          && readPolicy?.(request) === true
        ) {
          return decision(request, {
            decision: "allow",
            authoritySource: "system-policy",
            reason: "Read action allowed by trusted system policy.",
            decidedAt,
          });
        }
        return decision(request, {
          decision: "approval-required",
          authoritySource: "intelligence-tool-grant",
          reason: policyOutcome === "approval-required"
            ? "Action policy requires explicit approval before existing authority may be used."
            : "Explicit scoped grant is required before this action can execute.",
          decidedAt,
        });
      }

      let tool;
      let grant;
      try {
        tool = defineIntelligenceTool(toolResolver(request.toolId));
        grant = validateIntelligenceToolGrant(grantResolver(grantRef));
      } catch {
        return decision(request, {
          decision: "deny",
          authoritySource: "intelligence-tool-grant",
          reason: "Referenced tool or grant is unavailable or invalid.",
          decidedAt,
        });
      }

      const exactScope = grant.grantId === grantRef
        && grant.workItemId === request.workItemId
        && grant.toolArtifactSha256 === request.toolArtifactSha256
        && grant.toolArtifactSha256 === tool.artifactSha256
        && request.approvalId !== null
        && grant.approvalId === request.approvalId
        && grant.toolId === request.toolId
        && grant.action === request.actionId
        && grant.mode === grantModeForEffect(request.effect)
        && grant.ownerKind === request.ownerKind
        && sameNullable(grant.ownerId, request.ownerId)
        && sameNullable(grant.spaceId, request.spaceId)
        && sameNullable(grant.projectId, request.projectId)
        && sameNullable(grant.resourceRef, request.resourceRef);
      if (!exactScope || !authorizeIntelligenceToolAction(tool, grant)) {
        return decision(request, {
          decision: "deny",
          authoritySource: "intelligence-tool-grant",
          reason: "Grant does not match the exact Work, approval, owner, context, resource, tool artifact, action and effect.",
          decidedAt,
        });
      }

      if (grant.expiresAt !== null) {
        const expiry = Date.parse(grant.expiresAt);
        if (!Number.isFinite(expiry) || expiry <= decidedAtMs) {
          return decision(request, {
            decision: "deny",
            authoritySource: "intelligence-tool-grant",
            reason: "Grant is expired or has an invalid expiry.",
            decidedAt,
          });
        }
      }

      return decision(request, {
        decision: "allow",
        authoritySource: "intelligence-tool-grant",
        grantRef: grant.grantId,
        reason: "Exact scoped Intelligence tool grant authorizes this action.",
        decidedAt,
      });
    },
  });
}
