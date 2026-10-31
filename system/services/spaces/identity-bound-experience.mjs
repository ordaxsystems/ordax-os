import {
  SPACE_EXPERIENCE_SCHEMA,
  SPACE_EXPERIENCE_SOURCE_SCHEMA,
  assertSpaceExperienceSource,
} from "../../contracts/space-experience.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import { assertSpacesPort, validateSpace, validateSpacesSnapshot } from "../../contracts/spaces.mjs";
import { deriveAuthorizedSpaces } from "./authorized-view.mjs";

// Read-only presentation gate in the OS host. It never grants data access,
// impersonates membership, or authorizes an operational Food command.
// The server-backed Spaces catalog and Identity/selection owners retain authority.
function sameSpace(left, right) {
  return left !== null && right !== null
    && left.id === right.id
    && left.ownerId === right.ownerId
    && left.kind === right.kind
    && left.name === right.name
    && left.state === right.state
    && left.profilePack === right.profilePack
    && (left.domain ?? null) === (right.domain ?? null)
    && (left.subtype ?? null) === (right.subtype ?? null);
}

function unavailable(space) {
  return Object.freeze({
    schema: SPACE_EXPERIENCE_SCHEMA,
    state: "unavailable",
    spaceId: space.id,
    type: null,
    capabilities: Object.freeze([]),
    navigation: Object.freeze([]),
    widgets: Object.freeze([]),
    spaceCardMetrics: Object.freeze([]),
    auraContext: null,
    resources: Object.freeze([]),
  });
}

export function createIdentityBoundSpaceExperienceSource({
  experienceSource,
  identitySessionPort,
  spaceSelectionPort,
  spacesPort,
} = {}) {
  const source = assertSpaceExperienceSource(experienceSource);
  const identity = assertIdentitySessionPort(identitySessionPort);
  const selection = assertSpaceSelectionPort(spaceSelectionPort);
  const spaces = assertSpacesPort(spacesPort);
  const listeners = new Set();
  const unsubscribers = [];
  let disposed = false;

  const notify = () => {
    if (!disposed) for (const listener of [...listeners]) listener();
  };

  try {
    unsubscribers.push(identity.subscribe(notify));
    unsubscribers.push(spaces.subscribe(notify));
    unsubscribers.push(selection.subscribe(notify));
    unsubscribers.push(source.subscribe(notify));
  } catch (error) {
    for (const unsubscribe of unsubscribers.reverse()) unsubscribe?.();
    source.dispose?.();
    throw error;
  }

  const authorizedSpace = (requested) => {
    const identitySnapshot = validateIdentitySessionSnapshot(identity.getSnapshot());
    const catalogSnapshot = validateSpacesSnapshot(spaces.getSnapshot());
    const selectedSnapshot = validateSpaceSelectionSnapshot(selection.getSnapshot());
    const projection = deriveAuthorizedSpaces(identitySnapshot, catalogSnapshot, selectedSnapshot);
    const selected = selectedSnapshot.selectedSpace;
    const active = projection.activeSpace;
    return projection.ready && selectedSnapshot.state === "selected"
      && sameSpace(selected, active)
      && sameSpace(requested, active);
  };

  return Object.freeze({
    schema: SPACE_EXPERIENCE_SOURCE_SCHEMA,
    get(spaceValue) {
      const requested = validateSpace(spaceValue);
      if (disposed) return unavailable(requested);
      try {
        if (!authorizedSpace(requested)) return unavailable(requested);
        // The selected Space can change between validation and the provider read.
        const value = source.get(requested);
        if (!authorizedSpace(requested) || value?.spaceId !== requested.id) {
          return unavailable(requested);
        }
        return value;
      } catch {
        // Session/catalog outages fail closed; do not expose the prior Space.
        return unavailable(requested);
      }
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Space experience listener must be a function");
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of unsubscribers.reverse()) unsubscribe?.();
      listeners.clear();
      source.dispose?.();
    },
  });
}
