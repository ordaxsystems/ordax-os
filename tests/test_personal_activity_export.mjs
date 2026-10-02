import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import {
  PERSONAL_ACTIVITY_EXPORT_SCHEMA,
  MAX_PERSONAL_ACTIVITY_EXPORT_BYTES,
  validatePersonalActivityExportDocument,
} from "../system/contracts/personal-activity-export.mjs";
import { createPersonalActivityExportDocument } from "../system/services/personal-ordax/export.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";

function identitySession() {
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return { state: "signed-out", subjectId: null, displayName: null };
    },
    subscribe() {
      return () => {};
    },
  };
}

function intelligence() {
  return {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return {
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
        toolExecution: false,
      };
    },
    subscribe() {
      return () => {};
    },
    async respond() {
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "resultado exportável",
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      };
    },
  };
}

test("Activity export is bounded, owner-scoped and intentionally non-replayable", async () => {
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySession(),
    intelligencePort: intelligence(),
  });
  const work = runtime.create("Produzir histórico");
  await runtime.run(work.id);

  const document = createPersonalActivityExportDocument(
    runtime.getSnapshot(),
    { clock: () => "2026-10-02T18:00:00.000Z" },
  );
  assert.equal(document.schema, PERSONAL_ACTIVITY_EXPORT_SCHEMA);
  assert.equal(document.fileName, "ordax-activity-20261002T180000731Z.json");
  assert.equal(document.mediaType, "application/json");
  assert.ok(document.bytes.byteLength > 0);
  assert.ok(document.bytes.byteLength <= MAX_PERSONAL_ACTIVITY_EXPORT_BYTES);

  const payload = JSON.parse(new TextDecoder().decode(document.bytes));
  assert.equal(payload.schema, PERSONAL_ACTIVITY_EXPORT_SCHEMA);
  assert.equal(payload.authorityReplayable, false);
  assert.equal(payload.owner.ownerKind, "device");
  assert.equal(payload.owner.ownerId, null);
  assert.equal(payload.workItems.length, 1);
  assert.equal(payload.results[0].text, "resultado exportável");
  assert.equal("nextOrdinal" in payload, false);
  assert.equal("schema" in payload.workItems[0], true);

  runtime.dispose();
});

test("Activity export contract rejects unbounded or ambiguous files", () => {
  assert.throws(
    () => validatePersonalActivityExportDocument({
      schema: PERSONAL_ACTIVITY_EXPORT_SCHEMA,
      fileName: "../activity.json",
      mediaType: "application/json",
      bytes: new Uint8Array([1]),
    }),
    /filename/,
  );
  assert.throws(
    () => validatePersonalActivityExportDocument({
      schema: PERSONAL_ACTIVITY_EXPORT_SCHEMA,
      fileName: "ordax-activity-20261002T180000731Z.json",
      mediaType: "text/plain",
      bytes: new Uint8Array([1]),
    }),
    /mediaType/,
  );
});

test("export implementation strips grant references and Native adapter reuses bounded file-space", async () => {
  const service = await readFile(
    new URL("../system/services/personal-ordax/export.mjs", import.meta.url),
    "utf8",
  );
  const adapter = await readFile(
    new URL("../system/adapters/native/personal-activity-export.mjs", import.meta.url),
    "utf8",
  );
  assert.match(service, /if \("grantRef" in copy\) copy\.grantRef = null/);
  assert.match(service, /authorityReplayable:\s*false/);
  assert.match(adapter, /assertFileSpacePort/);
  assert.match(adapter, /fileSpace\.importFile/);
  assert.match(adapter, /NATIVE_PERSONAL_ACTIVITY_EXPORT_DIRECTORY = "\/Downloads"/);
  assert.doesNotMatch(adapter, /fetch\(|localStorage|sessionStorage|grant|approval/i);
});
