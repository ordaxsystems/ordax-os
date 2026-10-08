import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedBody } from "../infra/supabase/functions/_shared/bounded_body.mjs";

function streamOf(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("empty body is accepted without an allocation", async () => {
  const result = await readBoundedBody(null, null, 64);
  assert.deepEqual(Array.from(result), []);
});

test("exact boundary is accepted across multiple chunks", async () => {
  const result = await readBoundedBody(
    streamOf(new Uint8Array([1, 2]), new Uint8Array([3, 4])),
    "4", 4,
  );
  assert.deepEqual(Array.from(result), [1, 2, 3, 4]);
});

test("stream without content-length still enforces byte limit", async () => {
  await assert.rejects(
    readBoundedBody(streamOf(new Uint8Array([1, 2, 3]), new Uint8Array([4])), null, 3),
    { name: "RangeError", message: "body-too-large" },
  );
});

test("declared oversize is rejected before touching stream", async () => {
  let pulled = false;
  const stream = new ReadableStream({
    pull() { pulled = true; },
  });
  await assert.rejects(readBoundedBody(stream, "65", 64), RangeError);
  assert.equal(pulled, false);
  await stream.cancel();
});

test("lying small content-length cannot bypass stream bound; source is cancelled", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40));
      controller.enqueue(new Uint8Array(30));
    },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readBoundedBody(stream, "10", 64), RangeError);
  assert.equal(cancelled, true);
});

test("reject malformed declared lengths and invalid limits", async () => {
  for (const invalid of ["-1", "1e3", "1, 2", "", "184467440737095516161"]) {
    await assert.rejects(readBoundedBody(null, invalid, 64), { name: /TypeError|RangeError/ });
  }
  await assert.rejects(readBoundedBody(null, null, -1), TypeError);
});

test("reject stream chunks that are not bytes", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue("untrusted-string"); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readBoundedBody(stream, null, 64), TypeError);
  assert.equal(cancelled, true);
});

test("stream errors are preserved without serving partial response bytes", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.error(new Error("upstream interrupted"));
    },
  });
  await assert.rejects(readBoundedBody(stream, null, 64), /upstream interrupted/);
});

test("mutable producer buffers cannot corrupt previously read chunks", async () => {
  const reused = new Uint8Array([1, 2]);
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index === 0) {
        controller.enqueue(reused);
      } else if (index === 1) {
        reused.set([3, 4]);
        controller.enqueue(reused);
      } else {
        controller.close();
      }
      index += 1;
    },
  }, { highWaterMark: 0 });
  const value = await readBoundedBody(stream, null, 4);
  assert.deepEqual(Array.from(value), [1, 2, 3, 4]);
});
