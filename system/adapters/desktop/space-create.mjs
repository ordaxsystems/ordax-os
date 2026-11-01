import {
  validateSpaceCreateCommand,
  validateSpaceCreateReceipt,
} from "../../contracts/space-creation.mjs";
import { SPACE_CREATE_PORT_SCHEMA } from "../../contracts/space-create-port.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";

const CREATE_PATH = "/account/spaces/create";
const MAX_RECEIPT_BYTES = 8192;
const DEFAULT_CREATE_TIMEOUT_MS = 12_000;

// Enforce the limit during network transfer, not after Response.text() has
// already materialized an unbounded, potentially hostile gateway response.
async function readBoundedReceipt(response) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("Space creation response stream unavailable");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "";
  let totalBytes = 0;
  let complete = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) {
        complete = true;
        break;
      }
      if (!(part.value instanceof Uint8Array)) {
        throw new Error("Space creation response contained invalid bytes");
      }
      totalBytes += part.value.byteLength;
      if (totalBytes > MAX_RECEIPT_BYTES) {
        throw new Error("Space creation response exceeded safe bounds");
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
    if (!raw.length) throw new Error("Space creation response is empty");
    return raw;
  } finally {
    if (!complete) {
      try { void reader.cancel().catch(() => {}); } catch {}
    }
    reader.releaseLock();
  }
}

// A browser adapter for the authenticated Native/Desktop Account host.
// The server-side RPC is the only source of authorization and persistence.
export function createDesktopSpaceCreatePort(
  windowRef, identitySession, { timeoutMs = DEFAULT_CREATE_TIMEOUT_MS } = {},
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError("Space creation timeout must be a bounded positive integer");
  }
  // Same fail-closed Windows preload admission used by Desktop recovery.
  // Desktop adapters never import a Native adapter across the module boundary.
  if (windowRef?.location?.protocol !== "http:"
    || windowRef.location.hostname !== "127.0.0.1"
    || typeof windowRef.ordaxDesktopBrowser?.postMessage !== "function") {
    throw new TypeError("Windows Desktop browser transport required for Space creation");
  }
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Space creation requires same-origin fetch");
  }
  const identity = assertIdentitySessionPort(identitySession);
  let current = validateIdentitySessionSnapshot(identity.getSnapshot());
  let sessionRevision = 0;
  let disposed = false;
  const activeRequests = new Set();
  const abortRequests = () => {
    for (const controller of activeRequests) controller.abort();
  };
  const unsubscribe = identity.subscribe((next) => {
    const snapshot = validateIdentitySessionSnapshot(next);
    if (snapshot.state !== current.state || snapshot.subjectId !== current.subjectId) {
      sessionRevision += 1;
      // Never leave an old account's pending request in flight after logout.
      abortRequests();
    }
    current = snapshot;
  });

  const requireSession = (expectedSubject, expectedRevision) => {
    const latest = validateIdentitySessionSnapshot(identity.getSnapshot());
    if (disposed || expectedRevision !== sessionRevision
      || latest.state !== "signed-in" || latest.subjectId !== expectedSubject) {
      throw new Error("Space creation account session changed");
    }
  };

  return Object.freeze({
    schema: SPACE_CREATE_PORT_SCHEMA,
    async create(value) {
      if (disposed) throw new Error("Space creation port is disposed");
      const intent = validateSpaceCreateCommand(value);
      const start = validateIdentitySessionSnapshot(identity.getSnapshot());
      if (start.state !== "signed-in") {
        throw new Error("Space creation requires an authenticated OrdaX account");
      }
      const revision = sessionRevision;
      const subjectId = start.subjectId;
      const controller = new AbortController();
      activeRequests.add(controller);
      let rejectCancelled;
      const cancelled = new Promise((_, reject) => {
        rejectCancelled = reject;
      });
      const onAbort = () => rejectCancelled(new Error("Space creation cancelled or timed out"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      const deadline = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await Promise.race([
          windowRef.fetch(CREATE_PATH, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(intent),
          }),
          cancelled,
        ]);

        // A response from an account that signed out, changed identity or was
        // disposed mid-flight is never visible to the new Surface session.
        requireSession(subjectId, revision);
        if (response.status !== 200 && response.status !== 201) {
          throw new Error(`Space creation denied by Account gateway: ${response.status}`);
        }
        const raw = await Promise.race([readBoundedReceipt(response), cancelled]);
        requireSession(subjectId, revision);
        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          throw new Error("Space creation response was not valid JSON");
        }
        const receipt = validateSpaceCreateReceipt(payload, { subjectId, request: intent });
        if ((response.status === 201) !== receipt.created) {
          throw new Error("Space creation receipt conflicts with HTTP status");
        }
        requireSession(subjectId, revision);
        return receipt;
      } finally {
        clearTimeout(deadline);
        controller.signal.removeEventListener("abort", onAbort);
        activeRequests.delete(controller);
        // An unfinished fetch/read is already aborted on timeout, session
        // revocation or disposal; no second request, retry or privilege path.
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sessionRevision += 1;
      abortRequests();
      if (typeof unsubscribe === "function") unsubscribe();
    },
  });
}
