import { assertIdentitySessionPort, validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import { assertEntitlementsPort } from "../../contracts/entitlements.mjs";
import {
  ACCOUNT_MEMORY_AUTHORIZATION_SCHEMA,
  createAccountMemorySyncAuthorization,
} from "./account-memory-authorization.mjs";

export const ACCOUNT_MEMORY_ENTITLEMENT_SESSION_SCHEMA = "ordax.account-memory-entitlement-session/1";

function sameIdentity(left, right) {
  return left.state === right.state && left.subjectId === right.subjectId;
}

export function createAccountMemoryEntitlementSession({
  identitySession,
  entitlementsPort,
  now = () => new Date(),
} = {}) {
  const identity = assertIdentitySessionPort(identitySession);
  const entitlements = assertEntitlementsPort(entitlementsPort);
  const authorization = createAccountMemorySyncAuthorization({
    identitySession: identity,
    entitlementsPort: entitlements,
    now,
  });

  let destroyed = false;
  let observedIdentity = validateIdentitySessionSnapshot(identity.getSnapshot());
  let refreshOrdinal = 0;
  let refreshPromise = Promise.resolve(authorization.getSnapshot());

  const refreshForCurrentIdentity = () => {
    if (destroyed) return Promise.resolve(null);
    const ordinal = ++refreshOrdinal;
    const current = validateIdentitySessionSnapshot(identity.getSnapshot());
    observedIdentity = current;
    if (current.state !== "signed-in") {
      refreshPromise = Promise.resolve(authorization.getSnapshot());
      return refreshPromise;
    }
    refreshPromise = authorization.refresh().then((snapshot) => {
      if (destroyed || ordinal !== refreshOrdinal) return authorization.getSnapshot();
      return snapshot;
    });
    return refreshPromise;
  };

  const unsubscribeIdentity = identity.subscribe((snapshot) => {
    if (destroyed) return;
    const current = validateIdentitySessionSnapshot(snapshot);
    if (sameIdentity(current, observedIdentity)) return;
    observedIdentity = current;
    void refreshForCurrentIdentity();
  });
  if (typeof unsubscribeIdentity !== "function") {
    authorization.destroy();
    throw new TypeError("Memory entitlement session requires identity unsubscribe support");
  }

  if (observedIdentity.state === "signed-in") {
    void refreshForCurrentIdentity();
  }

  return Object.freeze({
    schema: ACCOUNT_MEMORY_ENTITLEMENT_SESSION_SCHEMA,
    authorizationSchema: ACCOUNT_MEMORY_AUTHORIZATION_SCHEMA,
    getSnapshot() {
      if (destroyed) throw new Error("Memory entitlement session is disposed");
      return authorization.getSnapshot();
    },
    authorize(descriptor) {
      if (destroyed) return false;
      return authorization.authorize(descriptor);
    },
    async refresh() {
      if (destroyed) throw new Error("Memory entitlement session is disposed");
      return refreshForCurrentIdentity();
    },
    async settled() {
      if (destroyed) throw new Error("Memory entitlement session is disposed");
      await refreshPromise;
      return authorization.getSnapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      refreshOrdinal += 1;
      unsubscribeIdentity();
      authorization.destroy();
    },
  });
}
