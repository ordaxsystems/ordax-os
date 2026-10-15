import {
  SPACE_CAPABILITY_PROVIDER_SCHEMA,
  SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
} from "../../contracts/space-experience.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import {
  assertIntelligencePort,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";
import { validateSpace } from "../../contracts/spaces.mjs";

function sameSpaceIdentity(left, right) {
  return (
    left.id === right.id
    && left.ownerId === right.ownerId
    && left.kind === right.kind
    && left.state === right.state
    && left.profilePack === right.profilePack
    && (left.domain ?? null) === (right.domain ?? null)
    && (left.subtype ?? null) === (right.subtype ?? null)
  );
}

function capabilitySnapshot(spaceId, state) {
  return Object.freeze({
    schema: SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
    state,
    spaceId,
    metrics: Object.freeze({}),
    auraContext: null,
  });
}

export function createSelectedSpaceAuraCapabilityProvider({
  spaceSelectionPort,
  intelligencePort,
} = {}) {
  const selection = assertSpaceSelectionPort(spaceSelectionPort);
  const intelligence = assertIntelligencePort(intelligencePort);

  return Object.freeze({
    schema: SPACE_CAPABILITY_PROVIDER_SCHEMA,
    capability: "aura",
    getSnapshot(spaceValue) {
      const space = validateSpace(spaceValue);
      const selected = validateSpaceSelectionSnapshot(selection.getSnapshot());
      if (
        selected.state !== "selected"
        || !sameSpaceIdentity(space, selected.selectedSpace)
      ) {
        return capabilitySnapshot(space.id, "unavailable");
      }
      const intelligenceSnapshot = validateIntelligenceSnapshot(intelligence.getSnapshot());
      return capabilitySnapshot(
        space.id,
        intelligenceSnapshot.inferenceAvailable ? "ready" : "unavailable",
      );
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Aura Space capability listener must be a function");
      }
      let active = true;
      const notify = () => {
        if (active) listener();
      };
      const cleanups = [];
      try {
        cleanups.push(selection.subscribe(notify));
        cleanups.push(intelligence.subscribe(notify));
      } catch (error) {
        active = false;
        for (const cleanup of cleanups.reverse()) cleanup?.();
        throw error;
      }
      return () => {
        if (!active) return;
        active = false;
        for (const cleanup of cleanups.reverse()) cleanup?.();
      };
    },
  });
}
