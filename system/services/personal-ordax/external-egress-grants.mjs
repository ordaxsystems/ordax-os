import {
  EXTERNAL_EGRESS_GRANT_ISSUER_SCHEMA,
  EXTERNAL_EGRESS_GRANT_REGISTRY_SCHEMA,
  validateExternalEgressGrant,
  validateExternalEgressGrantIssue,
} from "../../contracts/external-egress-grant.mjs";

const MAX_SESSION_GRANTS = 64;
const GRANT_ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("External egress grant authority clock must return epoch milliseconds");
  }
  return value;
}

function defaultGrantId(ordinal) {
  return `egress-grant-${ordinal}`;
}

export function createExternalEgressGrantAuthority({
  now = Date.now,
  createGrantId = defaultGrantId,
} = {}) {
  if (typeof now !== "function" || typeof createGrantId !== "function") {
    throw new TypeError("External egress grant authority requires clock and id functions");
  }

  const grants = new Map();
  const issuedApprovals = new Set();
  let nextOrdinal = 1;
  let disposed = false;

  const requireActive = () => {
    if (disposed) throw new Error("External egress grant authority is disposed");
  };

  const removeGrant = (grantId) => {
    const grant = grants.get(grantId);
    if (!grant) return false;
    grants.delete(grantId);
    return true;
  };

  const pruneExpired = (nowMs) => {
    for (const [grantId, grant] of grants) {
      if (Date.parse(grant.expiresAt) <= nowMs) removeGrant(grantId);
    }
  };

  const registry = Object.freeze({
    schema: EXTERNAL_EGRESS_GRANT_REGISTRY_SCHEMA,
    resolve(grantId) {
      requireActive();
      if (typeof grantId !== "string" || !GRANT_ID_RE.test(grantId)) return null;
      const nowMs = readClock(now);
      pruneExpired(nowMs);
      return grants.get(grantId) ?? null;
    },
  });

  const issuer = Object.freeze({
    schema: EXTERNAL_EGRESS_GRANT_ISSUER_SCHEMA,
    issue(value) {
      requireActive();
      const request = validateExternalEgressGrantIssue(value);
      const nowMs = readClock(now);
      const requestedAtMs = Date.parse(request.requestedAt);
      const expiresAtMs = Date.parse(request.expiresAt);
      if (requestedAtMs > nowMs + 30_000) {
        throw new TypeError("External egress approval time is in the future");
      }
      if (expiresAtMs <= nowMs) {
        throw new TypeError("External egress grant is already expired");
      }

      pruneExpired(nowMs);
      if (issuedApprovals.has(request.approvalId)) {
        throw new Error("External egress approval already issued a grant");
      }
      if (grants.size >= MAX_SESSION_GRANTS) {
        throw new RangeError("External egress grant authority reached its session grant limit");
      }

      const grantId = createGrantId(nextOrdinal, request);
      nextOrdinal += 1;
      if (typeof grantId !== "string" || !GRANT_ID_RE.test(grantId) || grants.has(grantId)) {
        throw new TypeError("External egress grant authority produced an invalid or duplicate id");
      }

      const grant = validateExternalEgressGrant({
        grantId,
        workItemId: request.workItemId,
        approvalId: request.approvalId,
        toolId: request.toolId,
        toolArtifactSha256: request.toolArtifactSha256,
        actionId: request.actionId,
        effect: "external-egress",
        ownerKind: request.ownerKind,
        ownerId: request.ownerId,
        spaceId: request.spaceId,
        projectId: request.projectId,
        resourceRef: request.resourceRef,
        destinations: request.destinations,
        maxRequests: request.maxRequests,
        maxExternalBytes: request.maxExternalBytes,
        maxCostUsd: request.maxCostUsd,
        deadlineMs: request.deadlineMs,
        approvedBy: "user",
        issuedAt: new Date(nowMs).toISOString(),
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
