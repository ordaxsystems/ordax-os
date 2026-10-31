import {
  SPACE_MEMBERSHIP_ACTIONS,
  SPACE_MEMBERSHIP_ACTIONS_SCHEMA,
  validateSpaceMembershipActionRequest,
  validateSpaceMembershipActionResult,
  validateSpaceMembershipActionsSnapshot,
} from "../../contracts/space-membership-actions.mjs";

const ACTION_PATH = "/account/space-membership-actions";

export function createWebSpaceMembershipActions(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web Space membership actions require window.fetch");
  }

  let disposed = false;
  const listeners = new Set();
  const snapshot = validateSpaceMembershipActionsSnapshot({
    supportedActions: SPACE_MEMBERSHIP_ACTIONS,
  });

  const assertActive = () => {
    if (disposed) throw new Error("Web Space membership actions are disposed");
  };

  const execute = async (expectedAction, value) => {
    assertActive();
    const request = validateSpaceMembershipActionRequest(value);
    if (request.action !== expectedAction) {
      throw new TypeError(`Space membership method/action mismatch: ${expectedAction}`);
    }
    const response = await windowRef.fetch(ACTION_PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (response.status === 401) {
      throw new Error("Space membership actions require an authenticated OrdaX account session");
    }
    if (response.status === 403) {
      throw new Error("Space membership action is forbidden for the current account");
    }
    if (response.status === 409) {
      throw new Error("Space membership action idempotency conflict");
    }
    if (!response.ok) {
      throw new Error(`Space membership action failed: ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Space membership action returned invalid JSON");
    }
    const result = validateSpaceMembershipActionResult(payload);
    if (result.spaceId !== request.spaceId || result.targetUserId !== request.targetUserId) {
      throw new Error("Space membership action response targets another membership");
    }
    return result;
  };

  return Object.freeze({
    schema: SPACE_MEMBERSHIP_ACTIONS_SCHEMA,
    getSnapshot() {
      assertActive();
      return snapshot;
    },
    subscribe(listener) {
      assertActive();
      if (typeof listener !== "function") throw new TypeError("Space membership listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh() {
      assertActive();
      for (const listener of listeners) listener(snapshot);
      return snapshot;
    },
    changeMemberRole(request) {
      return execute("change-role", request);
    },
    suspendMember(request) {
      return execute("suspend", request);
    },
    reactivateMember(request) {
      return execute("reactivate", request);
    },
    removeMember(request) {
      return execute("remove", request);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
    },
  });
}
