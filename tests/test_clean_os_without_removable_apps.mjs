import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { getFirstPartyApp, listFirstPartyApps } from "../system/apps/catalog.mjs";
import { getSystemComponent } from "../system/apps/component-catalog.mjs";
import { createNativeVerifiedInstalledAppCatalog } from "../system/composition/native/verified-installed-apps.mjs";
import { listSurfaceShortcutAppIds } from "../system/services/surface/shortcut-catalog.mjs";
test("clean OrdaX OS boots its system interface catalog with no optional apps", () => {
  assert.deepEqual(listFirstPartyApps().map(x=>x.id), ["settings","account","store","system"]);
  assert.deepEqual(createNativeVerifiedInstalledAppCatalog([]).installed, []);
  for (const id of ["files","studio"]) {
    assert.equal(getFirstPartyApp(id), null);
    assert.equal(getSystemComponent(id), null);
    assert.equal(existsSync(new URL("../system/apps/"+id+"/",import.meta.url)),false);
    for(const placement of ["central","desktop","dock","navigation-menu"]) assert.equal(listSurfaceShortcutAppIds(placement).includes(id),false);
  }
  for (const name of ["file-space-controls.mjs","files-component-runtime.mjs","files.css"]) assert.equal(existsSync(new URL("../system/surface/ui/"+name,import.meta.url)),false);
});
