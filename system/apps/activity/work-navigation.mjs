import { validateAppActivation } from "../../contracts/app-activation.mjs";
import { validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import { validateSpaceSelectionSnapshot } from "../../contracts/space-selection.mjs";
import {
  validatePersonalOrdaxOwner,
  validatePersonalOrdaxRuntimeSnapshot,
} from "../../contracts/personal-ordax-store.mjs";
import { activityApp } from "./app.mjs";

// The Activity app owns its *navigation target format*. Surface owns the
// window target; Personal OrdaX owns Work, authorization and execution.
// This is a locator, never a grant, approval decision or execution request.
export const PERSONAL_ACTIVITY_WORK_TARGET_SCHEMA = "ordax.activity-work-target/1";
const WORK_ID = /^personal-work-[1-9][0-9]*$/;
const FIELDS = "ownerId,ownerKind,projectId,schema,spaceId,workItemId";

function decodeTarget(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(",") !== FIELDS
    || parsed.schema !== PERSONAL_ACTIVITY_WORK_TARGET_SCHEMA
    || typeof parsed.workItemId !== "string" || !WORK_ID.test(parsed.workItemId)
    || parsed.projectId !== null
    || (parsed.spaceId !== null && (
      typeof parsed.spaceId !== "string" || !parsed.spaceId.trim()
      || parsed.spaceId.length > 160 || parsed.spaceId.includes("\0")
    ))) return null;
  try {
    const owner = validatePersonalOrdaxOwner({
      ownerKind: parsed.ownerKind, ownerId: parsed.ownerId,
    });
    if (owner.ownerKind === "device" && parsed.spaceId !== null) return null;
    return Object.freeze({
      schema: PERSONAL_ACTIVITY_WORK_TARGET_SCHEMA,
      workItemId: parsed.workItemId,
      ownerKind: owner.ownerKind,
      ownerId: owner.ownerId,
      spaceId: parsed.spaceId,
      projectId: null,
    });
  } catch {
    return null;
  }
}

export function createPersonalActivityWorkTarget(personalSnapshot, workItemId) {
  const personal = validatePersonalOrdaxRuntimeSnapshot(personalSnapshot);
  const item = personal.workItems.find((work) => work.id === workItemId);
  // The global Assistant has no project selection: do not mint a project
  // navigation target from an unscoped consumer.
  if (!item || item.projectId !== null) return null;
  const target = JSON.stringify({
    schema: PERSONAL_ACTIVITY_WORK_TARGET_SCHEMA,
    workItemId: item.id,
    ownerKind: personal.ownerKind,
    ownerId: personal.ownerId,
    spaceId: item.spaceId,
    projectId: null,
  });
  validateAppActivation({ appId: activityApp.id, target });
  return target;
}

// Parse and authorize at the destination, not just when the Assistant emits
// the link. Persisted workspace targets must never select a different account
// Work with the same ordinal id after an A→B or Space switch.
export function resolvePersonalActivityWorkTarget(
  target, personalSnapshot, identitySnapshot, spaceSelectionSnapshot,
) {
  const pointer = decodeTarget(target);
  if (pointer === null) return null;
  const personal = validatePersonalOrdaxRuntimeSnapshot(personalSnapshot);
  const identity = validateIdentitySessionSnapshot(identitySnapshot);
  const selection = validateSpaceSelectionSnapshot(spaceSelectionSnapshot);
  if (pointer.ownerKind !== personal.ownerKind
    || pointer.ownerId !== personal.ownerId) return null;
  if (identity.state === "signed-out") {
    if (pointer.ownerKind !== "device" || selection.state !== "unavailable") return null;
  } else if (identity.state === "signed-in") {
    if (pointer.ownerKind !== "account"
      || identity.subjectId !== pointer.ownerId
      || selection.state === "unavailable"
      || selection.subjectId !== pointer.ownerId) return null;
  } else return null;

  const item = personal.workItems.find((work) => work.id === pointer.workItemId);
  if (!item || item.ownerKind !== pointer.ownerKind || item.ownerId !== pointer.ownerId
    || item.spaceId !== pointer.spaceId || item.projectId !== null) return null;
  if (item.spaceId !== null && (
    selection.state !== "selected" || selection.selectedSpace.id !== item.spaceId
  )) return null;
  return Object.freeze({ workItemId: item.id });
}
