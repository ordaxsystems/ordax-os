import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACES_PORT_SCHEMA,
  SPACES_SNAPSHOT_SCHEMA,
  assertSpacesPort,
  validateSpacesSnapshot,
} from "../system/contracts/spaces.mjs";
import { createWebSpacesCatalog } from "../system/adapters/web/spaces.mjs";

function reply(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return payload;
    },
  };
}

test("Spaces catalog reads only authenticated same-origin data and clears on reset", async () => {
  const calls = [];
  const windowRef = {
    fetch: async (url, options) => {
      calls.push([url, options]);
      return reply(200, {
        $schema: "prototype-ordax.account-spaces/1",
        spaces: [{
          id: "space-1",
          ownerId: "user-1",
          name: "Developer",
          kind: "professional",
          state: "active",
          profilePack: "developer",
          domain: "development",
          subtype: "software",
        }],
      });
    },
  };
  const catalog = createWebSpacesCatalog(windowRef);
  assert.equal(assertSpacesPort(catalog), catalog);

  const ready = await catalog.refresh();
  assert.equal(ready.state, "ready");
  assert.equal(ready.spaces.length, 1);
  assert.equal(ready.spaces[0].profilePack, "developer");
  assert.equal(ready.spaces[0].domain, "development");
  assert.equal(ready.spaces[0].subtype, "software");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/account/spaces");
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].credentials, "same-origin");
  assert.equal(calls[0][1].cache, "no-store");

  catalog.reset();
  assert.deepEqual(catalog.getSnapshot(), {
    schema: SPACES_SNAPSHOT_SCHEMA,
    state: "unavailable",
    spaces: [],
  });
});

test("Spaces catalog fails closed for unauthenticated or malformed replies", async () => {
  let mode = "unauthenticated";
  const catalog = createWebSpacesCatalog({
    fetch: async () => mode === "unauthenticated"
      ? reply(401, { error: "authentication-required" })
      : reply(200, { $schema: "wrong", spaces: [] }),
  });

  assert.equal((await catalog.refresh()).state, "unavailable");
  mode = "malformed";
  assert.equal((await catalog.refresh()).state, "error");
  assert.deepEqual(catalog.getSnapshot().spaces, []);
});

test("Spaces snapshot rejects duplicate identities and stale non-ready data", () => {
  const space = {
    id: "space-1",
    ownerId: "user-1",
    name: "Work",
    kind: "work",
    state: "active",
    profilePack: null,
  };
  assert.throws(
    () => validateSpacesSnapshot({
      schema: SPACES_SNAPSHOT_SCHEMA,
      state: "ready",
      spaces: [space, space],
    }),
    /duplicate ids/,
  );
  assert.throws(
    () => validateSpacesSnapshot({
      schema: SPACES_SNAPSHOT_SCHEMA,
      state: "unavailable",
      spaces: [space],
    }),
    /must not expose stale spaces/,
  );
});

test("Spaces port exposed to Surface rejects domain mutation methods", () => {
  const snapshot = Object.freeze({
    schema: SPACES_SNAPSHOT_SCHEMA,
    state: "ready",
    spaces: Object.freeze([]),
  });
  const readOnlyPort = {
    schema: SPACES_PORT_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
    reset: () => snapshot,
  };

  assert.equal(assertSpacesPort(readOnlyPort), readOnlyPort);

  for (const method of [
    "archive",
    "create",
    "delete",
    "execute",
    "mutate",
    "remove",
    "restore",
    "update",
  ]) {
    const mutablePort = {
      ...readOnlyPort,
      [method]: () => {},
    };
    assert.throws(
      () => assertSpacesPort(mutablePort),
      new RegExp(`must not implement ${method}\\(\\)`),
    );
  }
});
