import {
  INTELLIGENCE_TOOL_GRANT_ISSUER_SCHEMA,
  INTELLIGENCE_TOOL_GRANT_REGISTRY_SCHEMA,
  validateIntelligenceToolGrantIssue,
} from "../../contracts/intelligence-tool-grant-authority.mjs";
import { validateIntelligenceToolGrant } from "../../contracts/intelligence-tool.mjs";

const MAX_SESSION_GRANTS = 64;
const GRANT_ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Intelligence tool grant authority clock must return epoch milliseconds");
  }
  return value;
}

function defaultGrantId(ordinal) {
  return `tool-grant-${ordinal}`;
}

export function createIntelligenceToolGrantAuthority({
  now = Date.now,
  createGrantId = defaultGrantId,
} = {}) {
  if (typeof now !== "function" || typeof createGrantId !== "function") {
    throw new TypeError("Intelligence tool grant authority requires clock and id functions");
  }

  const grants = new Map();
  const grantByApproval = new Map();
  let nextOrdinal = 1;
  let disposed = false;

  const requireActive = () => {
    if (disposed) {
      throw new Error("Intelligence tool grant authority is disposed");
    }
  };

  const removeGrant = (grantId) => {
    const grant = grants.get(grantId);
    if (!grant) return false;
    grants.delete(grantId);
    for (const [approvalId, candidateGrantId] of grantByApproval) {
      if (candidateGrantId === grantId) {
        grantByApproval.delete(approvalId);
        break;
      }
    }
    return true;
  };

  const registry = Object.freeze({
    schema: INTELLIGENCE_TOOL_GRANT_REGISTRY_SCHEMA,
    resolve(grantId) {
      requireActive();
      if (typeof grantId !== "string" || !GRANT_ID_RE.test(grantId)) return null;
      const grant = grants.get(grantId) ?? null;
      if (grant === null) return null;
      if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= readClock(now)) {
        removeGrant(grantId);
        return null;
      }
      return grant;
    },
  });

  const issuer = Object.freeze({
    schema: INTELLIGENCE_TOOL_GRANT_ISSUER_SCHEMA,
    issue(value) {
      requireActive();
      const request = validateIntelligenceToolGrantIssue(value);
      const nowMs = readClock(now);
      const requestedAtMs = Date.parse(request.requestedAt);
      const expiresAtMs = Date.parse(request.expiresAt);
      if (requestedAtMs > nowMs + 30_000) {
        throw new TypeError("Intelligence tool grant approval time is in the future");
      }
      if (expiresAtMs <= nowMs) {
        throw new TypeError("Intelligence tool grant is already expired");
      }
      if (grantByApproval.has(request.approvalId)) {
        throw new Error("Intelligence tool approval already issued a grant");
      }
      if (grants.size >= MAX_SESSION_GRANTS) {
        throw new RangeError("Intelligence tool grant authority reached its session grant limit");
      }

      const grantId = createGrantId(nextOrdinal, request);
      nextOrdinal += 1;
      if (typeof grantId !== "string" || !GRANT_ID_RE.test(grantId) || grants.has(grantId)) {
        throw new TypeError("Intelligence tool grant authority produced an invalid or duplicate id");
      }

      const grant = validateIntelligenceToolGrant({
        grantId,
        toolId: request.toolId,
        action: request.action,
        mode: request.mode,
        approved: true,
        source: "user-approval",
        ownerKind: request.ownerKind,
        ownerId: request.ownerId,
        spaceId: request.spaceId,
        projectId: request.projectId,
        expiresAt: request.expiresAt,
      });
      grants.set(grant.grantId, grant);
      grantByApproval.set(request.approvalId, grant.grantId);
      return grant;
    },
    revoke(grantId) {
      requireActive();
      return removeGrant(grantId);
    },
  });

  return Object.freeze({
    registry,
    issuer,
    dispose() {
      if (disposed) return;
      disposed = true;
      grants.clear();
      grantByApproval.clear();
    },
  });
}
