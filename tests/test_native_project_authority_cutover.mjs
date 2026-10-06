import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PROJECT_STORE_SCHEMA } from "../system/contracts/project-store.mjs";
import { createNativeProjectAuthorityComposition } from "../system/composition/native/projects-authority.mjs";

const nativeCompositionSource = readFileSync(
  fileURLToPath(new URL("../system/composition/native/main.mjs", import.meta.url)),
  "utf8",
);

function projectState(name = "Finance App") {
  return Object.freeze({
    nextOrdinal: 2,
    projects: Object.freeze([
      Object.freeze({
        id: "project-1",
        name,
        path: "/Documentos/finance-app",
        createdAt: 1000,
        lastOpenedAt: 1000,
        lastFilePath: null,
      }),
    ]),
  });
}

function legacyStore(state, events = []) {
  return Object.freeze({
    schema: PROJECT_STORE_SCHEMA,
    scope: "device",
    load() {
      events.push("legacy-read");
      return state;
    },
    save() {
      events.push("legacy-write");
      throw new Error("legacy store must not be written during authority cutover");
    },
  });
}

function nativeTransport(initialRecord, events = []) {
  let record = initialRecord;
  return Object.freeze({
    async read() {
      events.push("native-read");
      return record;
    },
    async compareAndSwap(expectedRevision, state) {
      events.push(`native-cas:${expectedRevision}`);
      const currentRevision = record?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        return Object.freeze({ accepted: false, revision: null });
      }
      record = Object.freeze({
        revision: expectedRevision + 1,
        state,
      });
      return Object.freeze({ accepted: true, revision: record.revision });
    },
    inspect() {
      return record;
    },
  });
}

test("Project authority cutover migrates first and then serves only the Native CAS runtime", async () => {
  const legacyEvents = [];
  const nativeEvents = [];
  const transport = nativeTransport(null, nativeEvents);

  const authority = await createNativeProjectAuthorityComposition({
    legacyStore: legacyStore(projectState(), legacyEvents),
    nativeTransport: transport,
    now: () => 2000,
  });

  assert.equal(authority.migrationResult.status, "migrated");
  assert.deepEqual(nativeEvents, [
    "native-read",
    "native-cas:0",
    "native-read",
    "native-read",
  ]);
  assert.equal(legacyEvents.includes("legacy-write"), false);
  assert.deepEqual(authority.reader.getSnapshot(), {
    persistence: "device",
    projects: projectState().projects,
  });

  await authority.mutations.rename("project-1", "Finance Pro");
  assert.equal(authority.reader.getSnapshot().projects[0].name, "Finance Pro");
  assert.equal(transport.inspect().revision, 2);
  assert.equal(legacyEvents.includes("legacy-write"), false);
});

test("Project authority cutover fails closed on legacy/Native divergence", async () => {
  const nativeEvents = [];
  const transport = nativeTransport(
    Object.freeze({ revision: 4, state: projectState("Different Native State") }),
    nativeEvents,
  );

  await assert.rejects(
    createNativeProjectAuthorityComposition({
      legacyStore: legacyStore(projectState()),
      nativeTransport: transport,
    }),
    /legacy and Native states diverged/,
  );

  assert.deepEqual(nativeEvents, ["native-read"]);
  assert.equal(transport.inspect().revision, 4);
});

test("Project authority cutover never falls back to legacy state when Native is unavailable", async () => {
  const store = legacyStore(projectState());
  const unavailable = Object.freeze({
    async read() {
      throw new Error("Native Project route unavailable");
    },
    async compareAndSwap() {
      throw new Error("must not be reached");
    },
  });

  await assert.rejects(
    createNativeProjectAuthorityComposition({
      legacyStore: store,
      nativeTransport: unavailable,
    }),
    /Native Project route unavailable/,
  );
});

test("Native production composition uses the typed Project authority instead of the legacy store", () => {
  assert.match(
    nativeCompositionSource,
    /createNativeProjectStateTransport/,
    "Native composition must construct the typed Project state transport",
  );
  assert.match(
    nativeCompositionSource,
    /createNativeProjectAuthorityComposition/,
    "Native composition must execute migration before creating Project authority",
  );
  assert.doesNotMatch(
    nativeCompositionSource,
    /createNativeProjectStore\(window\)/,
    "legacy localStorage Project store must not remain normal production authority",
  );
  assert.match(
    nativeCompositionSource,
    /projectMutations:\s*projectMutations/,
    "File Space continuity must receive explicit Project mutation authority",
  );
});
