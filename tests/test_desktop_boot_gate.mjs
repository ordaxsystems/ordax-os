import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Native shared Surface acknowledges health before optional apps, Store or Intelligence",()=>{
 const source=readFileSync(new URL("../system/composition/native/main.mjs", import.meta.url),"utf8");
 const mounted=source.indexOf("bootScreen.ready()");
 const recorded=source.indexOf('componentManager.setCurrentHealth("surface-shell", "healthy")');
 const health=source.indexOf("void updateWatcher.markHealthy()");
 const optional=source.indexOf("storeCatalogComposition = await storeCatalogCompositionPromise");
 const installed=source.indexOf("mountNativeVerifiedInstalledApps({", optional);
 assert.ok(mounted>=0 && recorded>mounted && health>recorded);
 assert.ok(optional>health && installed>optional);
 // A visual boot label or separate Windows lifecycle must never gate OS health.
 assert.equal(source.split("bootScreen.ready()").length-1,1);
});
