import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
test("Windows recovery stays an OS capability adapter after independent Surface cutover",()=>{
 const root=new URL("../",import.meta.url);
 const lock=JSON.parse(readFileSync(new URL("docs/contracts/surface-source.json",root),"utf8"));
 const native=readFileSync(new URL("system/composition/native/main.mjs",root),"utf8");
 const host=readFileSync(new URL("tools/windows-emulator/native-host.mjs",root),"utf8");
 const adapter=readFileSync(new URL("system/adapters/desktop/recovery-port.mjs",root),"utf8");
 assert.equal(lock.source_repository,"ordaxsystems/ordax-surface");
 assert.equal(lock.status,"canonical");
 // CI deliberately overlays pinned visual files. They must remain untracked
 // by the OS source checkout, independently of their temporary presence.
 const tracked = execFileSync("git", ["ls-files", "--", "system/surface/ui/system-overview-controls.mjs"], {
   cwd:fileURLToPath(root),encoding:"utf8"
 }).trim();
 assert.equal(tracked,"");
 assert.ok(native.includes("createNativeRecoveryStatus"));
 assert.ok(adapter.includes("DESKTOP_RECOVERY_SCHEMA"));
 assert.ok(adapter.includes("validateDesktopRecoverySnapshot"));
 assert.ok(host.includes('"/__ordax/desktop/recovery"'));
 assert.ok(!adapter.includes("child_process"));
});

