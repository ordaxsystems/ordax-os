import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Native boot reveals verified Surface before optional Store and external apps",()=>{
 const source=readFileSync(new URL("../system/composition/native/main.mjs", import.meta.url),"utf8");
 const ready=source.indexOf("bootScreen.ready()");
 const nextStage=source.indexOf('bootScreen.setStage(surface.localization.translate("surface.boot.preparingFirstRun"))');
 const health=source.indexOf('void updateWatcher.markHealthy()');
 const store=source.indexOf("storeCatalogComposition = await storeCatalogCompositionPromise");
 const installedApps=source.indexOf("mountNativeVerifiedInstalledApps({");
 assert.ok(ready>=0 && nextStage>ready && health>nextStage);
 assert.ok(store>health && installedApps>store);
 assert.equal(source.split('bootScreen.setStage(surface.localization.translate("surface.boot.preparingFirstRun"))').length-1,1);
});
