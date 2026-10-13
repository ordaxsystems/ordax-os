import { validateComponentId } from "../../contracts/component-manifest.mjs";
import { validateComponentRuntime } from "../../contracts/component-runtime.mjs";
import { validateComponentSlotResolution } from "../../contracts/component-slot-source.mjs";
import {
  assertComponentMountParent,
  createComponentMountContext,
  mountComponentRuntimeBounded,
} from "./runtime-mount.mjs";

export const COMPONENT_MOUNT_HEALTH_PROBE_MODE = "mount-contract";

function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) {
    throw new TypeError("Component mount-health timeout must be 100..30000 ms");
  }
  return value;
}

function assertPendingRuntimeUrl(runtimeUrl, pending) {
  if (typeof runtimeUrl !== "string") {
    throw new TypeError("Component mount-health runtime URL must be text");
  }
  let url;
  try {
    url = new URL(runtimeUrl);
  } catch {
    throw new TypeError("Component mount-health runtime URL must be absolute");
  }
  const expectedPath =
    `/__ordax/native/component-module/${pending.componentId}/pending/`
    + `${pending.version}/${pending.sourceCommit}/${pending.entrypoint}`;
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== expectedPath
  ) {
    throw new TypeError("Component mount-health runtime URL is not exact pending-slot identity");
  }
}

/**
 * Build a transient health check for UI components that cannot be proven healthy
 * by import identity alone. The caller supplies only already host-owned context.
 * This helper never records health, promotes, rejects, rolls back or installs.
 * Successful mounts are destroyed immediately and their dedicated root is removed.
 */
export function createRuntimeMountHealthCheck({
  componentId,
  context = Object.freeze({}),
  timeoutMs = 5_000,
} = {}) {
  const id = validateComponentId(componentId);
  const limit = validateTimeout(timeoutMs);
  assertComponentMountParent(context, { label: "Component mount-health" });

  return async function runtimeMountHealthCheck({ runtime, resolution, runtimeUrl } = {}) {
    const pending = validateComponentSlotResolution(resolution);
    if (
      pending.componentId !== id
      || pending.state !== "pending"
      || pending.pendingHealth !== "unknown"
    ) {
      throw new TypeError("Component mount-health requires the exact unknown-health pending slot");
    }
    const verifiedRuntime = validateComponentRuntime(runtime, {
      componentId: id,
      version: pending.version,
    });
    assertPendingRuntimeUrl(runtimeUrl, pending);

    const mountContext = createComponentMountContext(context, id, {
      label: "Component mount-health",
    });
    let mounted = null;
    try {
      mounted = await mountComponentRuntimeBounded(
        verifiedRuntime,
        mountContext.context,
        limit,
        id,
        { label: "Component mount-health" },
      );
      return "healthy";
    } finally {
      try { mounted?.destroy(); } finally { mountContext.releaseRoot?.(); }
    }
  };
}
