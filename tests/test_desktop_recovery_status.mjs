import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESKTOP_RECOVERY_SCHEMA, projectDesktopRecovery, validateDesktopRecoverySnapshot } from "../system/contracts/desktop-recovery.mjs";
import { readDesktopRecovery } from "../system/adapters/desktop/recovery-observation.mjs";
const shaA="a".repeat(40),shaB="b".repeat(40);
test("bundled Desktop does not impersonate USB portable-v2 recovery",()=> {
 const v=projectDesktopRecovery(null);
 assert.equal(v.schema,DESKTOP_RECOVERY_SCHEMA);
 assert.equal(v.platform,"windows");
 assert.equal(v.runningKind,"bundled");
 assert.equal(v.rollbackState,"unavailable");
 assert.equal(v.mutationAuthorized,false);
 assert.equal(Object.hasOwn(v,"bootSlot"),false);
});
test("Windows journal exposes real staged candidate and prior verified source",async t=>{
 const root=mkdtempSync(join(tmpdir(),"ordax-recovery-"));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,"desktop-dev-update-state.json"),JSON.stringify({schema:"ordax.desktop-dev-update-state/1",activeSha:shaB,previousSha:shaA,pendingSha:null,attemptedSha:null,pinnedSha:null,rejectedSha:null}));
 const s=await readDesktopRecovery(root);
 assert.deepEqual(s,validateDesktopRecoverySnapshot(s));
 assert.equal(s.activeSha,shaB);
 assert.equal(s.previousSha,shaA);
 assert.equal(s.rollbackState,"available");
});
test("corrupt journal fails closed rather than inventing recovery",async t=>{
 const root=mkdtempSync(join(tmpdir(),"ordax-recovery-corrupt-"));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,"desktop-dev-update-state.json"),"{bad");
 const s=await readDesktopRecovery(root);
 assert.equal(s.runningKind,"unavailable");
 assert.equal(s.rollbackState,"unavailable");
});
