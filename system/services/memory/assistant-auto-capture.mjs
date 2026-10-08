import {
  assertIntelligencePort,
  validateIntelligenceResponse,
} from "../../contracts/intelligence.mjs";
import {
  MEMORY_CAPTURE_AUTH_SCHEMA,
} from "../../contracts/memory-capture.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { memoryAutoCaptureEnabled } from "../preferences/memory.mjs";
import { MEMORY_CAPTURE_RUNTIME_SCHEMA } from "./capture.mjs";

export const ASSISTANT_AUTO_CAPTURE_SCHEMA = "ordax.assistant-auto-memory-capture/1";

const MAX_CANDIDATES = 4;
const MAX_CONTENT = 2048;
const MAX_EVIDENCE = 2048;
const ALLOWED_KINDS = new Set(["preference", "fact", "instruction", "summary"]);
const SECRET_SIGNAL = /(?:password|senha|passphrase|token|api[ -]?key|chave privada|private key|seed phrase|recovery code|c[oó]digo de recupera[cç][aã]o|\bcvv\b|\bpin\b|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{16,}\b|\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{16,}\b|\bsb_secret_[A-Za-z0-9_-]{16,}\b)/iu;

const EXTRACTION_PROMPT = [
  "Extract only durable memories directly supported by the supplied user turn.",
  "Return compact JSON only, with exact shape: {\"memories\":[{\"kind\":\"preference|fact|instruction|summary\",\"content\":\"...\",\"evidence\":\"exact verbatim quote from the supplied user turn\"}]}",
  "Use zero memories when the user turn contains no durable personal preference, stable fact, standing instruction, or useful durable summary.",
  "Every memory must include a non-empty evidence string copied verbatim from the supplied user turn.",
  "For automatic Memory, content must be exactly identical to evidence; do not paraphrase, summarize, normalize, or add facts.",
  "Never include passwords, passphrases, tokens, API keys, private keys, recovery codes, payment authentication data, or other credentials.",
  "Do not include owner, account, Space, scope, ids, sensitivity, timestamps, provenance, tools, or actions.",
  "Do not add markdown fences or prose.",
].join("\n");

function assertCaptureRuntime(value) {
  if (!value || typeof value !== "object" || value.schema !== MEMORY_CAPTURE_RUNTIME_SCHEMA) {
    throw new TypeError("Assistant automatic Memory requires a compatible capture runtime");
  }
  if (typeof value.capture !== "function") {
    throw new TypeError("Assistant automatic Memory capture runtime must implement capture()");
  }
  return value;
}

function boundedTurnText(value, label) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(label + " must be text");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 131072) {
    throw new TypeError(label + " is outside its allowed bounds");
  }
  return normalized;
}

function parseCandidates(text, userText) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return Object.freeze([]);
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || Object.keys(parsed).join(",") !== "memories"
    || !Array.isArray(parsed.memories)
    || parsed.memories.length > MAX_CANDIDATES
  ) {
    return Object.freeze([]);
  }

  const result = [];
  for (const candidate of parsed.memories) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return Object.freeze([]);
    }
    const keys = Object.keys(candidate).sort().join(",");
    if (keys !== "content,evidence,kind") return Object.freeze([]);
    if (!ALLOWED_KINDS.has(candidate.kind)) return Object.freeze([]);
    if (
      typeof candidate.content !== "string"
      || candidate.content.includes("\0")
      || typeof candidate.evidence !== "string"
      || candidate.evidence.includes("\0")
    ) {
      return Object.freeze([]);
    }
    const candidateContent = candidate.content.trim();
    const candidateEvidence = candidate.evidence.trim();
    if (!candidateContent || candidateContent.length > MAX_CONTENT) return Object.freeze([]);
    if (!candidateEvidence || candidateEvidence.length > MAX_EVIDENCE) return Object.freeze([]);
    if (!userText.includes(candidateEvidence)) continue;
    if (candidateContent !== candidateEvidence) continue;
    if (SECRET_SIGNAL.test(candidateEvidence)) continue;
    result.push(Object.freeze({
      kind: candidate.kind,
      content: candidateEvidence,
    }));
  }
  return Object.freeze(result);
}

function captureAuthorization(identityPort, spaceSelectionPort) {
  const identity = validateIdentitySessionSnapshot(identityPort.getSnapshot());
  if (identity.state === "unavailable") {
    throw new Error("Assistant Memory identity is unavailable");
  }
  if (identity.state === "signed-out") {
    if (validateSpaceSelectionSnapshot(spaceSelectionPort.getSnapshot()).state !== "unavailable") {
      throw new Error("Assistant Memory Space state is not settled");
    }
    return Object.freeze({
      schema: MEMORY_CAPTURE_AUTH_SCHEMA,
      authority: "composition",
      ownerKind: "device",
      ownerId: null,
      scope: "device",
      spaceId: null,
    });
  }

  const selection = validateSpaceSelectionSnapshot(spaceSelectionPort.getSnapshot());
  if (selection.state === "unavailable"
    || selection.subjectId !== identity.subjectId) {
    throw new Error("Assistant Memory Space ownership is not settled");
  }
  if (selection.state === "selected") {
    return Object.freeze({
      schema: MEMORY_CAPTURE_AUTH_SCHEMA,
      authority: "composition",
      ownerKind: "account",
      ownerId: identity.subjectId,
      scope: "space",
      spaceId: selection.selectedSpace.id,
    });
  }

  return Object.freeze({
    schema: MEMORY_CAPTURE_AUTH_SCHEMA,
    authority: "composition",
    ownerKind: "account",
    ownerId: identity.subjectId,
    scope: "account",
    spaceId: null,
  });
}

export function createAssistantAutoCaptureRuntime({
  intelligencePort,
  captureRuntime,
  preferenceRuntime,
  identitySessionPort,
  spaceSelectionPort,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const capture = assertCaptureRuntime(captureRuntime);
  const preferences = assertPreferenceRuntimePort(preferenceRuntime);
  const identity = assertIdentitySessionPort(identitySessionPort);
  const spaces = assertSpaceSelectionPort(spaceSelectionPort);

  return Object.freeze({
    schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,

    bindTurn() {
      const authorization = captureAuthorization(identity, spaces);
      const enabledAtBind = memoryAutoCaptureEnabled(preferences.getSnapshot());
      const currentScope = () => {
        try {
          const active = captureAuthorization(identity, spaces);
          return active.ownerKind === authorization.ownerKind
            && active.ownerId === authorization.ownerId
            && active.scope === authorization.scope
            && active.spaceId === authorization.spaceId;
        } catch {
          return false;
        }
      };
      const scopeChanged = () => Object.freeze({
        schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,
        status: "scope-changed",
        captured: 0,
      });

      return Object.freeze({
        async capture({ userText, isContextCurrent = () => true } = {}) {
          const user = boundedTurnText(userText, "Assistant Memory user turn");
          if (typeof isContextCurrent !== "function") {
            throw new TypeError("Assistant Memory context guard must be a function");
          }
          const mayCommit = () => currentScope() && isContextCurrent() === true;
          if (!mayCommit()) return scopeChanged();

          if (
            !enabledAtBind
            || !memoryAutoCaptureEnabled(preferences.getSnapshot())
          ) {
            return Object.freeze({
              schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,
              status: "disabled",
              captured: 0,
            });
          }

          const extractionUser = user.slice(0, 8192);
          let response;
          try {
            response = validateIntelligenceResponse(await intelligence.respond({
              intent: "summarize",
              prompt: EXTRACTION_PROMPT,
              context: [{
                id: "assistant-user-turn",
                scope: "user",
                text: extractionUser,
                provenance: "ordax-assistant:user-turn",
              }],
              maxTokens: 384,
            }));
          } catch {
            return Object.freeze({
              schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,
              status: "extract-error",
              captured: 0,
            });
          }

          if (!mayCommit()) return scopeChanged();
          const candidates = parseCandidates(response.text, extractionUser);
          if (candidates.length === 0) {
            return Object.freeze({
              schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,
              status: "no-candidates",
              captured: 0,
            });
          }

          let captured = 0;
          for (const candidate of candidates) {
            if (!mayCommit()) {
              return Object.freeze({
                schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,
                status: "scope-changed",
                captured,
              });
            }
            try {
              const result = await capture.capture({
                content: candidate.content,
                kind: candidate.kind,
                sensitivity: "private",
                provenance: "ordax-assistant:auto-capture",
              }, authorization);
              if (result === null) {
                return Object.freeze({
                  schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,
                  status: "disabled",
                  captured,
                });
              }
              captured += 1;
              if (!mayCommit()) {
                return Object.freeze({
                  schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,
                  status: "scope-changed",
                  captured,
                });
              }
            } catch {
              return Object.freeze({
                schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,
                status: "capture-error",
                captured,
              });
            }
          }

          return Object.freeze({
            schema: ASSISTANT_AUTO_CAPTURE_SCHEMA,
            status: "captured",
            captured,
          });
        },
      });
    },
  });
}
