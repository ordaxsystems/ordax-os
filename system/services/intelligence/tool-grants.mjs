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
  const issuedApprovals = new Set();
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
    return true;
  };

  const pruneExpired = (nowMs) => {
    for (const [grantId, grant] of grants) {
      if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= nowMs) {
        removeGrant(grantId);
      }
    }
  };

  const registry = Object.freeze({
    schema: INTELLIGENCE_TOOL_GRANT_REGISTRY_SCHEMA,
    resolve(grantId) {
      requireActive();
      if (typeof grantId !== "string" || !GRANT_ID_RE.test(grantId)) return null;
      const grant = grants.get(grantId) ?? null;
      if (grant === null) return null;
      const nowMs = readClock(now);
      if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= nowMs) {
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
      pruneExpired(nowMs);
      if (issuedApprovals.has(request.approvalId)) {
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
        approvalId: request.approvalId,
        toolId: request.toolId,
        action: request.action,
        mode: request.mode,
        approved: true,
        source: "user-approval",
        ownerKind: request.ownerKind,
        ownerId: request.ownerId,
        spaceId: request.spaceId,
        projectId: request.projectId,
        resourceRef: request.resourceRef,
        expiresAt: request.expiresAt,
      });
      grants.set(grant.grantId, grant);
      issuedApprovals.add(request.approvalId);
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
      issuedApprovals.clear();
    },
  });
}
