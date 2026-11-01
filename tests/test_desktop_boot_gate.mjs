import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Native shared Surface acknowledges health before optional apps, Store or Intelligence",()=>{
 const source=readFileSync(new URL("../system/composition/native/main.mjs", import.meta.url),"utf8");
 const mounted=source.indexOf("if (!firstRunPending) bootScreen.ready()");
 const recorded=source.indexOf('componentManager.setCurrentHealth("surface-shell", "healthy")');
 const health=source.indexOf("void updateWatcher.markHealthy()");
 const optional=source.indexOf("storeCatalogComposition = await storeCatalogCompositionPromise");
 const installed=source.indexOf("mountNativeVerifiedInstalledApps({", optional);
 assert.ok(mounted>=0 && recorded>mounted && health>recorded);
 assert.ok(optional>health && installed>optional);
 // Native shell health does not depend on optional Store/Intelligence or the
 // asynchronously resolved Device Profile, even when a First Run is pending.
 // The visible boot curtain must remain until that wizard is mounted.
 const wizard=source.indexOf("firstRun = mountFirstRunExperience(root, {");
 const deferred=source.indexOf("if (firstRunPending) bootScreen.ready()", wizard);
 assert.ok(wizard>health && deferred>wizard,
   "incomplete onboarding may hide the boot curtain only after its modal exists");
 assert.match(source,/if \(firstRunPending && windowsDesktopHost\) bootScreen.fail\(bootText\("surface.boot.failed"\)\)/,
   "failed Windows onboarding must not expose an unlocked desktop");
 assert.equal(source.split("bootScreen.ready()").length-1,3,
   "ready is owned only by completed boot, mounted First Run and USB recovery");
});
