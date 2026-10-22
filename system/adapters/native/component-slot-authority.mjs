import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";
import { assertComponentSlotSource } from "../../contracts/component-slot-source.mjs";

const COMPONENT_SLOT_METADATA_PATH = "/__ordax/native/component-runtime";
const REQUEST_OPTIONS = Object.freeze({
  method: "GET",
  cache: "no-store",
  credentials: "same-origin",
  redirect: "error",
});
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;

export class NativeComponentSlotAuthorityRevokedError extends Error {
  constructor(message = "Native component slot authority is no longer current", options = {}) {
    super(message, options);
    this.name = "NativeComponentSlotAuthorityRevokedError";
    this.code = "native-component-slot-authority-revoked";
  }
}

function assertMetadataUrl(value, componentId, state) {
  let url;
  try { url = new URL(value); } catch (error) {
    throw new NativeComponentSlotAuthorityRevokedError("Native component metadata URL is invalid", { cause: error });
  }
  const keys = [...url.searchParams.keys()].sort();
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || url.username || url.password || url.pathname !== COMPONENT_SLOT_METADATA_PATH
    || url.hash || keys.join(",") !== "component,state"
    || url.searchParams.get("component") !== componentId
    || url.searchParams.get("state") !== state) {
    throw new NativeComponentSlotAuthorityRevokedError("Native component metadata escaped its exact slot endpoint");
  }
  return url.href;
}

function sameSlot(left, right, state) {
  return left.componentId === right.componentId
    && left.state === state && right.state === state
    && left.source === "slot" && right.source === "slot"
    && left.revision === right.revision
    && left.version === right.version
    && left.sourceCommit === right.sourceCommit
    && left.entrypoint === right.entrypoint
    && left.pendingHealth === right.pendingHealth;
}

/**
 * Revalidate immutable Native slot identity before a privileged current-slot
 * operation or an isolated pending-slot probation attempt. Discovery metadata
 * is only a precondition; it never keeps slot authority alive by itself.
 */
export function createNativeComponentSlotAuthority({
  source,
  fetchImpl,
  timeoutMs = 5_000,
  AbortControllerCtor = globalThis.AbortController,
} = {}) {
  const slotSource = assertComponentSlotSource(source);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Native component slot authority requires fetchImpl");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError("Native component slot authority timeout must be 100..30000 ms");
  }
  if (typeof AbortControllerCtor !== "function") {
    throw new TypeError("Native component slot authority requires AbortController");
  }

  const assertState = async (expectedValue, state) => {
    const expected = validateComponentRuntimeMetadata(expectedValue, { state });
    if (expected.source !== "slot" || (state === "pending" && expected.pendingHealth !== "unknown")) {
      throw new NativeComponentSlotAuthorityRevokedError(
        state === "pending"
          ? "Native component no longer has the exact unknown-health pending slot"
          : "Native component no longer has a signed current slot",
      );
    }
    const url = assertMetadataUrl(
      slotSource.metadataUrl(expected.componentId, state),
      expected.componentId,
      state,
    );
    const controller = new AbortControllerCtor();
    let timer;
    const readExactSlot = async () => {
      const response = await fetchImpl(url, { ...REQUEST_OPTIONS, signal: controller.signal });
      if (!response || response.ok !== true || typeof response.json !== "function") {
        throw new Error("Native component slot metadata is unavailable");
      }
      const actual = validateComponentRuntimeMetadata(await response.json(), {
        componentId: expected.componentId,
        state,
      });
      if (!sameSlot(expected, actual, state)) {
        throw new Error("Native component slot identity or revision changed");
      }
      return true;
    };
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { controller.abort(); } catch { /* timeout still denies authority */ }
        reject(new NativeComponentSlotAuthorityRevokedError(
          "Native component slot verification timed out",
        ));
      }, timeoutMs);
    });
    try {
      return await Promise.race([readExactSlot(), timeout]);
    } catch (error) {
      if (error instanceof NativeComponentSlotAuthorityRevokedError) throw error;
      const detail = error instanceof Error ? error.message : "metadata validation failed";
      throw new NativeComponentSlotAuthorityRevokedError(
        `Native component slot authority is no longer current: ${detail}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({
    assertCurrent(expected) { return assertState(expected, "current"); },
    assertPending(expected) { return assertState(expected, "pending"); },
  });
}
