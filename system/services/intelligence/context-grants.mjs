import {
  INTELLIGENCE_CONTEXT_GRANT_BROKER_SCHEMA,
  INTELLIGENCE_CONTEXT_GRANT_SCHEMA,
  validateIntelligenceContextGrantDescriptor,
  validateIntelligenceContextGrantId,
  validateIntelligenceContextGrantPayload,
} from "../../contracts/intelligence-context-grant.mjs";
import { validateIntelligenceTaskTarget } from "../../contracts/intelligence-task.mjs";

export const DEFAULT_INTELLIGENCE_CONTEXT_GRANT_TTL_MS = 120_000;
export const MAX_INTELLIGENCE_CONTEXT_GRANT_TTL_MS = 300_000;
const MAX_GRANTS = 64;

function defaultGrantId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw new Error("Secure randomUUID is required for Intelligence context grants");
  }
  return `grant-${uuid.replaceAll("-", "")}`;
}

function validatedTtl(value) {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_INTELLIGENCE_CONTEXT_GRANT_TTL_MS) {
    throw new TypeError("Intelligence context grant TTL is outside its allowed bounds");
  }
  return value;
}

function sameTarget(leftValue, rightValue) {
  const left = validateIntelligenceTaskTarget(leftValue);
  const right = validateIntelligenceTaskTarget(rightValue);
  return left.kind === right.kind && left.id === right.id;
}

export function createIntelligenceContextGrantBroker({
  now = () => Date.now(),
  createGrantId = defaultGrantId,
} = {}) {
  if (typeof now !== "function" || typeof createGrantId !== "function") {
    throw new TypeError("Intelligence context grant broker requires clock and id factories");
  }

  const grants = new Map();
  let disposed = false;

  const assertAlive = () => {
    if (disposed) throw new Error("Intelligence context grant broker is disposed");
  };

  const currentTime = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("Intelligence context grant broker clock is invalid");
    }
    return value;
  };

  const liveRecord = (grantIdValue) => {
    assertAlive();
    const grantId = validateIntelligenceContextGrantId(grantIdValue);
    const record = grants.get(grantId);
    if (!record) {
      throw new Error("Intelligence context grant is unavailable or already consumed");
    }
    if (record.descriptor.expiresAt <= currentTime()) {
      grants.delete(grantId);
      throw new Error("Intelligence context grant has expired");
    }
    return record;
  };

  return Object.freeze({
    schema: INTELLIGENCE_CONTEXT_GRANT_BROKER_SCHEMA,
    issue(value) {
      assertAlive();
      const payload = validateIntelligenceContextGrantPayload(value);
      const ttlMs = validatedTtl(value.ttlMs ?? DEFAULT_INTELLIGENCE_CONTEXT_GRANT_TTL_MS);
      if (grants.size >= MAX_GRANTS) {
        throw new Error("Intelligence context grant broker reached its active grant limit");
      }

      let grantId = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = validateIntelligenceContextGrantId(createGrantId());
        if (!grants.has(candidate)) {
          grantId = candidate;
          break;
        }
      }
      if (grantId === null) {
        throw new Error("Intelligence context grant id collision limit reached");
      }

      const issuedAt = currentTime();
      const expiresAt = issuedAt + ttlMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new TypeError("Intelligence context grant expiry overflowed its bounds");
      }
      const descriptor = validateIntelligenceContextGrantDescriptor({
        schema: INTELLIGENCE_CONTEXT_GRANT_SCHEMA,
        id: grantId,
        sourceId: payload.sourceId,
        target: payload.target,
        expiresAt,
        oneShot: true,
        readOnly: true,
        authority: "none",
        executable: false,
        toolExecution: false,
      });
      grants.set(grantId, Object.freeze({ descriptor, context: payload.context }));
      return descriptor;
    },
    describe(grantId) {
      return liveRecord(grantId).descriptor;
    },
    consume(grantId, { sourceId, target } = {}) {
      const record = liveRecord(grantId);
      if (sourceId !== record.descriptor.sourceId) {
        throw new Error("Intelligence context grant source does not match");
      }
      if (!sameTarget(target, record.descriptor.target)) {
        throw new Error("Intelligence context grant target does not match");
      }
      grants.delete(record.descriptor.id);
      return record.context;
    },
    revoke(grantIdValue) {
      assertAlive();
      const grantId = validateIntelligenceContextGrantId(grantIdValue);
      return grants.delete(grantId);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      grants.clear();
    },
  });
}
