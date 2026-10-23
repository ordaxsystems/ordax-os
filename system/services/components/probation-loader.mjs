import { validateComponentId } from "../../contracts/component-manifest.mjs";
import {
  assertComponentSlotSource,
  validateComponentSlotResolution,
} from "../../contracts/component-slot-source.mjs";
import { validateComponentRuntime } from "../../contracts/component-runtime.mjs";

export const COMPONENT_PROBATION_RESULT_SCHEMA = "ordax.component-probation-result/1";

const HEALTH_RESULTS = new Set(["healthy", "failed"]);

function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) {
    throw new TypeError("Component probation timeout must be an integer between 100 and 30000 ms");
  }
  return value;
}

async function withTimeout(factory, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(factory),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Component probation ${label} timed out`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function readPendingResolution({
  componentId,
  source,
  fetchImpl,
  timeoutMs,
}) {
  const metadataUrl = source.metadataUrl(componentId, "pending");
  const response = await withTimeout(
    () => fetchImpl(metadataUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    }),
    timeoutMs,
    "metadata fetch",
  );
  if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
    throw new TypeError("Component probation metadata response is invalid");
  }
  if (!response.ok) {
    throw new Error(`Component probation metadata unavailable: HTTP ${response.status}`);
  }
  if (typeof response.json !== "function") {
    throw new TypeError("Component probation metadata response must implement json()");
  }
  const resolution = validateComponentSlotResolution(
    await withTimeout(() => response.json(), timeoutMs, "metadata decode"),
  );
  if (resolution.componentId !== componentId || resolution.state !== "pending") {
    throw new TypeError("Component probation metadata identity mismatch");
  }
  if (resolution.pendingHealth !== "unknown") {
    throw new TypeError("Component probation requires an unknown-health pending slot");
  }
  return resolution;
}

export async function runPendingComponentProbation({
  componentId,
  source,
  fetchImpl,
  importModule,
  healthCheck,
  timeoutMs = 5_000,
} = {}) {
  const id = validateComponentId(componentId);
  const slotSource = assertComponentSlotSource(source);
  const timeout = validateTimeout(timeoutMs);

  if (typeof fetchImpl !== "function") {
    throw new TypeError("Component probation requires fetchImpl()");
  }
  if (typeof importModule !== "function") {
    throw new TypeError("Component probation requires importModule()");
  }
  if (typeof healthCheck !== "function") {
    throw new TypeError("Component probation requires healthCheck()");
  }

  let resolution = null;
  try {
    resolution = await readPendingResolution({
      componentId: id,
      source: slotSource,
      fetchImpl,
      timeoutMs: timeout,
    });
    const runtimeUrl = slotSource.runtimeUrl(resolution);
    const module = await withTimeout(
      () => importModule(runtimeUrl, resolution),
      timeout,
      "module import",
    );
    const runtime = validateComponentRuntime(module?.componentRuntime, {
      componentId: id,
      version: resolution.version,
    });
    const health = await withTimeout(
      () => healthCheck(Object.freeze({
        runtime,
        resolution,
        runtimeUrl,
      })),
      timeout,
      "health check",
    );
    if (!HEALTH_RESULTS.has(health)) {
      throw new TypeError("Component probation health check must return healthy or failed");
    }

    return Object.freeze({
      schema: COMPONENT_PROBATION_RESULT_SCHEMA,
      componentId: id,
      version: resolution.version,
      sourceCommit: resolution.sourceCommit,
      revision: resolution.revision,
      health,
    });
  } catch (error) {
    return Object.freeze({
      schema: COMPONENT_PROBATION_RESULT_SCHEMA,
      componentId: id,
      version: resolution?.version ?? null,
      sourceCommit: resolution?.sourceCommit ?? null,
      revision: resolution?.revision ?? null,
      health: "failed",
      error: error instanceof Error ? error.message : "Component probation failed",
    });
  }
}
