import {
  INTELLIGENCE_CONTEXT_SHARE_PORT_SCHEMA,
  validateIntelligenceContextShareAuthorization,
  validateIntelligenceContextShareOffer,
  validateIntelligenceContextShareSelection,
} from "../../contracts/intelligence-context-share.mjs";
import { assertIntelligenceContextGrantBroker } from "../../contracts/intelligence-context-grant.mjs";

function sameTarget(left, right) {
  return left.kind === right.kind && left.id === right.id;
}

export function createIntelligenceContextShare(grantsValue) {
  const grants = assertIntelligenceContextGrantBroker(grantsValue);
  const pendingBySourceApp = new Map();
  let disposed = false;

  const assertAlive = () => {
    if (disposed) throw new Error("Intelligence context share is disposed");
  };

  const revokeRecord = (record) => {
    if (!record) return false;
    return grants.revoke(record.grantId);
  };

  return Object.freeze({
    schema: INTELLIGENCE_CONTEXT_SHARE_PORT_SCHEMA,
    offer(value) {
      assertAlive();
      const offer = validateIntelligenceContextShareOffer(value);
      const previous = pendingBySourceApp.get(offer.sourceAppId) ?? null;
      if (previous) revokeRecord(previous);

      const grant = grants.issue({
        sourceId: offer.sourceId,
        target: offer.target,
        context: offer.context,
        ttlMs: offer.ttlMs,
      });
      const record = Object.freeze({
        sourceAppId: offer.sourceAppId,
        sourceId: offer.sourceId,
        grantId: grant.id,
        target: grant.target,
        displayLabel: offer.displayLabel,
        expiresAt: grant.expiresAt,
      });
      pendingBySourceApp.set(offer.sourceAppId, record);
      return Object.freeze({
        sourceAppId: record.sourceAppId,
        sourceId: record.sourceId,
        target: record.target,
        displayLabel: record.displayLabel,
        expiresAt: record.expiresAt,
      });
    },
    take(value) {
      assertAlive();
      const selection = validateIntelligenceContextShareSelection(value);
      const record = pendingBySourceApp.get(selection.sourceAppId) ?? null;
      if (!record || !sameTarget(record.target, selection.target)) return null;

      try {
        grants.describe(record.grantId);
      } catch {
        pendingBySourceApp.delete(selection.sourceAppId);
        return null;
      }

      pendingBySourceApp.delete(selection.sourceAppId);
      return validateIntelligenceContextShareAuthorization(record);
    },
    revoke(value) {
      assertAlive();
      const authorization = validateIntelligenceContextShareAuthorization(value);
      for (const [sourceAppId, record] of pendingBySourceApp) {
        if (record.grantId === authorization.grantId) {
          pendingBySourceApp.delete(sourceAppId);
          break;
        }
      }
      return grants.revoke(authorization.grantId);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of pendingBySourceApp.values()) revokeRecord(record);
      pendingBySourceApp.clear();
    },
  });
}
