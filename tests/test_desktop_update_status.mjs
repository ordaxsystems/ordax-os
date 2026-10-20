import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readDesktopDevUpdateState, projectDesktopUpdateState,
  readDesktopUpdateStatus, readDesktopUpdateHistory,
} from "../system/adapters/desktop/update-observation.mjs";
import { validateUpdateStatusSnapshot } from "../system/contracts/update-status.mjs";
import { validateUpdateHistorySnapshot } from "../system/contracts/update-history.mjs";
const a = "a".repeat(40), b = "b".repeat(40);

test("no update journal is not an invented successful delivery", async t => {
  const root = mkdtempSync(join(tmpdir(), "ordax-desktop-status-"));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  assert.equal(await readDesktopDevUpdateState(root), null);
  const status = await readDesktopUpdateStatus(root);
  assert.deepEqual(status, validateUpdateStatusSnapshot(status));
  assert.equal(status.status,"unavailable");
  assert.equal(status.phase,"blocked");
  assert.equal(status.deliveryNumber,0);
  assert.equal(status.bootRefreshRequired,false);
  assert.ok(status.lastError.length > 0);
});

test("staged source, active source and pinned rollback produce real canonical phases", () => {
  const state = {schema:"ordax.desktop-dev-update-state/1", activeSha:a,
    previousSha:null,pendingSha:b,attemptedSha:null,pinnedSha:null,rejectedSha:null};
  const staged = projectDesktopUpdateState(state);
  assert.equal(staged.sourceSha,a);
  assert.equal(staged.targetSha,b);
  assert.equal(staged.status,"updating");
  assert.equal(staged.phase,"validating");
  assert.equal(staged.deliveryNumber,0);
  assert.equal(staged.applyMode,"surface-restart");
  assert.equal(projectDesktopUpdateState({...state,attemptedSha:b}).phase,"health-wait");
  assert.equal(projectDesktopUpdateState({...state,pendingSha:null}).status,"running");
  assert.equal(projectDesktopUpdateState({...state,pendingSha:null,pinnedSha:a}).status,"pinned");
  assert.equal(projectDesktopUpdateState({...state,pendingSha:null,rejectedSha:b}).status,"rejected");
});

test("corrupt update journals fail closed; never expose successful update state", async t => {
  const root = mkdtempSync(join(tmpdir(),"ordax-desktop-corrupt-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,"desktop-dev-update-state.json"),JSON.stringify({
    schema:"ordax.desktop-dev-update-state/1",activeSha:"../tampered",
    pendingSha:null,attemptedSha:null,pinnedSha:null,rejectedSha:null,previousSha:null,
  }));
  await assert.rejects(()=>readDesktopDevUpdateState(root),/untrusted/);
  const status = await readDesktopUpdateStatus(root);
  assert.equal(status.status,"unavailable");
  assert.equal(status.phase,"error");
  assert.notEqual(status.lastError,"");
});

test("update history contains only actual recorded deliveries, never fabricated records", () => {
  const value = readDesktopUpdateHistory();
  assert.deepEqual(value, validateUpdateHistorySnapshot({releases:[],applications:[]}));
  assert.equal(value.releases.length,0);
});

test("the packaged host is configured to read the same journal used by Desktop Dev",async()=>{
  const {readFileSync} = await import("node:fs");
  const host = readFileSync("tools/windows-desktop/host.cjs","utf8");
  const main = readFileSync("tools/windows-desktop/main.cjs","utf8");
  const nativeHost = readFileSync("tools/windows-emulator/native-host.mjs","utf8");
  assert.ok(host.includes("ORDAX_DESKTOP_UPDATE_USER_DATA:userData"));
  assert.ok(main.includes("userData,log"));
  assert.ok(nativeHost.includes('"/__ordax/native/update"'));
  assert.ok(nativeHost.includes('"/__ordax/native/update-history"'));
  assert.ok(nativeHost.includes("readDesktopUpdateStatus(directory)"));
});
