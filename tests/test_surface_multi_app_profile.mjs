import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import {
  SURFACE_MULTI_APP_PROFILE_SCHEMA,
  collectSurfaceMultiAppStateProfile,
} from "../tools/surface-web/multi-app-state-profile.mjs";

test("multi-app state probe remains bounded and explicitly non-physical", () => {
  const profile = collectSurfaceMultiAppStateProfile({ cycles: 250 });
  const apps = listFirstPartyApps();

  assert.equal(profile.schema, SURFACE_MULTI_APP_PROFILE_SCHEMA);
  assert.equal(profile.status, "pass");
  assert.equal(profile.measurementScope, "surface-state-reducer-only");
  assert.equal(profile.physicalPerformanceProven, false);
  assert.equal(profile.absoluteLatencyThresholdMs, null);
  assert.deepEqual(profile.appIds, apps.map((app) => app.id));
  assert.deepEqual(
    profile.singletonAppIds,
    apps.filter((app) => app.singleton).map((app) => app.id),
  );
  assert.equal(profile.windows.growth, 0);
  assert.deepEqual(profile.windows.duplicateSingletonApps, []);
  assert.deepEqual(profile.windows.singletonIdMismatches, []);
  assert.equal(profile.windows.afterStress, profile.windows.firstPass);
  assert.equal(profile.operations, profile.singletonAppIds.length * 250);
  assert.ok(Number.isFinite(profile.timing.firstPassMs));
  assert.ok(Number.isFinite(profile.timing.stressMs));
  assert.ok(
    profile.timing.operationsPerSecond === null
      || Number.isSafeInteger(profile.timing.operationsPerSecond),
  );
});

test("multi-app state probe rejects unbounded or invalid cycle requests", () => {
  for (const cycles of [0, -1, 10_001, 1.5, Number.NaN]) {
    assert.throws(
      () => collectSurfaceMultiAppStateProfile({ cycles }),
      /cycles must be an integer between 1 and 10000/,
    );
  }
});
