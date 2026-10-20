import test from "node:test";
import assert from "node:assert/strict";
import { createNativeOwnerRemotePermissions } from "../system/adapters/native/owner-remote-permissions.mjs";
const DEVICE = "24630b00-e9c0-4d93-b38a-2367048cd9d1";
const CLIENT = "37d8b52b-cf98-4dc4-867c-726cb340b610";
const snapshot = { schema: "ordax.owner-remote-permissions/1", device_id: DEVICE,
  clients: [{ client_id: CLIENT, client_name: "ChatGPT" }], grant_groups: [] };
test("Native Owner MCP grant adapter uses only canonical same-origin route", async () => {
  const calls = [];
  const port = createNativeOwnerRemotePermissions({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => snapshot };
    },
  });
  assert.deepEqual(await port.read(), snapshot);
  assert.deepEqual(await port.configure(CLIENT, true), snapshot);
  assert.deepEqual(calls.map(x => [x.url, x.options.method]), [
    ["/__ordax/native/remote-permissions", "GET"],
    ["/__ordax/native/remote-permissions", "POST"],
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), { client_id: CLIENT, enabled: true });
  assert.equal(calls[1].options.credentials, "same-origin");
});
test("Invalid OAuth IDs and malformed authorities fail closed", async () => {
  const port = createNativeOwnerRemotePermissions({ fetch: async () => ({
    ok: true, json: async () => ({ ...snapshot, clients: [{}] }),
  }) });
  assert.throws(() => port.configure("not-a-uuid", true), TypeError);
  await assert.rejects(port.read(), TypeError);
});
