import {
  INTELLIGENCE_MAX_CONTEXT_ITEMS,
  INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceRequest,
} from "../../contracts/intelligence.mjs";
import {
  assertProfileContentContextPort,
  validateProfileContentContext,
} from "../../contracts/profile-content-context.mjs";
import { assertIdentitySessionPort, validateIdentitySessionSnapshot } from "../../contracts/identity-session.mjs";
import { assertSpacesPort, validateSpacesSnapshot } from "../../contracts/spaces.mjs";
import { deriveAuthorizedSpaces } from "../spaces/authorized-view.mjs";
import {
  assertProfileActivationStatePort,
  currentProfileForSpace,
  validateProfileActivationState,
} from "../../contracts/profile-activation-state.mjs";
import { PROFILE_CONTENT_CONTEXT_PORT_SCHEMA } from "../../contracts/profile-content-context.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";

export const PROFILE_CONTENT_INTELLIGENCE_SCHEMA = "ordax.intelligence-profile-content/1";

function boundedSpaceId(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Profile-content Intelligence Space id must be text");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new TypeError("Profile-content Intelligence Space id is outside bounds");
  }
  return normalized;
}

function fitEntries(entries, remainingItems, remainingChars) {
  const fitted = [];
  let chars = remainingChars;
  for (const entry of entries) {
    if (fitted.length >= remainingItems || chars <= 0) break;
    if (entry.text.length <= chars) {
      fitted.push(entry);
      chars -= entry.text.length;
      continue;
    }
    if (chars < 2) break;
    const clipped = entry.text.slice(0, chars - 1).trimEnd();
    if (!clipped) break;
    fitted.push(Object.freeze({ ...entry, text: `${clipped}…` }));
    break;
  }
  return Object.freeze(fitted);
}

export function createProfileContentIntelligence({
  intelligencePort,
  profileContentContextPort,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const profileContext = assertProfileContentContextPort(profileContentContextPort);

  const respondForSpace = async (value, spaceId, { signal = null, onDelta = null } = {}) => {
    const request = validateIntelligenceRequest(value);
    const normalizedSpaceId = boundedSpaceId(spaceId);

    // Search text stays on the Native loopback. Only bounded query characters
    // reach the read-only Knowledge reader; no external embeddings or provider.
    const searchQuery = request.prompt.replace(/\s+/g, " ").trim().slice(0, 256);
    const profile = validateProfileContentContext(await profileContext.read(
      normalizedSpaceId, searchQuery ? { query: searchQuery } : undefined,
    ));
    if (profile.spaceId !== normalizedSpaceId) {
      throw new Error("Profile-content Intelligence Space identity changed");
    }

    const remainingItems = INTELLIGENCE_MAX_CONTEXT_ITEMS - request.context.length;
    const usedChars = request.context.reduce((total, entry) => total + entry.text.length, 0);
    const remainingChars = INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS - usedChars;
    const additions = (
      remainingItems > 0 && remainingChars > 0
        ? fitEntries(profile.entries, remainingItems, remainingChars)
        : []
    );

    const merged = validateIntelligenceRequest({
      intent: request.intent,
      prompt: request.prompt,
      context: [...request.context, ...additions],
      maxTokens: request.maxTokens,
    });
    return intelligence.respond(merged, { signal, onDelta });
  };

  return Object.freeze({
    schema: PROFILE_CONTENT_INTELLIGENCE_SCHEMA,
    getSnapshot() {
      return intelligence.getSnapshot();
    },
    subscribe(listener) {
      return intelligence.subscribe(listener);
    },
    respond(value, { spaceId, signal = null, onDelta = null } = {}) {
      return respondForSpace(value, spaceId, { signal, onDelta });
    },
    forSpace(spaceId) {
      const boundSpaceId = boundedSpaceId(spaceId);
      return Object.freeze({
        schema: INTELLIGENCE_PORT_SCHEMA,
        getSnapshot() {
          return intelligence.getSnapshot();
        },
        subscribe(listener) {
          return intelligence.subscribe(listener);
        },
        respond(value, { signal = null, onDelta = null } = {}) {
          return respondForSpace(value, boundSpaceId, { signal, onDelta });
        },
      });
    },
  });
}


export function createSelectedSpaceProfileContentIntelligence({
  intelligencePort,
  profileContentContextPort,
  spaceSelectionPort,
  identitySessionPort,
  spacesPort,
  profileActivationStatePort,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const selection = assertSpaceSelectionPort(spaceSelectionPort);
  const identity = assertIdentitySessionPort(identitySessionPort);
  const spaces = assertSpacesPort(spacesPort);
  const activation = assertProfileActivationStatePort(profileActivationStatePort);
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return intelligence.getSnapshot();
    },
    subscribe(listener) {
      return intelligence.subscribe(listener);
    },
    async respond(value, { signal = null, onDelta = null } = {}) {
      const request = validateIntelligenceRequest(value);
      const currentSpace = () => {
        const currentIdentity = validateIdentitySessionSnapshot(identity.getSnapshot());
        const currentCatalog = validateSpacesSnapshot(spaces.getSnapshot());
        const currentSelection = validateSpaceSelectionSnapshot(selection.getSnapshot());
        return deriveAuthorizedSpaces(currentIdentity, currentCatalog, currentSelection).activeSpace;
      };
      const selected = validateSpaceSelectionSnapshot(selection.getSnapshot());
      if (selected.state !== "selected") {
        // With no selected Space, consult the generic model without a profile.
        return intelligence.respond(request, { signal, onDelta });
      }
      const authorized = currentSpace();
      if (!authorized) {
        throw new Error("Profile-content Intelligence requires the current authorized Space");
      }
      // A response from a slow Knowledge Pack read belongs to the original
      // authenticated subject and Space, not whichever user opens the UI later.
      const spaceId = authorized.id;
      const subjectId = selected.subjectId;
      const currentActivation = validateProfileActivationState(activation.getSnapshot());
      const activeProfile = currentProfileForSpace(currentActivation, authorized);
      const assertStableActivation = () => {
        const next = validateProfileActivationState(activation.getSnapshot());
        const profile = currentProfileForSpace(next, authorized);
        if (
          next.revision !== currentActivation.revision
          || profile?.slug !== activeProfile?.slug
          || profile?.version !== activeProfile?.version
        ) {
          throw new Error("Profile-content Intelligence activation changed while reading context");
        }
      };
      const verifiedProfileContext = {
        schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
        async read(id, options) {
          const context = validateProfileContentContext(
            await profileContentContextPort.read(id, options),
          );
          assertStableActivation();
          if (
            context.profile?.slug !== activeProfile?.slug
            || context.profile?.version !== activeProfile?.version
          ) {
            throw new Error("Profile-content Intelligence reader returned an inactive Profile");
          }
          return context;
        },
      };
      const assertSpaceCurrent = () => {
        const now = validateSpaceSelectionSnapshot(selection.getSnapshot());
        const space = currentSpace();
        assertStableActivation();
        if (
          now.state !== "selected"
          || now.subjectId !== subjectId
          || space?.id !== spaceId
          || space.kind !== authorized.kind
        ) {
          throw new Error("Profile-content Intelligence Space changed while reading context");
        }
      };
      const securedContextPort = {
        schema: INTELLIGENCE_PORT_SCHEMA,
        getSnapshot: () => intelligence.getSnapshot(),
        subscribe: (listener) => intelligence.subscribe(listener),
        respond: (merged, { signal: forwardedSignal = null, onDelta: forwardDelta = null } = {}) => {
          assertSpaceCurrent();
          return intelligence.respond(merged, {
            signal: forwardedSignal,
            onDelta: forwardDelta === null ? null : async (delta) => {
              assertSpaceCurrent();
              await forwardDelta(delta);
              assertSpaceCurrent();
            },
          });
        },
      };
      // Use the existing bounded context composition, with an additional
      // post-read authorization guard before reaching the inference port.
      return createProfileContentIntelligence({
        intelligencePort: securedContextPort,
        profileContentContextPort: verifiedProfileContext,
      }).forSpace(spaceId).respond(request, { signal, onDelta });
    },
  });
}
