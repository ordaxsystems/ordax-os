import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { PROJECT_MUTATIONS_SCHEMA } from "../system/contracts/project-mutations.mjs";
import { createNativeProjectCatalogCasRuntime } from "../system/services/files/native-project-catalog-runtime.mjs";

function clone(value) {
  return value === null ? null : structuredClone(value);
}

function transport(initialRecord = null) {
  let record = clone(initialRecord);
  const writes = [];
  return {
    writes,
    async read() {
      return clone(record);
    },
    async compareAndSwap(expectedRevision, state) {
      const currentRevision = record?.revision ?? 0;
      writes.push({ expectedRevision, state: clone(state) });
      if (expectedRevision !== currentRevision) {
        return { accepted: false, revision: null };
      }
      record = { revision: currentRevision + 1, state: clone(state) };
      return { accepted: true, revision: record.revision };
    },
    current() {
      return clone(record);
    },
  };
}

function externalState(name = "External") {
  return {
    nextOrdinal: 2,
    projects: [{
      id: "project-1",
      name,
      path: `/Documentos/${name}`,
      createdAt: 10,
      lastOpenedAt: 10,
      lastFilePath: null,
    }],
  };
}

test("Native Project CAS runtime exposes separate reader and async mutation authority", async () => {
  const native = transport();
  const runtime = await createNativeProjectCatalogCasRuntime({ transport: native, now: () => 20 });

  assert.equal(runtime.reader.schema, PROJECT_CATALOG_SCHEMA);
  assert.equal(runtime.mutations.schema, PROJECT_MUTATIONS_SCHEMA);
  assert.equal(Object.hasOwn(runtime.reader, "create"), false);
  assert.equal(Object.hasOwn(runtime.mutations, "getSnapshot"), false);
  assert.deepEqual(runtime.reader.getSnapshot(), { persistence: "device", projects: [] });

  const pending = runtime.mutations.create({ name: "Financeiro", path: "/Documentos/Financeiro" });
  assert.equal(typeof pending?.then, "function");
  const snapshot = await pending;
  assert.equal(snapshot.persistence, "device");
  assert.equal(snapshot.projects[0].id, "project-1");
  assert.equal(native.current().revision, 1);
});

test("Native Project CAS runtime serializes local mutations without lost updates", async () => {
  let clock = 100;
  const native = transport();
  const runtime = await createNativeProjectCatalogCasRuntime({
    transport: native,
    now: () => clock++,
  });

  await Promise.all([
    runtime.mutations.create({ name: "A", path: "/Documentos/A" }),
    runtime.mutations.create({ name: "B", path: "/Documentos/B" }),
  ]);

  const snapshot = runtime.reader.getSnapshot();
  assert.deepEqual(snapshot.projects.map((project) => project.id), ["project-2", "project-1"]);
  assert.equal(native.current().revision, 2);
  assert.deepEqual(native.writes.map((write) => write.expectedRevision), [0, 1]);
});

test("Native Project CAS runtime rebases a mutation after an external CAS winner", async () => {
  let record = null;
  let first = true;
  const native = {
    async read() {
      return clone(record);
    },
    async compareAndSwap(expectedRevision, state) {
      if (first) {
        first = false;
        record = { revision: 1, state: externalState() };
        return { accepted: false, revision: null };
      }
      assert.equal(expectedRevision, 1);
      record = { revision: 2, state: clone(state) };
      return { accepted: true, revision: 2 };
    },
  };
  const runtime = await createNativeProjectCatalogCasRuntime({ transport: native, now: () => 30 });
  const observed = [];
  runtime.reader.subscribe((snapshot) => observed.push(snapshot.projects.map((project) => project.id)));

  const snapshot = await runtime.mutations.create({
    name: "Financeiro",
    path: "/Documentos/Financeiro",
  });

  assert.deepEqual(snapshot.projects.map((project) => project.id), ["project-2", "project-1"]);
  assert.equal(record.revision, 2);
  assert.deepEqual(observed, [["project-1"], ["project-2", "project-1"]]);
});

test("Native Project CAS runtime recomputes domain validation after conflict", async () => {
  let record = null;
  let first = true;
  const native = {
    async read() {
      return clone(record);
    },
    async compareAndSwap() {
      if (first) {
        first = false;
        record = { revision: 1, state: externalState("Financeiro") };
        return { accepted: false, revision: null };
      }
      throw new Error("second CAS must not happen after domain conflict");
    },
  };
  const runtime = await createNativeProjectCatalogCasRuntime({ transport: native, now: () => 40 });

  await assert.rejects(
    runtime.mutations.create({ name: "Outro", path: "/Documentos/Financeiro" }),
    /already registered as a project/,
  );
  assert.deepEqual(runtime.reader.getSnapshot().projects.map((project) => project.id), ["project-1"]);
});

test("Native Project CAS runtime fails closed after bounded repeated conflicts", async () => {
  let reads = 0;
  const native = {
    async read() {
      reads += 1;
      return null;
    },
    async compareAndSwap() {
      return { accepted: false, revision: null };
    },
  };
  const runtime = await createNativeProjectCatalogCasRuntime({
    transport: native,
    now: () => 50,
    maxAttempts: 2,
  });

  await assert.rejects(
    runtime.mutations.create({ name: "A", path: "/Documentos/A" }),
    /changed concurrently too many times/,
  );
  assert.equal(reads, 3);
  assert.deepEqual(runtime.reader.getSnapshot(), { persistence: "device", projects: [] });
});

test("Native Project CAS runtime keeps no-op mutations write-free", async () => {
  const native = transport({ revision: 3, state: externalState() });
  const runtime = await createNativeProjectCatalogCasRuntime({ transport: native, now: () => 60 });

  await runtime.mutations.rename("project-1", "External");
  await runtime.mutations.remove("project-99");

  assert.equal(native.writes.length, 0);
  assert.equal(native.current().revision, 3);
});

test("Native Project CAS runtime validates transport and response contracts", async () => {
  await assert.rejects(
    createNativeProjectCatalogCasRuntime({ transport: {} }),
    /requires a CAS state transport/,
  );

  await assert.rejects(
    createNativeProjectCatalogCasRuntime({
      transport: {
        async read() { return { revision: 0, state: externalState() }; },
        async compareAndSwap() { return { accepted: true, revision: 1 }; },
      },
    }),
    /invalid record/,
  );

  const runtime = await createNativeProjectCatalogCasRuntime({
    transport: {
      async read() { return null; },
      async compareAndSwap() { return { accepted: true, revision: 99 }; },
    },
    now: () => 70,
  });
  await assert.rejects(
    runtime.mutations.create({ name: "A", path: "/Documentos/A" }),
    /CAS revision is invalid/,
  );
});
