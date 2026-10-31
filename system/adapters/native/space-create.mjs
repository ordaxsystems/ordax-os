import {
  SPACE_CREATE_PORT_SCHEMA,
  validateSpaceCreateCommand,
  validateSpaceCreateReceipt,
} from "../../contracts/space-creation.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";

const CREATE_PATH = "/account/spaces/create";
const MAX_RECEIPT_CHARS = 8192;

// A browser adapter for the authenticated Native/Desktop Account host.
// The server-side RPC is the only source of authorization and persistence.
export function createNativeSpaceCreatePort(windowRef, identitySession) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Space creation requires same-origin fetch");
  }
  const identity = assertIdentitySessionPort(identitySession);
  let current = validateIdentitySessionSnapshot(identity.getSnapshot());
  let sessionRevision = 0;
  let disposed = false;
  const unsubscribe = identity.subscribe((next) => {
    const snapshot = validateIdentitySessionSnapshot(next);
    if (snapshot.state !== current.state || snapshot.subjectId !== current.subjectId) {
      sessionRevision += 1;
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
      const response = await windowRef.fetch(CREATE_PATH, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(intent),
      });

      // A response from an account that signed out, changed identity or was
      // disposed mid-flight is never visible to the new Surface session.
      requireSession(subjectId, revision);
      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`Space creation denied by Account gateway: ${response.status}`);
      }
      const raw = await response.text();
      requireSession(subjectId, revision);
      if (raw.length === 0 || raw.length > MAX_RECEIPT_CHARS) {
        throw new Error("Space creation response exceeded safe bounds");
      }
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
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sessionRevision += 1;
      if (typeof unsubscribe === "function") unsubscribe();
    },
  });
}
