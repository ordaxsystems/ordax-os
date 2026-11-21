// Presentation-only deadline for independent Home network and storage reads.
// The OS owns both ports. A stalled provider may continue its own operation,
// but must not block the UI status or subsequent user-visible retries.
export const HOME_STATUS_READ_TIMEOUT_MS = 5_000;

export async function readHomeStatusWithDeadline(port, validate, timeoutMs = HOME_STATUS_READ_TIMEOUT_MS) {
  if (typeof port?.read !== "function" || typeof validate !== "function") {
    throw new TypeError("Home status requires a readable port and snapshot validator");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Home status read deadline must be a positive integer");
  }

  let timer;
  let settled = false;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Home status read deadline exceeded")), timeoutMs);
  });
  const reading = Promise.resolve()
    .then(() => port.read())
    .then((value) => settled ? undefined : validate(value));
  try {
    return await Promise.race([reading, expired]);
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}
