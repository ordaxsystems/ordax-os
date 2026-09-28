import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_HANDOFF_SCHEMA,
  encodeIntelligenceHandoffTarget,
  parseIntelligenceHandoffTarget,
  validateIntelligenceHandoff,
} from "../system/contracts/intelligence-handoff.mjs";

test("typed Intelligence handoff round-trips without carrying execution authority", () => {
  const encoded = encodeIntelligenceHandoffTarget({
    sourceAppId: "projects",
    mode: "plan",
    target: { kind: "project", id: "project-123" },
    displayLabel: "Aurora",
    suggestedPrompt: "Crie um plano para este projeto.",
  });
  const handoff = parseIntelligenceHandoffTarget(encoded);

  assert.equal(handoff.schema, INTELLIGENCE_HANDOFF_SCHEMA);
  assert.equal(handoff.sourceAppId, "projects");
  assert.equal(handoff.mode, "plan");
  assert.deepEqual(handoff.target, { kind: "project", id: "project-123" });
  assert.equal(handoff.displayLabel, "Aurora");
  assert.equal(handoff.suggestedPrompt, "Crie um plano para este projeto.");
  assert.equal(handoff.authority, "none");
  assert.equal(handoff.executable, false);
  assert.equal(handoff.toolExecution, false);
});

test("handoff rejects authority-shaped values and unspecified targets", () => {
  assert.throws(
    () => validateIntelligenceHandoff({
      sourceAppId: "projects",
      mode: "plan",
      target: { kind: "project", id: "project-1" },
      authority: "model",
      executable: true,
      toolExecution: true,
    }),
    /cannot grant execution authority/,
  );
  assert.throws(
    () => validateIntelligenceHandoff({
      sourceAppId: "projects",
      mode: "plan",
      target: null,
    }),
    /requires a concrete target/,
  );
});

test("handoff target does not accept capability, context, or unknown query injection", () => {
  const valid = encodeIntelligenceHandoffTarget({
    sourceAppId: "projects",
    mode: "plan",
    target: { kind: "project", id: "project-1" },
  });

  assert.throws(
    () => parseIntelligenceHandoffTarget(`${valid}&context=private`),
    /query is invalid/,
  );
  assert.throws(
    () => parseIntelligenceHandoffTarget(`${valid}&mode=ask`),
    /query is invalid/,
  );
  assert.equal(parseIntelligenceHandoffTarget("/Documentos"), null);
});

test("handoff is a bounded deep link rather than an automatic inference request", () => {
  const encoded = encodeIntelligenceHandoffTarget({
    sourceAppId: "files",
    mode: "ask",
    target: { kind: "document", id: "doc-1" },
    displayLabel: "Documento",
  });
  assert.ok(encoded.startsWith("ordax-intelligence://handoff/v1?"));
  assert.ok(encoded.length < 4096);
  assert.doesNotMatch(encoded, /capabilit|toolExecution|authority|context=/i);
});
