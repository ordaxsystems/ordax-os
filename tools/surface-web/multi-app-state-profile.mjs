#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { listFirstPartyApps } from "../../system/apps/catalog.mjs";
import {
  createSurfaceState,
  createWorkspaceSnapshot,
  getActiveArea,
  reduceSurfaceState,
} from "../../system/surface/ui/surface-state.mjs";

export const SURFACE_MULTI_APP_PROFILE_SCHEMA = "ordax.surface-multi-app-state-profile/1";

const DEFAULT_CYCLES = 100;
const MAX_CYCLES = 10_000;

function validateCycles(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CYCLES) {
    throw new TypeError(`cycles must be an integer between 1 and ${MAX_CYCLES}`);
  }
  return value;
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}

function currentWindowForApp(state, appId) {
  return getActiveArea(state).windows.find((item) => item.appId === appId) ?? null;
}

export function collectSurfaceMultiAppStateProfile({ cycles = DEFAULT_CYCLES } = {}) {
  validateCycles(cycles);

  const apps = listFirstPartyApps();
  const capabilityIds = [...new Set(apps.flatMap((app) => app.requiredCapabilities))].sort();
  let state = createSurfaceState({ capabilityIds, connectivity: "online" });

  const firstPassStartedAt = performance.now();
  for (const app of apps) {
    state = reduceSurfaceState(state, { type: "app.launch", appId: app.id });
  }
  const firstPassMs = performance.now() - firstPassStartedAt;

  const firstArea = getActiveArea(state);
  const firstWindowCount = firstArea.windows.length;
  const firstWorkspaceBytes = Buffer.byteLength(
    JSON.stringify(createWorkspaceSnapshot(state)),
    "utf8",
  );

  const singletonApps = apps.filter((app) => app.singleton);
  const singletonWindowIds = new Map(
    singletonApps.map((app) => [app.id, currentWindowForApp(state, app.id)?.id ?? null]),
  );

  const stressStartedAt = performance.now();
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (const app of singletonApps) {
      state = reduceSurfaceState(state, { type: "app.launch", appId: app.id });
    }
  }
  const stressMs = performance.now() - stressStartedAt;

  const finalArea = getActiveArea(state);
  const finalWorkspaceBytes = Buffer.byteLength(
    JSON.stringify(createWorkspaceSnapshot(state)),
    "utf8",
  );
  const singletonIdMismatches = singletonApps
    .filter((app) => currentWindowForApp(state, app.id)?.id !== singletonWindowIds.get(app.id))
    .map((app) => app.id);
  const duplicateSingletonApps = singletonApps
    .filter((app) => finalArea.windows.filter((item) => item.appId === app.id).length !== 1)
    .map((app) => app.id);
  const operations = singletonApps.length * cycles;
  const windowGrowth = finalArea.windows.length - firstWindowCount;

  const profile = {
    schema: SURFACE_MULTI_APP_PROFILE_SCHEMA,
    status:
      windowGrowth === 0
      && singletonIdMismatches.length === 0
      && duplicateSingletonApps.length === 0
        ? "pass"
        : "fail",
    measurementScope: "surface-state-reducer-only",
    physicalPerformanceProven: false,
    absoluteLatencyThresholdMs: null,
    appIds: apps.map((app) => app.id),
    singletonAppIds: singletonApps.map((app) => app.id),
    capabilityIds,
    cycles,
    operations,
    windows: {
      firstPass: firstWindowCount,
      afterStress: finalArea.windows.length,
      growth: windowGrowth,
      duplicateSingletonApps,
      singletonIdMismatches,
    },
    workspaceSnapshotBytes: {
      firstPass: firstWorkspaceBytes,
      afterStress: finalWorkspaceBytes,
      growth: finalWorkspaceBytes - firstWorkspaceBytes,
    },
    timing: {
      firstPassMs: roundMilliseconds(firstPassMs),
      stressMs: roundMilliseconds(stressMs),
      operationsPerSecond:
        stressMs > 0 ? Math.round((operations * 1000) / stressMs) : null,
    },
  };

  return Object.freeze(profile);
}

function parseArgs(argv) {
  let cycles = DEFAULT_CYCLES;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--cycles") {
      throw new Error(`unsupported argument: ${argument}`);
    }
    const raw = argv[index + 1];
    if (raw === undefined) throw new Error("--cycles requires a value");
    cycles = Number(raw);
    index += 1;
  }
  return { cycles: validateCycles(cycles) };
}

function main() {
  const profile = collectSurfaceMultiAppStateProfile(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
  if (profile.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
