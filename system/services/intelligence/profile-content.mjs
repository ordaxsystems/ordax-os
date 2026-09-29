import {
  INTELLIGENCE_MAX_CONTEXT_ITEMS,
  INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceRequest,
} from "../../contracts/intelligence.mjs";
import {
  assertProfileContentContextPort,
} from "../../contracts/profile-content-context.mjs";

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

  const respondForSpace = async (value, spaceId) => {
    const request = validateIntelligenceRequest(value);
    const normalizedSpaceId = boundedSpaceId(spaceId);
    const profile = await profileContext.read(normalizedSpaceId);

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
    return intelligence.respond(merged);
  };

  return Object.freeze({
    schema: PROFILE_CONTENT_INTELLIGENCE_SCHEMA,
    getSnapshot() {
      return intelligence.getSnapshot();
    },
    subscribe(listener) {
      return intelligence.subscribe(listener);
    },
    respond(value, { spaceId } = {}) {
      return respondForSpace(value, spaceId);
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
        respond(value) {
          return respondForSpace(value, boundSpaceId);
        },
      });
    },
  });
}
