import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createNativeVerifiedComponentArtifactIdentity,
} from "../system/adapters/native/verified-component-artifact-identity.mjs";

const ORIGIN = "http://127.0.0.1:43121";
const MODULE_URL =
  `${ORIGIN}/__ordax/native/component-module/notes/current/0.4.2/${"7".repeat(40)}/system/apps/notes/actions/providers/notes-native.mjs`;

function digestArrayBuffer(bytes) {
  const hash = createHash("sha256").update(Buffer.from(bytes)).digest();
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
}

function windowRef({
  body = new TextEncoder().encode("export const provider = true;"),
  contentLength = null,
  status = 200,
} = {}) {
  const calls = [];
  return {
    calls,
    location: { href: `${ORIGIN}/surface/` },
    crypto: {
      subtle: {
        async digest(algorithm, bytes) {
          assert.equal(algorithm, "SHA-256");
          return digestArrayBuffer(bytes);
        },
      },
    },
    async fetch(url, options) {
      calls.push({ url, options });
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-length" ? contentLength : null;
          },
        },
        async arrayBuffer() {
          return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
        },
      };
    },
  };
}

test("verified artifact identity hashes exact same-origin provider module bytes", async () => {
  const host = windowRef();
  const identity = createNativeVerifiedComponentArtifactIdentity(host);
  const actual = await identity(MODULE_URL);
  const expected = createHash("sha256")
    .update("export const provider = true;")
    .digest("hex");

  assert.equal(actual, expected);
  assert.equal(host.calls.length, 1);
  assert.equal(host.calls[0].url, MODULE_URL);
  assert.deepEqual(host.calls[0].options, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
});

test("verified artifact identity rejects escaped or non-module URLs before fetch", async () => {
  const host = windowRef();
  const identity = createNativeVerifiedComponentArtifactIdentity(host);

  await assert.rejects(
    () => identity("https://example.com/__ordax/native/component-module/notes/provider.mjs"),
    /escaped the verified module namespace/,
  );
  await assert.rejects(
    () => identity(`${ORIGIN}/__ordax/native/component-runtime?component=notes`),
    /escaped the verified module namespace/,
  );
  await assert.rejects(
    () => identity(`${MODULE_URL}?cache=1`),
    /escaped the verified module namespace/,
  );
  assert.equal(host.calls.length, 0);
});

test("verified artifact identity fails closed for oversized or unavailable modules", async () => {
  const oversized = windowRef({ contentLength: String(1024 * 1024 + 1) });
  await assert.rejects(
    () => createNativeVerifiedComponentArtifactIdentity(oversized)(MODULE_URL),
    /bounded module size/,
  );

  const unavailable = windowRef({ status: 404 });
  await assert.rejects(
    () => createNativeVerifiedComponentArtifactIdentity(unavailable)(MODULE_URL),
    /HTTP 404/,
  );
});
