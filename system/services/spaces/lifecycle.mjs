import {
  SPACE_LIFECYCLE_REQUEST_SCHEMA,
  assertSpaceLifecyclePort,
  isSpaceLifecycleActionSupported,
  validateSpaceLifecycleRequest,
} from "../../contracts/space-lifecycle.mjs";
import {
  assertSpacesPort,
  validateSpacesSnapshot,
} from "../../contracts/spaces.mjs";

function assertVisibleSpace(spaces, spaceId) {
  const snapshot = validateSpacesSnapshot(spaces.getSnapshot());
  if (snapshot.state !== "ready") {
    throw new Error("Space lifecycle is unavailable while the Spaces catalog is not ready");
  }
  const space = snapshot.spaces.find((candidate) => candidate.id === spaceId) ?? null;
  if (space === null) {
    throw new Error("Space lifecycle target is not available to the current account");
  }
  return space;
}

function request(action, spaceId, idempotencyKey, name = undefined) {
  const value = {
    schema: SPACE_LIFECYCLE_REQUEST_SCHEMA,
    action,
    spaceId,
    idempotencyKey,
  };
  if (action === "rename") value.name = name;
  return validateSpaceLifecycleRequest(value);
}

export function createSpaceLifecycleRuntime({ spaces, lifecycle } = {}) {
  const spacesPort = assertSpacesPort(spaces);
  const lifecyclePort = assertSpaceLifecyclePort(lifecycle);

  const execute = async (action, spaceId, idempotencyKey, name = undefined) => {
    if (!isSpaceLifecycleActionSupported(lifecyclePort.getSnapshot(), action)) {
      throw new Error(`Space lifecycle action is unavailable: ${action}`);
    }

    assertVisibleSpace(spacesPort, spaceId);
    const value = request(action, spaceId, idempotencyKey, name);

    let result;
    if (action === "rename") result = await lifecyclePort.renameSpace(value);
    else if (action === "archive") result = await lifecyclePort.archiveSpace(value);
    else result = await lifecyclePort.restoreSpace(value);

    // The mutation owner is authoritative. Refresh the read projection only after the
    // action resolves, so selection and Surface consumers converge on server state.
    // If refresh fails, let the error surface: retrying the same action is safe because
    // lifecycle mutations are idempotent by request key.
    await spacesPort.refresh();
    return result;
  };

  return Object.freeze({
    renameSpace(spaceId, name, idempotencyKey) {
      return execute("rename", spaceId, idempotencyKey, name);
    },
    archiveSpace(spaceId, idempotencyKey) {
      return execute("archive", spaceId, idempotencyKey);
    },
    restoreSpace(spaceId, idempotencyKey) {
      return execute("restore", spaceId, idempotencyKey);
    },
  });
}
