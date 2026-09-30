import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import {
  NATIVE_FILE_ACTION_TOOL_ID,
  NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
  createNativePersonalOrdaxFileActions,
} from "../system/adapters/native/personal-ordax-file-actions.mjs";
import { readNativeToolArtifactSha256 } from "../system/adapters/native/tool-artifact-identity.mjs";

function fileSpace({ listingTransform = (value) => value } = {}) {
  const calls = [];
  let listedEntries = [];
  const port = {
    schema: FILE_SPACE_SCHEMA,
    async list(path = "/") {
      return { path, entries: listedEntries };
    },
    async createDirectory(path, name) {
      calls.push({ path, name });
      listedEntries = [{ name, kind: "directory", size: 0, modifiedAt: 1 }];
      return listingTransform({
        path,
        entries: [{
          name,
          kind: "directory",
          size: 0,
          modifiedAt: 1,
        }],
      });
    },
    async readTextFile() { throw new Error("unused"); },
    async renameEntry() { throw new Error("unused"); },
    async copyFile() { throw new Error("unused"); },
    async moveEntry() { throw new Error("unused"); },
    async trashEntry() { throw new Error("unused"); },
    async listTrash() { throw new Error("unused"); },
    async restoreTrashEntry() { throw new Error("unused"); },
    async exportFile() { throw new Error("unused"); },
    async importFile() { throw new Error("unused"); },
  };
  return { port, calls };
}

test("Native tool artifact identity hashes exact same-origin source bytes", async () => {
  let fetched = null;
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const windowRef = {
    location: { href: "https://ordax.local/native/index.html" },
    async fetch(url, options) {
      fetched = { url, options };
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return bytes.buffer;
        },
      };
    },
    crypto: {
      subtle: {
        async digest(algorithm, received) {
          assert.equal(algorithm, "SHA-256");
          assert.deepEqual(new Uint8Array(received), bytes);
          return new Uint8Array(32).fill(0x12).buffer;
        },
      },
    },
  };

  const digest = await readNativeToolArtifactSha256(
    windowRef,
    "https://ordax.local/system/adapters/native/tool.mjs",
  );
  assert.equal(digest, "12".repeat(32));
  assert.equal(fetched.url, "https://ordax.local/system/adapters/native/tool.mjs");
  assert.equal(fetched.options.cache, "no-store");
  assert.equal(fetched.options.credentials, "same-origin");

  await assert.rejects(
    () => readNativeToolArtifactSha256(windowRef, "https://example.com/tool.mjs"),
    /same-origin/,
  );
});

test("Native create-directory adapter exposes one bounded first-party action", async () => {
  const files = fileSpace();
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    async artifactIdentity(_windowRef, moduleUrl) {
      assert.match(moduleUrl, /personal-ordax-file-actions\.mjs$/);
      return "c".repeat(64);
    },
  });

  assert.equal(actions.tool.id, NATIVE_FILE_ACTION_TOOL_ID);
  assert.equal(actions.tool.artifactSha256, "c".repeat(64));
  assert.equal(actions.tool.sandbox, "native-broker");
  assert.equal(actions.tool.network.allowed, false);
  assert.deepEqual(
    actions.tool.actions.map((action) => action.id),
    [NATIVE_FILE_ENSURE_DIRECTORY_ACTION],
  );

  const adapter = actions.adapterResolver(
    NATIVE_FILE_ACTION_TOOL_ID,
    NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
  );
  assert.ok(adapter);
  assert.equal(adapter.artifactSha256, actions.tool.artifactSha256);

  const result = await adapter.execute({
    resourceRef: "file-space:/Documentos/Novo Projeto",
  });
  assert.deepEqual(files.calls, [{
    path: "/Documentos",
    name: "Novo Projeto",
  }]);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.artifactRefs, ["file-space:/Documentos/Novo Projeto"]);
});

test("Native ensure-directory action is idempotent when the exact directory already exists", async () => {
  const files = fileSpace();
  await files.port.createDirectory("/Documentos", "Existente");
  files.calls.length = 0;
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => "f".repeat(64),
  });
  const adapter = actions.adapterResolver(
    NATIVE_FILE_ACTION_TOOL_ID,
    NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
  );

  const result = await adapter.execute({
    resourceRef: "file-space:/Documentos/Existente",
  });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(files.calls, []);
});

test("Native create-directory adapter cannot escape the canonical file-space", async () => {
  const files = fileSpace();
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => "d".repeat(64),
  });
  const adapter = actions.adapterResolver(
    NATIVE_FILE_ACTION_TOOL_ID,
    NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
  );

  for (const resourceRef of [
    "https://example.com/file",
    "file-space:/",
    "file-space:/Documentos/../Fora",
    "file-space:relative",
  ]) {
    await assert.rejects(
      () => adapter.execute({ resourceRef }),
      /file-space|root|invalid|absolute/,
    );
  }
  assert.deepEqual(files.calls, []);
});

test("Native create-directory adapter fails when host result does not prove the effect", async () => {
  const files = fileSpace({
    listingTransform(value) {
      return { ...value, entries: [] };
    },
  });
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => "e".repeat(64),
  });
  const adapter = actions.adapterResolver(
    NATIVE_FILE_ACTION_TOOL_ID,
    NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
  );

  await assert.rejects(
    () => adapter.execute({ resourceRef: "file-space:/Documentos/Novo" }),
    /could not verify/,
  );
});
