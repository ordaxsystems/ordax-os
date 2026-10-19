import {
  SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
  assertSpaceMembershipActionsPort,
  isSpaceMembershipActionSupported,
  validateSpaceMembershipActionRequest,
} from "../../contracts/space-membership-actions.mjs";
import {
  assertSpacesPort,
  validateSpacesSnapshot,
} from "../../contracts/spaces.mjs";

function assertVisibleSpace(spaces, spaceId) {
  const snapshot = validateSpacesSnapshot(spaces.getSnapshot());
  if (snapshot.state !== "ready") {
    throw new Error("Space membership actions are unavailable while the Spaces catalog is not ready");
  }
  if (!snapshot.spaces.some((space) => space.id === spaceId)) {
    throw new Error("Space membership target is not available to the current account");
  }
}

function request(action, spaceId, targetUserId, idempotencyKey, role = undefined) {
  const value = {
    schema: SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
    action,
    spaceId,
    targetUserId,
    idempotencyKey,
  };
  if (action === "change-role") value.role = role;
  return validateSpaceMembershipActionRequest(value);
}

export function createSpaceMembershipActionsRuntime({ spaces, membershipActions } = {}) {
  const spacesPort = assertSpacesPort(spaces);
  const actionsPort = assertSpaceMembershipActionsPort(membershipActions);

  const execute = async (
    action,
    spaceId,
    targetUserId,
    idempotencyKey,
    role = undefined,
  ) => {
    if (!isSpaceMembershipActionSupported(actionsPort.getSnapshot(), action)) {
      throw new Error(`Space membership action is unavailable: ${action}`);
    }

    assertVisibleSpace(spacesPort, spaceId);
    const value = request(action, spaceId, targetUserId, idempotencyKey, role);

    if (action === "change-role") return actionsPort.changeMemberRole(value);
    if (action === "suspend") return actionsPort.suspendMember(value);
    if (action === "reactivate") return actionsPort.reactivateMember(value);
    return actionsPort.removeMember(value);
  };

  return Object.freeze({
    changeMemberRole(spaceId, targetUserId, role, idempotencyKey) {
      return execute("change-role", spaceId, targetUserId, idempotencyKey, role);
    },
    suspendMember(spaceId, targetUserId, idempotencyKey) {
      return execute("suspend", spaceId, targetUserId, idempotencyKey);
    },
    reactivateMember(spaceId, targetUserId, idempotencyKey) {
      return execute("reactivate", spaceId, targetUserId, idempotencyKey);
    },
    removeMember(spaceId, targetUserId, idempotencyKey) {
      return execute("remove", spaceId, targetUserId, idempotencyKey);
    },
  });
}
