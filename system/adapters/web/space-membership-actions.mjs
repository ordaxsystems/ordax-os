import {
  SPACE_MEMBERSHIP_ACTIONS,
  SPACE_MEMBERSHIP_ACTIONS_SCHEMA,
  validateSpaceMembershipActionRequest,
  validateSpaceMembershipActionResult,
  validateSpaceMembershipActionsSnapshot,
} from "../../contracts/space-membership-actions.mjs";
import { runWebRequestWithinDeadline } from "./json-read.mjs";

const ACTION_PATH = "/account/space-membership-actions";

export function createWebSpaceMembershipActions(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web Space membership actions require window.fetch");
  }

  let disposed = false;
  // The gateway's idempotency key is the authority for one logical command.
  // Concurrent identical submissions share one request, not two POSTs.
  const inFlightByKey = new Map();
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
    const requestBody = JSON.stringify(request);
    const inFlight = inFlightByKey.get(request.idempotencyKey);
    if (inFlight) {
      if (inFlight.requestBody !== requestBody) {
        throw new Error("Space membership idempotency key is already in use for another request");
      }
      return inFlight.pending;
    }
    const controller = new AbortController();
    // The server is still authoritative if a request times out: never
    // automatically replay a mutation whose outcome may be unknown.
    const pending = runWebRequestWithinDeadline(windowRef, controller, async (signal) => {
        const response = await windowRef.fetch(ACTION_PATH, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "manual",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: requestBody,
          signal,
        });
        if (signal.aborted) throw signal.reason;

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
        if (signal.aborted) throw signal.reason;
        if (disposed) throw new Error("Web Space membership actions are disposed");
        return result;
      }, "Web Space membership action").finally(() => {
      if (inFlightByKey.get(request.idempotencyKey)?.controller === controller) {
        inFlightByKey.delete(request.idempotencyKey);
      }
    });
    inFlightByKey.set(request.idempotencyKey, { requestBody, pending, controller });
    return pending;
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
      for (const { controller } of inFlightByKey.values()) {
        controller.abort(new Error("Web Space membership actions are disposed"));
      }
      inFlightByKey.clear();
      listeners.clear();
    },
  });
}
