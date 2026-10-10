import assert from "node:assert/strict";
import test from "node:test";

import { filesApp } from "../system/apps/files/app.mjs";
import { filesComponent } from "../system/apps/files/component.mjs";
import { filesComponent as catalogFilesComponent, appComponentManifests } from "../system/services/components/manifests/apps.mjs";
import { getSystemComponent } from "../system/apps/component-catalog.mjs";
import { getFirstPartyApp } from "../system/apps/catalog.mjs";

test("Files has one component identity shared by app, catalog and bootstrap", () => {
  assert.deepEqual(filesApp.component, filesComponent);
  assert.strictEqual(catalogFilesComponent, filesComponent);
  assert.deepEqual(getSystemComponent("files"), filesComponent);
  assert.strictEqual(getFirstPartyApp("files"), filesApp);
  assert.equal(appComponentManifests.filter((component) => component.id === "files").length, 1);
  assert.equal(filesComponent.id, "files");
  assert.equal(filesComponent.version, "0.1.0");
  assert.equal(filesComponent.releaseMode, "bundled");
  assert.equal(filesComponent.owner, "system/apps/files");
  assert.equal(filesComponent.criticality, "optional");
  assert.deepEqual(filesComponent.dependencies, ["surface-shell"]);
});
