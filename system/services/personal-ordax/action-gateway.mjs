import {
  ACTION_GATEWAY_SCHEMA,
  validateActionRequest,
} from "../../contracts/action-gateway.mjs";
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
    actionId: request.actionId,
    effect: request.effect,
    decision: outcome,
    authoritySource,
    grantRef,
    reason,
    decidedAt,
  });
}

export function createPersonalOrdaxActionGateway({
  toolResolver,
  grantResolver,
  readPolicy = null,
  now = Date.now,
} = {}) {
  if (typeof toolResolver !== "function" || typeof grantResolver !== "function") {
    throw new TypeError("Personal OrdaX Action Gateway requires tool and grant resolvers");
  }
  if (readPolicy !== null && typeof readPolicy !== "function") {
    throw new TypeError("Personal OrdaX Action Gateway read policy must be a function");
  }
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

      if (request.effect === "external-egress" || request.effect === "device-control") {
        return decision(request, {
          decision: "deny",
          authoritySource: "intelligence-tool-grant",
          reason: "Intelligence tool grants cannot authorize egress or device-control effects.",
          decidedAt,
        });
      }

      if (grantRef == null || grantRef === "") {
        if (request.effect === "read" && readPolicy?.(request) === true) {
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
          reason: "Explicit scoped grant is required before this action can execute.",
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
          reason: "Grant does not match the exact approval, owner, context, resource, tool artifact, action and effect.",
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
