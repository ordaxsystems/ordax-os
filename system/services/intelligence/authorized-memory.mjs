import {
  INTELLIGENCE_MAX_CONTEXT_ITEMS,
  INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceRequest,
} from "../../contracts/intelligence.mjs";
import {
  MAX_MEMORY_CONTEXT_AUTHORIZATIONS,
  MAX_MEMORY_CONTEXT_ITEMS,
  validateMemoryContextAuthorization,
} from "../../contracts/memory-context.mjs";
import { assertMemoryPort } from "../../contracts/memory.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import { retrieveAuthorizedMemoryContextSet } from "../memory/context.mjs";

export const AUTHORIZED_MEMORY_INTELLIGENCE_SCHEMA = "ordax.intelligence-authorized-memory/1";
const MAX_MEMORY_QUERY_CHARS = 1024;
const DEFAULT_MEMORY_CONTEXT_LIMIT = 4;

function validateAuthorizations(values) {
  if (
    !Array.isArray(values)
    || values.length === 0
    || values.length > MAX_MEMORY_CONTEXT_AUTHORIZATIONS
  ) {
    throw new TypeError("Authorized-memory Intelligence requires a bounded authorization set");
  }
  return Object.freeze(values.map(validateMemoryContextAuthorization));
}

function memoryQuery(value, fallbackPrompt) {
  if (value === undefined) {
    return fallbackPrompt.slice(0, MAX_MEMORY_QUERY_CHARS).trim();
  }
  if (
    typeof value !== "string"
    || value.includes("\0")
    || value.length > MAX_MEMORY_QUERY_CHARS
  ) {
    throw new TypeError("Authorized-memory Intelligence query is outside its allowed bounds");
  }
  return value.trim();
}

function memoryLimit(value) {
  if (value === undefined) return DEFAULT_MEMORY_CONTEXT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_MEMORY_CONTEXT_ITEMS) {
    throw new TypeError("Authorized-memory Intelligence limit is outside its allowed bounds");
  }
  return value;
}

function fitMemoryContext(entries, remainingChars) {
  const fitted = [];
  let remaining = remainingChars;
  for (const entry of entries) {
    if (remaining <= 0) break;
    if (entry.text.length <= remaining) {
      fitted.push(entry);
      remaining -= entry.text.length;
      continue;
    }
    if (remaining >= 2) {
      const clipped = entry.text.slice(0, remaining - 1).trimEnd();
      if (clipped) {
        fitted.push(Object.freeze({ ...entry, text: `${clipped}…` }));
      }
    }
    break;
  }
  return Object.freeze(fitted);
}

export function createAuthorizedMemoryIntelligence({ intelligencePort, memoryPort } = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const memory = assertMemoryPort(memoryPort);

  return Object.freeze({
    schema: AUTHORIZED_MEMORY_INTELLIGENCE_SCHEMA,
    async respond(value, {
      authorizations,
      memoryQuery: queryValue,
      memoryLimit: limitValue,
      signal = null,
    } = {}) {
      const request = validateIntelligenceRequest(value);
      const normalizedAuthorizations = validateAuthorizations(authorizations);
      const query = memoryQuery(queryValue, request.prompt);
      const requestedMemoryLimit = memoryLimit(limitValue);

      const remainingItems = INTELLIGENCE_MAX_CONTEXT_ITEMS - request.context.length;
      const existingContextChars = request.context.reduce(
        (total, entry) => total + entry.text.length,
        0,
      );
      const remainingChars = INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS - existingContextChars;

      let memoryContext = Object.freeze([]);
      if (remainingItems > 0 && remainingChars > 0) {
        const retrieved = retrieveAuthorizedMemoryContextSet(
          memory,
          normalizedAuthorizations,
          {
            query,
            limit: Math.min(requestedMemoryLimit, remainingItems),
          },
        );
        memoryContext = fitMemoryContext(retrieved, remainingChars);
      }

      const merged = validateIntelligenceRequest({
        intent: request.intent,
        prompt: request.prompt,
        context: [...request.context, ...memoryContext],
        maxTokens: request.maxTokens,
      });
      return intelligence.respond(merged, { signal });
    },
  });
}


function memoryContextSnapshot(selection, identity) {
  const selected = validateSpaceSelectionSnapshot(selection.getSnapshot());
  const account = identity === null ? null : validateIdentitySessionSnapshot(identity.getSnapshot());
  return {
    selected,
    account,
    binding: JSON.stringify([
      account?.state ?? null, account?.subjectId ?? null,
      selected.state, selected.subjectId,
      selected.selectedSpace?.id ?? null, selected.selectedSpace?.ownerId ?? null,
    ]),
  };
}

async function withCurrentMemoryContext(intelligence, selection, identity, respond) {
  const captured = memoryContextSnapshot(selection, identity);
  let changed = false;
  let closed = false;
  const cleanups = [];
  const observe = () => {
    if (closed || changed) return;
    try {
      changed = memoryContextSnapshot(selection, identity).binding !== captured.binding;
    } catch {
      changed = true;
    }
  };
  const assertCurrent = () => {
    // Also revalidate after observers are closed: cleanup belongs to the port
    // and may itself synchronously change its current authority snapshot.
    try {
      changed ||= memoryContextSnapshot(selection, identity).binding !== captured.binding;
    } catch {
      changed = true;
    }
    if (changed) throw new Error("Intelligence memory context changed during inference");
  };
  try {
    // The latch catches A -> B -> A as well as a changed final snapshot. It is
    // per request, uses the existing authorities and never switches context.
    for (const port of [identity, selection].filter(Boolean)) {
      const unsubscribe = port.subscribe(observe);
      if (typeof unsubscribe !== "function") {
        throw new TypeError("Intelligence context subscription requires cleanup");
      }
      cleanups.push(unsubscribe);
    }
    assertCurrent();
    const guarded = Object.freeze({
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot: () => intelligence.getSnapshot(),
      subscribe: (listener) => intelligence.subscribe(listener),
      respond(value, { signal = null } = {}) {
        // Memory retrieval may synchronously publish a context change. Do not
        // send the retrieved old-owner context to inference in that case.
        assertCurrent();
        return intelligence.respond(value, { signal });
      },
    });
    const result = await respond(guarded, captured);
    assertCurrent();
    return result;
  } finally {
    closed = true;
    let cleanupFailed = false;
    for (const unsubscribe of cleanups.reverse()) {
      try { unsubscribe(); } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) throw new Error("Intelligence context observer cleanup failed");
    assertCurrent();
  }
}

export function createSelectedSpaceMemoryIntelligence({
  intelligencePort,
  memoryPort,
  spaceSelectionPort,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const memory = assertMemoryPort(memoryPort);
  const selection = assertSpaceSelectionPort(spaceSelectionPort);
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return intelligence.getSnapshot();
    },
    subscribe(listener) {
      return intelligence.subscribe(listener);
    },
    respond(value, { signal = null } = {}) {
      return withCurrentMemoryContext(intelligence, selection, null, (guarded, { selected: snapshot }) => {
        if (snapshot.state !== "selected") {
          return guarded.respond(validateIntelligenceRequest(value), { signal });
        }
        const authorized = createAuthorizedMemoryIntelligence({
          intelligencePort: guarded, memoryPort: memory,
        });
        return authorized.respond(value, {
          signal,
          authorizations: [{
            schema: "ordax.memory-context-auth/1",
            authority: "composition",
            ownerKind: "account",
            ownerId: snapshot.subjectId,
            scopes: ["space"],
            spaceId: snapshot.selectedSpace.id,
            projectId: null,
            includeRestricted: false,
          }],
        });
      });
    },
  });
}


export function createIdentityBoundMemoryIntelligence({
  intelligencePort,
  memoryPort,
  identitySessionPort,
  spaceSelectionPort,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const memory = assertMemoryPort(memoryPort);
  const identity = assertIdentitySessionPort(identitySessionPort);
  const selection = assertSpaceSelectionPort(spaceSelectionPort);
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return intelligence.getSnapshot();
    },
    subscribe(listener) {
      return intelligence.subscribe(listener);
    },
    async respond(value, { signal = null } = {}) {
      return withCurrentMemoryContext(intelligence, selection, identity, (guarded, {
        account: identitySnapshot, selected: selectionSnapshot,
      }) => {
        const authorizations = [{
          schema: "ordax.memory-context-auth/1",
          authority: "composition",
          ownerKind: "device",
          ownerId: null,
          scopes: ["device"],
          spaceId: null,
          projectId: null,
          includeRestricted: false,
        }];

        if (identitySnapshot.state === "signed-in") {
          authorizations.push({
            schema: "ordax.memory-context-auth/1",
            authority: "composition",
            ownerKind: "account",
            ownerId: identitySnapshot.subjectId,
            scopes: ["account"],
            spaceId: null,
            projectId: null,
            includeRestricted: false,
          });
        }

        if (selectionSnapshot.state === "selected") {
          if (
            identitySnapshot.state !== "signed-in"
            || selectionSnapshot.subjectId !== identitySnapshot.subjectId
          ) {
            throw new Error("Selected Space memory requires the current authenticated identity");
          }
          authorizations.push({
            schema: "ordax.memory-context-auth/1",
            authority: "composition",
            ownerKind: "account",
            ownerId: identitySnapshot.subjectId,
            scopes: ["space"],
            spaceId: selectionSnapshot.selectedSpace.id,
            projectId: null,
            includeRestricted: false,
          });
        }

        const authorized = createAuthorizedMemoryIntelligence({
          intelligencePort: guarded, memoryPort: memory,
        });
        return authorized.respond(value, { authorizations, signal });
      });
    },
  });
}
