// One bounded stream reader for public Account requests and upstream responses.
// Checking byteLength only after arrayBuffer() is unsafe: the full body is
// allocated before any application limit can reject it.
export async function readBoundedBody(body, declaredLength, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("invalid-body-limit");
  }

  if (declaredLength !== null && declaredLength !== undefined) {
    if (typeof declaredLength !== "string" || !/^[0-9]+$/.test(declaredLength)) {
      throw new TypeError("invalid-content-length");
    }
    // Bound the header parse independently of the body limit.
    if (declaredLength.length > 20 || BigInt(declaredLength) > BigInt(maxBytes)) {
      throw new RangeError("body-too-large");
    }
  }

  if (body === null) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("invalid-body-chunk");
      }
      if (value.byteLength > maxBytes - total) {
        throw new RangeError("body-too-large");
      }
      // Keep a stable snapshot even if an unusual producer reuses its buffer.
      chunks.push(new Uint8Array(value));
      total += value.byteLength;
    }
  } catch (cause) {
    try {
      await reader.cancel("bounded-body-rejected");
    } catch {
      // Preserve the original failure; cancellation is best effort.
    }
    throw cause;
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
