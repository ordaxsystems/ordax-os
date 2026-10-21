import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDesktopRecoveryStatus } from "../system/adapters/desktop/recovery-port.mjs";
import { DESKTOP_RECOVERY_SCHEMA, projectDesktopRecovery } from "../system/contracts/desktop-recovery.mjs";

test("Windows recovery transport requires actual Desktop preload bridge",async()=>{
 await assert.rejects(()=>createDesktopRecoveryStatus({fetch:async()=>({ok:true,json:async()=>projectDesktopRecovery(null)})}),/bridge/);
});
test("Windows recovery transport consumes typed read-only same-origin response",async()=>{
 const requests=[];
 const port=await createDesktopRecoveryStatus({
   ordaxDesktopBrowser:{postMessage(){}},
   async fetch(url,options){requests.push({url,options});return {ok:true,json:async()=>projectDesktopRecovery(null)};},
 });
 assert.equal(port.schema,DESKTOP_RECOVERY_SCHEMA);
 assert.equal((await port.read()).platform,"windows");
 assert.deepEqual(requests.map(x=>x.url),["/__ordax/desktop/recovery","/__ordax/desktop/recovery"]);
 assert.ok(requests.every(x=>x.options.method==="GET"&&x.options.credentials==="same-origin"));
});
test("canonical System uses Windows facts without mutating Portable v2 contract",()=>{
 const root=new URL("../",import.meta.url);
 const surface=readFileSync(new URL("system/surface/ui/system-overview-controls.mjs",root),"utf8");
 const native=readFileSync(new URL("system/composition/native/main.mjs",root),"utf8");
 const host=readFileSync(new URL("tools/windows-emulator/native-host.mjs",root),"utf8");
 assert.ok(surface.includes('desktopRecoveryStatus = null'));
 assert.ok(surface.includes('validateDesktopRecoverySnapshot'));
 assert.ok(surface.includes('system.recovery.desktop.policy'));
 assert.ok(native.includes("createDesktopRecoveryStatus(window)"));
 assert.ok(host.includes('"/__ordax/desktop/recovery"'));
 assert.ok(surface.includes('assertRecoveryStatusPort(recoveryStatus)'));
});
