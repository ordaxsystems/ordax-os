const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createUuidIdempotencyKey(cryptoRef = globalThis.crypto) {
  if (!cryptoRef || typeof cryptoRef.randomUUID !== "function") {
    throw new Error("UUID idempotency generation is unavailable");
  }
  const value = cryptoRef.randomUUID();
  if (!UUID.test(value)) throw new Error("UUID idempotency generation returned an invalid value");
  return value.toLowerCase();
}
