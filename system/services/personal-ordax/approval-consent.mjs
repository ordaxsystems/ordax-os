import {
  INTELLIGENCE_TOOL_GRANT_MAX_TTL_MS,
  assertIntelligenceToolGrantIssuer,
} from "../../contracts/intelligence-tool-grant-authority.mjs";
import { defineIntelligenceTool } from "../../contracts/intelligence-tool.mjs";
import { PERSONAL_APPROVAL_CONSENT_SCHEMA } from "../../contracts/personal-approval-consent.mjs";
import {
  PERSONAL_ORDAX_RUNTIME_SCHEMA,
  validatePersonalOrdaxRuntimeSnapshot,
} from "../../contracts/personal-ordax-store.mjs";

const DEFAULT_GRANT_TTL_MS = 2 * 60 * 1000;
const TOOL_GRANT_EFFECTS = new Set(["read", "write"]);

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Personal approval consent clock must return epoch milliseconds");
  }
  return value;
}

function assertRuntime(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== PERSONAL_ORDAX_RUNTIME_SCHEMA
    || typeof value.getSnapshot !== "function"
    || typeof value.resolveApproval !== "function"
  ) {
    throw new TypeError("Personal approval consent requires a compatible Personal OrdaX runtime");
  }
  validatePersonalOrdaxRuntimeSnapshot(value.getSnapshot());
  return value;
}

function pendingPair(runtime, workItemId, approvalId) {
  const snapshot = validatePersonalOrdaxRuntimeSnapshot(runtime.getSnapshot());
  const item = snapshot.workItems.find((candidate) => candidate.id === workItemId);
  const approval = snapshot.approvals.find((candidate) => candidate.id === approvalId);
  if (
    !item
    || !approval
    || item.state !== "waiting-approval"
    || item.pendingApprovalId !== approvalId
    || approval.workItemId !== workItemId
    || approval.status !== "pending"
  ) {
    throw new Error("Personal approval is no longer pending for this work");
  }
  return { item, approval };
}

export function createPersonalApprovalConsent({
  runtime: runtimeValue,
  grantIssuer: grantIssuerValue,
  toolResolver = () => null,
  now = Date.now,
  grantTtlMs = DEFAULT_GRANT_TTL_MS,
} = {}) {
  const runtime = assertRuntime(runtimeValue);
  const grantIssuer = assertIntelligenceToolGrantIssuer(grantIssuerValue);
  if (typeof toolResolver !== "function") {
    throw new TypeError("Personal approval consent requires a tool resolver");
  }
  if (typeof now !== "function") {
    throw new TypeError("Personal approval consent requires a clock function");
  }
  if (
    !Number.isSafeInteger(grantTtlMs)
    || grantTtlMs < 1_000
    || grantTtlMs > INTELLIGENCE_TOOL_GRANT_MAX_TTL_MS
  ) {
    throw new TypeError("Personal approval consent grant TTL is outside bounds");
  }

  const canApprovePair = (workItemId, approvalId) => {
    let pair;
    try {
      pair = pendingPair(runtime, workItemId, approvalId);
    } catch {
      return false;
    }
    if (!TOOL_GRANT_EFFECTS.has(pair.approval.effect)) return false;
    try {
      const tool = defineIntelligenceTool(toolResolver(pair.approval.toolId));
      const action = tool.actions.find((candidate) => candidate.id === pair.approval.actionId);
      return action?.mode === pair.approval.effect;
    } catch {
      return false;
    }
  };

  return Object.freeze({
    schema: PERSONAL_APPROVAL_CONSENT_SCHEMA,
    canApprove(workItemId, approvalId) {
      return canApprovePair(workItemId, approvalId);
    },
    approve(workItemId, approvalId) {
      const { item, approval } = pendingPair(runtime, workItemId, approvalId);
      if (!TOOL_GRANT_EFFECTS.has(approval.effect)) {
        throw new Error(
          "This approval effect requires a dedicated authority and cannot use an Intelligence tool grant",
        );
      }
      if (!canApprovePair(workItemId, approvalId)) {
        throw new Error("Approval tool/action is unavailable or incompatible with this consent path");
      }

      const approvedAtMs = readClock(now);
      const grant = grantIssuer.issue({
        approvalId: approval.id,
        toolId: approval.toolId,
        action: approval.actionId,
        mode: approval.effect,
        approvedBy: "user",
        ownerKind: item.ownerKind,
        ownerId: item.ownerId,
        spaceId: item.spaceId,
        projectId: item.projectId,
        requestedAt: new Date(approvedAtMs).toISOString(),
        expiresAt: new Date(approvedAtMs + grantTtlMs).toISOString(),
      });

      try {
        const decision = runtime.resolveApproval(workItemId, approvalId, {
          grantRef: grant.grantId,
        });
        if (decision.decision !== "allow") {
          grantIssuer.revoke(grant.grantId);
        }
        return decision;
      } catch (error) {
        grantIssuer.revoke(grant.grantId);
        throw error;
      }
    },
    deny(workItemId, approvalId) {
      pendingPair(runtime, workItemId, approvalId);
      return runtime.resolveApproval(workItemId, approvalId, {
        userDecision: "deny",
      });
    },
  });
}
