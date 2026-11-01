import {
  FIRST_RUN_STATE_STORE_SCHEMA,
  assertFirstRunStateStore,
  createInitialFirstRunState,
  validateFirstRunState,
} from "../../contracts/first-run-state-store.mjs";

const FIRST_RUN_ENDPOINT = "/__ordax/native/first-run";

export async function createNativeFirstRunStateStore(
  windowRef = globalThis.window, { requireDurableRead = false } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native first-run state store requires window.fetch");
  }
  if (typeof requireDurableRead !== "boolean") {
    throw new TypeError("First-run durable bootstrap policy must be a boolean");
  }

  let memory = createInitialFirstRunState();
  try {
    const response = await windowRef.fetch(FIRST_RUN_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      if (requireDurableRead) {
        throw new Error(`Native first-run bootstrap rejected: ${response.status}`);
      }
    } else {
      memory = validateFirstRunState(await response.json());
    }
  } catch (error) {
    // Installed Desktop must never mistake an unreadable completed receipt
    // for a genuinely new user. Prevent Surface mount and healthy heartbeat
    // until Native state can be verified. The USB/emulator retain the original
    // recoverable in-memory bootstrap behavior.
    if (requireDurableRead) {
      throw new Error("Native first-run bootstrap could not be verified", { cause: error });
    }
  }

  const store = {
    schema: FIRST_RUN_STATE_STORE_SCHEMA,
    load() {
      return memory;
    },
    async save(snapshot) {
      const validated = validateFirstRunState(snapshot);
      const response = await windowRef.fetch(FIRST_RUN_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });
      if (!response.ok) {
        throw new Error(`Native first-run persistence failed: ${response.status}`);
      }
      memory = validated;
      return true;
    },
  };

  assertFirstRunStateStore(store);
  return Object.freeze(store);
}
