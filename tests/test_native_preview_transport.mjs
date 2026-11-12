import assert from "node:assert/strict";
import test from "node:test";
import { createNativeFileSpace } from "../system/adapters/native/file-space.mjs";
import { MAX_IMAGE_PREVIEW_BYTES, MAX_MEDIA_PREVIEW_BYTES, MAX_DOCUMENT_PREVIEW_BYTES } from "../system/contracts/file-space.mjs";

async function harness({ mime, chunks = [], length = null, failure = null, status = 200 }) {
  let reads = 0;
  let cancelled = false;
  let released = false;
  let calls = 0;
  const reader = {
    async read() {
      if (failure) throw failure;
      const value = chunks[reads++];
      return value === undefined ? { done: true } : { done: false, value };
    },
    async cancel() { cancelled = true; },
    releaseLock() { released = true; },
  };
  const files = await createNativeFileSpace({ async fetch(url) {
    calls++;
    if (url.startsWith("/__ordax/native/files?")) return { ok: true, async json() { return { path: "/", entries: [] }; } };
    return {
      ok: status === 200, status,
      headers: new Headers({ "Content-Type": mime, ...(length === null ? {} : { "Content-Length": length }) }),
      body: { getReader() { return reader; }, async cancel() { cancelled = true; } },
      arrayBuffer() { throw new Error("unbounded body reads are forbidden"); },
    };
  } });
  return { files, state: () => ({ reads, cancelled, released, calls }) };
}

for (const [method, mime, limit] of [
  ["readImagePreview", "image/png", MAX_IMAGE_PREVIEW_BYTES],
  ["readMediaPreview", "video/mp4", MAX_MEDIA_PREVIEW_BYTES],
  ["readDocumentPreview", "application/pdf", MAX_DOCUMENT_PREVIEW_BYTES],
]) {
  test(`${method} assembles bytes with and without Content-Length`, async () => {
    for (const length of [null, "3"]) {
      const h = await harness({ mime, length, chunks: [new Uint8Array([1, 2]), new Uint8Array([3])] });
      const result = await h.files[method]("/test");
      assert.deepEqual(result.bytes, new Uint8Array([1, 2, 3]));
      assert.equal(result.mime, mime);
      assert.equal(result.size, 3);
      assert.equal(h.state().released, true);
    }
  });

  test(`${method} rejects oversized advertised bodies before reading`, async () => {
    const h = await harness({ mime, length: String(limit + 1) });
    await assert.rejects(h.files[method]("/test"), { status: 413 });
    assert.equal(h.state().reads, 0);
    assert.equal(h.state().cancelled, true);
  });

  test(`${method} stops unknown-length streams at the boundary`, async () => {
    const h = await harness({ mime, chunks: [new Uint8Array(limit), new Uint8Array(1), new Uint8Array(1)] });
    await assert.rejects(h.files[method]("/test"), { status: 413 });
    assert.equal(h.state().reads, 2);
    assert.equal(h.state().cancelled, true);
    assert.equal(h.state().released, true);
  });

  test(`${method} rejects unsupported MIME and invalid paths before body access`, async () => {
    const h = await harness({ mime: "text/html" });
    await assert.rejects(h.files[method]("/test"), /MIME type is unsupported/);
    assert.equal(h.state().reads, 0);
    assert.equal(h.state().cancelled, true);
    await assert.rejects(h.files[method]("/../escape"), /invalid segment/);
    assert.equal(h.state().calls, 2);
  });

  test(`${method} rejects truncated, malformed and failed responses`, async () => {
    for (const length of ["2", "NaN", "-1", "9007199254740992"]) {
      const h = await harness({ mime, length, chunks: [new Uint8Array([1])] });
      await assert.rejects(h.files[method]("/test"), /Content-Length/);
      assert.equal(h.state().cancelled, true);
    }
    const error = new Error("connection interrupted");
    const h = await harness({ mime, failure: error });
    await assert.rejects(h.files[method]("/test"), error);
    assert.equal(h.state().released, true);
    const denied = await harness({ mime, status: 403 });
    await assert.rejects(denied.files[method]("/test"), { status: 403 });
    assert.equal(denied.state().reads, 0);
  });
}
