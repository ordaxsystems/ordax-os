import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  INTELLIGENCE_CONVERSATION_CAPABILITIES_SCHEMA,
  projectIntelligenceConversationCapabilities,
} from "../system/contracts/intelligence-conversation-capabilities.mjs";
import {
  PERSONAL_ORDAX_RUNTIME_SCHEMA,
  validatePersonalOrdaxRuntimeSnapshot,
} from "../system/contracts/personal-ordax-store.mjs";

const bundle = JSON.parse(readFileSync(new URL("../sdk/app-sdk-v1/bundle.json", import.meta.url), "utf8"));
const published = new Map(bundle.contracts.map(entry => [entry.name, entry]));
const required = ["intelligence-conversation-capabilities","personal-action-attempt","personal-action-decision","personal-activity","personal-approval","personal-runtime","personal-work-item","personal-work-result","personal-work-store","personal-work-store-state"];

test("Assistant dependency closure is canonical, immutable and data-only", () => {
  assert.equal(bundle.bundle_version, "1.18.0");
  assert.equal(bundle.authority, "none");
  for (const name of required) {
    const item = published.get(name);
    assert.ok(item, name);
    assert.ok(item.source_path.startsWith("system/contracts/"));
    assert.equal(item.major, 1);
    const source = readFileSync(new URL("../" + item.source_path, import.meta.url));
    const actual = createHash("sha1")
      .update(Buffer.from("blob " + source.byteLength + String.fromCharCode(0)))
      .update(source).digest("hex");
    assert.equal(item.source_git_blob, actual, name + " must bind exact Git blob");
  }
  assert.equal(published.get("intelligence-conversation-capabilities").schema,
    INTELLIGENCE_CONVERSATION_CAPABILITIES_SCHEMA);
  assert.equal(published.get("personal-runtime").schema, PERSONAL_ORDAX_RUNTIME_SCHEMA);
  assert.ok(bundle.contracts.every(item => item.source_path.startsWith("system/contracts/")));
  assert.equal(bundle.contracts.some(item => item.name === "assistant-owner-mutation"), false);
});

test("conversation projection never grants execution or implies remote provider", () => {
  const view = projectIntelligenceConversationCapabilities({
    schema: "ordax.intelligence/1", state: "unavailable",
    inferenceAvailable: false, engineId: null, modelId: null,
    authority: "none", toolExecution: false,
  });
  assert.equal(view.authority, "none");
  assert.equal(view.toolExecution, false);
  assert.equal(view.provider, "unavailable");
});

test("Personal runtime validator never carries caller-supplied authority into the validated value", () => {
  const snapshot = validatePersonalOrdaxRuntimeSnapshot({
    schema: PERSONAL_ORDAX_RUNTIME_SCHEMA, persistence: "device",
    ownerKind: "device", ownerId: null, nextOrdinal: 1,
    workItems: [], activities: [], results: [], approvals: [], decisions: [], attempts: [],
    authority: "grant", grantRef: "fake", create: () => true,
  });
  assert.equal(snapshot.schema, PERSONAL_ORDAX_RUNTIME_SCHEMA);
  assert.equal(snapshot.authority, undefined);
  assert.equal(snapshot.grantRef, undefined);
  assert.equal(snapshot.create, undefined);
  assert.ok(Object.isFrozen(snapshot));
});
