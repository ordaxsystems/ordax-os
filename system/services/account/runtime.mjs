import { validateIdentityActionsSnapshot } from "../../contracts/identity-actions.mjs";
import { validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import { validateSurfaceSnapshot } from "../../contracts/surface-host.mjs";

// The Account domain owns the identity -> sync dependency. Host adapters
// observe their providers, but must not reimplement the rule or grant access.
export function deriveAccountSurfaceCapabilityIds({
  accountIdentityAvailable,
  syncSafeStateAvailable,
}) {
  if (typeof accountIdentityAvailable !== "boolean") {
    throw new TypeError("account identity availability reader must return a boolean");
  }
  if (typeof syncSafeStateAvailable !== "boolean") {
    throw new TypeError("sync availability reader must return a boolean");
  }
  if (syncSafeStateAvailable && !accountIdentityAvailable) {
    throw new TypeError("sync.safe-state requires account.identity");
  }
  return Object.freeze([
    ...(accountIdentityAvailable ? ["account.identity"] : []),
    ...(syncSafeStateAvailable ? ["sync.safe-state"] : []),
  ]);
}

export function validateAccountRuntime(surfaceValue, identityValue, actionsValue = { supportedActions: [] }) {
  const surface = validateSurfaceSnapshot(surfaceValue);
  const identity = validateIdentitySessionSnapshot(identityValue);
  const actions = validateIdentityActionsSnapshot(actionsValue);
  const capabilities = new Set(surface.capabilityIds);
  const identityAvailable = capabilities.has("account.identity");
  const syncAvailable = capabilities.has("sync.safe-state");

  deriveAccountSurfaceCapabilityIds({
    accountIdentityAvailable: identityAvailable,
    syncSafeStateAvailable: syncAvailable,
  });
  if (identity.state === "unavailable" && identityAvailable) {
    throw new TypeError("account.identity cannot be advertised while the identity session port is unavailable");
  }
  if (identity.state !== "unavailable" && !identityAvailable) {
    throw new TypeError("available identity session requires account.identity capability");
  }
  if (identity.state === "unavailable" && actions.supportedActions.length > 0) {
    throw new TypeError("identity actions cannot be advertised while identity is unavailable");
  }
  if (actions.supportedActions.length > 0 && !identityAvailable) {
    throw new TypeError("identity actions require account.identity capability");
  }

  return Object.freeze({ surface, identity, actions });
}
