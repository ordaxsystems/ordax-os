import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertEntitlementsPort,
  validateEntitlementDecision,
} from "../../contracts/entitlements.mjs";

export const ACCOUNT_MEMORY_AUTHORIZATION_SCHEMA = "ordax.account-memory-authorization/1";
export const ACCOUNT_MEMORY_CLOUD_ENTITLEMENT = "memory.cloud.enabled";

function expiryState(value, now) {
  if (value == null) return { expiresAt: null, expired: false };
  if (typeof value !== "string" || value.length > 64 || value.includes("\0")) {
    throw new TypeError("Memory sync entitlement expiry is invalid");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError("Memory sync entitlement expiry is invalid");
  }
  const expiresAt = new Date(parsed).toISOString();
  return { expiresAt, expired: parsed <= now().getTime() };
}

export function createAccountMemorySyncAuthorization({
  identitySession,
  entitlementsPort,
  now = () => new Date(),
} = {}) {
  const identity = assertIdentitySessionPort(identitySession);
  const entitlements = assertEntitlementsPort(entitlementsPort);
  if (typeof now !== "function") {
    throw new TypeError("Account Memory authorization requires a clock function");
  }

  let disposed = false;
  let state = "unprepared";
  let subjectId = null;
  let decision = "denied";
  let authority = null;
  let expiresAt = null;
  let generation = 0;

  const invalidate = (identitySnapshot = validateIdentitySessionSnapshot(identity.getSnapshot())) => {
    generation += 1;
    subjectId = identitySnapshot.state === "signed-in" ? identitySnapshot.subjectId : null;
    state = identitySnapshot.state === "signed-in" ? "unprepared" : identitySnapshot.state;
    decision = "denied";
    authority = null;
    expiresAt = null;
  };

  const currentSnapshot = () => Object.freeze({
    schema: ACCOUNT_MEMORY_AUTHORIZATION_SCHEMA,
    state,
    subjectId,
    entitlementKey: ACCOUNT_MEMORY_CLOUD_ENTITLEMENT,
    decision,
    authority,
    expiresAt,
    liveClientIntegration: false,
    productionPromoted: false,
  });

  const unsubscribeIdentity = identity.subscribe((snapshot) => {
    if (disposed) return;
    const normalized = validateIdentitySessionSnapshot(snapshot);
    if (
      normalized.state !== "signed-in"
      || subjectId !== normalized.subjectId
    ) {
      invalidate(normalized);
    }
  });

  return Object.freeze({
    schema: ACCOUNT_MEMORY_AUTHORIZATION_SCHEMA,
    getSnapshot() {
      if (disposed) throw new Error("Account Memory authorization is disposed");
      return currentSnapshot();
    },
    async refresh() {
      if (disposed) throw new Error("Account Memory authorization is disposed");
      const identitySnapshot = validateIdentitySessionSnapshot(identity.getSnapshot());
      invalidate(identitySnapshot);
      if (identitySnapshot.state !== "signed-in") return currentSnapshot();

      const refreshGeneration = generation;
      const expectedSubject = identitySnapshot.subjectId;
      try {
        const resolved = validateEntitlementDecision(await entitlements.resolve(Object.freeze({
          subjectType: "account",
          subjectId: expectedSubject,
          key: ACCOUNT_MEMORY_CLOUD_ENTITLEMENT,
        })));
        const latestIdentity = validateIdentitySessionSnapshot(identity.getSnapshot());
        if (
          disposed
          || refreshGeneration !== generation
          || latestIdentity.state !== "signed-in"
          || latestIdentity.subjectId !== expectedSubject
        ) {
          return currentSnapshot();
        }
        if (
          resolved.subjectType !== "account"
          || resolved.subjectId !== expectedSubject
          || resolved.key !== ACCOUNT_MEMORY_CLOUD_ENTITLEMENT
          || resolved.authority !== "server"
        ) {
          throw new Error("Memory sync entitlement response escaped its authority boundary");
        }
        const expiry = expiryState(resolved.expiresAt, now);
        state = expiry.expired ? "denied" : "resolved";
        subjectId = expectedSubject;
        decision = expiry.expired ? "denied" : resolved.decision;
        authority = "server";
        expiresAt = expiry.expiresAt;
      } catch {
        if (!disposed && refreshGeneration === generation) {
          state = "unavailable";
          subjectId = expectedSubject;
          decision = "denied";
          authority = null;
          expiresAt = null;
        }
      }
      return currentSnapshot();
    },
    authorize(descriptor = {}) {
      if (disposed) return false;
      const identitySnapshot = validateIdentitySessionSnapshot(identity.getSnapshot());
      if (
        identitySnapshot.state !== "signed-in"
        || state !== "resolved"
        || decision !== "allowed"
        || authority !== "server"
        || subjectId !== identitySnapshot.subjectId
        || descriptor.subjectId !== identitySnapshot.subjectId
        || descriptor.dataClass !== "memory"
      ) {
        return false;
      }
      if (expiresAt !== null && Date.parse(expiresAt) <= now().getTime()) {
        return false;
      }
      return true;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      unsubscribeIdentity();
      generation += 1;
      state = "disposed";
      decision = "denied";
      authority = null;
      expiresAt = null;
    },
  });
}
