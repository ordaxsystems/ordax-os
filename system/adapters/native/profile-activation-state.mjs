import {
  PROFILE_ACTIVATION_STATE_PORT_SCHEMA,
  createEmptyProfileActivationState,
  validateProfileActivationState,
} from "../../contracts/profile-activation-state.mjs";

const ENDPOINT = "/__ordax/native/profile-activation-state";
const COMMAND_ENDPOINT = "/__ordax/native/profile-activation-command";
const SESSION_ENDPOINT = "/__ordax/native/session";
const COMMAND_SCHEMA = "ordax.profile-activation-command/1";
const TOKEN_HEADER = "X-OrdaX-Profile-Activation-Token";

export async function createNativeProfileActivationState(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Profile activation state requires window.fetch");
  }

  let snapshot = createEmptyProfileActivationState("device");
  let initialized = false;
  let disposed = false;
  let commandToken = null;
  const listeners = new Set();

  const acceptSnapshot = (value) => {
    const next = validateProfileActivationState(value);
    if (next.persistence !== "device") {
      throw new Error("Native Profile activation state must be device-persistent");
    }
    if (disposed) throw new Error("Profile activation state is disposed");
    if (initialized && next.revision < snapshot.revision) {
      // A delayed GET must never roll back a newer authorized mutation.
      return snapshot;
    }
    if (initialized && next.revision === snapshot.revision) {
      if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
        throw new Error("Native Profile activation state changed without a revision");
      }
      return snapshot;
    }
    snapshot = next;
    initialized = true;
    for (const listener of [...listeners]) listener(snapshot);
    return snapshot;
  };

  const refresh = async () => {
    if (disposed) throw new Error("Profile activation state is disposed");
    const response = await windowRef.fetch(ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`Native Profile activation state unavailable: ${response.status}`);
    }
    return acceptSnapshot(await response.json());
  };

  const loadCommandToken = async () => {
    if (commandToken !== null) return commandToken;
    const response = await windowRef.fetch(SESSION_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`Native Profile activation session unavailable: ${response.status}`);
    const session = await response.json();
    if (
      session.profileActivationAvailable !== true
      || typeof session.profileActivationToken !== "string"
      || session.profileActivationToken.length < 24
    ) {
      throw new Error("Native Profile activation command is unavailable");
    }
    commandToken = session.profileActivationToken;
    return commandToken;
  };

  const command = async (body) => {
    if (disposed) throw new Error("Profile activation state is disposed");
    const token = await loadCommandToken();
    const response = await windowRef.fetch(COMMAND_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        [TOKEN_HEADER]: token,
      },
      body: JSON.stringify({ schema: COMMAND_SCHEMA, ...body }),
    });
    if (!response.ok) {
      if (response.status === 409) {
        // A concurrent mutation invalidated our revision; refresh for the next
        // explicit user action, but never replay the rejected mutation.
        try {
          await refresh();
        } catch {
          // Preserve the original conflict, not a secondary read failure.
        }
      }
      const error = new Error(`Native Profile activation command failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const result = await response.json();
    acceptSnapshot(result.state);
    return result;
  };

  await refresh();

  return Object.freeze({
    schema: PROFILE_ACTIVATION_STATE_PORT_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Profile activation listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    refresh,
    async previewActivation({ spaceId, spaceKind, profile, components = [] }) {
      // Capture the revision before network IO: a concurrent Native command
      // must never make an older permission review look current.
      const expectedRevision = snapshot.revision;
      const result = await command({
        action: "preview-activate",
        expectedRevision,
        spaceId,
        spaceKind,
        profile,
        components,
      });
      if (snapshot.revision !== expectedRevision) {
        const error = new Error("Native Profile activation preview revision changed");
        error.status = 409;
        throw error;
      }
      return Object.freeze({
        expectedRevision,
        permissionDiff: result.permissionDiff,
        permissionDiffSha256: result.permissionDiffSha256,
      });
    },
    async activate({
      spaceId,
      spaceKind,
      profile,
      components = [],
      activatedAt = Date.now(),
      acceptedPermissionDiffSha256 = null,
      expectedRevision = snapshot.revision,
    }) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new TypeError("Profile activation expected revision is invalid");
      }
      if (snapshot.revision !== expectedRevision) {
        const error = new Error("Native Profile activation review revision changed");
        error.status = 409;
        throw error;
      }
      const body = {
        action: "activate",
        expectedRevision,
        spaceId,
        spaceKind,
        profile,
        components,
        activatedAt,
      };
      if (acceptedPermissionDiffSha256 !== null) {
        body.acceptedPermissionDiffSha256 = acceptedPermissionDiffSha256;
      }
      await command(body);
      return snapshot;
    },
    async deactivate(spaceId) {
      await command({
        action: "deactivate",
        expectedRevision: snapshot.revision,
        spaceId,
      });
      return snapshot;
    },
    async rollback(spaceId) {
      await command({
        action: "rollback",
        expectedRevision: snapshot.revision,
        spaceId,
      });
      return snapshot;
    },
    dispose() {
      disposed = true;
      commandToken = null;
      listeners.clear();
    },
  });
}
