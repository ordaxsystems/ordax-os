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
  let disposed = false;
  let commandToken = null;

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
    const value = validateProfileActivationState(await response.json());
    if (value.persistence !== "device") {
      throw new Error("Native Profile activation state must be device-persistent");
    }
    snapshot = value;
    return snapshot;
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
      const error = new Error(`Native Profile activation command failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const result = await response.json();
    snapshot = validateProfileActivationState(result.state);
    return snapshot;
  };

  await refresh();

  return Object.freeze({
    schema: PROFILE_ACTIVATION_STATE_PORT_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    refresh,
    activate({ spaceId, spaceKind, profile, components = [], activatedAt = Date.now() }) {
      return command({
        action: "activate",
        expectedRevision: snapshot.revision,
        spaceId,
        spaceKind,
        profile,
        components,
        activatedAt,
      });
    },
    deactivate(spaceId) {
      return command({
        action: "deactivate",
        expectedRevision: snapshot.revision,
        spaceId,
      });
    },
    rollback(spaceId) {
      return command({
        action: "rollback",
        expectedRevision: snapshot.revision,
        spaceId,
      });
    },
    dispose() {
      disposed = true;
      commandToken = null;
    },
  });
}
