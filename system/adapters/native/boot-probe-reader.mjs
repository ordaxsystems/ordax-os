/**
 * Reuse the first validated Native Host observation for one early UI read.
 *
 * The factory calls the returned reader once to prove the endpoint exists
 * before publishing its capability. A shortly-following Surface read gets
 * exactly that observation, without issuing a duplicate GET. This is not a
 * long-lived cache: only the initial sample is eligible, for a bounded time,
 * and all subsequent reads contact the Native Host normally.
 */
export function createNativeBootProbeReader(readEndpoint, {
  maxAgeMs = 3000,
  now = Date.now,
} = {}) {
  if (typeof readEndpoint !== "function" || typeof now !== "function") {
    throw new TypeError("Native boot probe requires a reader and clock");
  }
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > 10000) {
    throw new TypeError("Native boot probe freshness must be bounded");
  }

  let firstReadCompleted = false;
  let firstSample = null;

  return async (options = {}) => {
    if (firstSample !== null) {
      const sample = firstSample;
      firstSample = null;
      const elapsed = now() - sample.at;
      // Abort-capable consumers must retain their own request semantics.
      if (options?.signal == null && elapsed >= 0 && elapsed <= maxAgeMs) {
        return sample.value;
      }
    }

    const value = await readEndpoint(options);
    if (!firstReadCompleted) {
      firstReadCompleted = true;
      firstSample = { value, at: now() };
    }
    return value;
  };
}
