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
import observationPolicy from "../system/adapters/desktop/observation-grant.cjs";
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

test("verified installed bundle reports running OS without fabricating a Git activation", async t => {
  const root=mkdtempSync(join(tmpdir(),"ordax-desktop-bundled-running-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const journal={schema:"ordax.desktop-dev-update-state/1",activeSha:null,
    previousSha:null,pendingSha:null,attemptedSha:null,pinnedSha:null,
    rejectedSha:null,incompatibleSha:null};
  writeFileSync(join(root,"desktop-dev-update-state.json"),JSON.stringify(journal));
  const running=await readDesktopUpdateStatus(root,{renderedSourceSha:a});
  assert.equal(running.sourceSha,a);
  assert.equal(running.runtimeSurfaceSha,a);
  assert.equal(running.status,"running");
  assert.equal(running.phase,"idle");
  assert.equal(running.updateTransport,"git-main");
  assert.equal(running.lastAppliedSha,"","installer fallback is not a Git activation");
  assert.equal(running.deliveryNumber,0);
  assert.equal(running.lastError,"");
  assert.equal(running.bootRefreshRequired,false);
  const inaccessible=await readDesktopUpdateStatus(root);
  assert.equal(inaccessible.status,"unavailable","unproven bundled source cannot be marked ready");
  assert.equal(inaccessible.phase,"blocked");
});

test("an old incompatible SHA remains diagnostic until official verified discovery retires it", async t => {
  const root=mkdtempSync(join(tmpdir(),"ordax-desktop-stale-incompat-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const journal={schema:"ordax.desktop-dev-update-state/1",activeSha:null,
    previousSha:null,pendingSha:null,attemptedSha:null,pinnedSha:null,
    rejectedSha:null,incompatibleSha:b};
  writeFileSync(join(root,"desktop-dev-update-state.json"),JSON.stringify(journal));
  const status=await readDesktopUpdateStatus(root,{renderedSourceSha:a});
  assert.equal(status.sourceSha,a);
  assert.equal(status.status,"running","host can run valid bundle while next update is incompatible");
  assert.equal(status.phase,"blocked");
  assert.equal(status.targetSha,b);
  assert.match(status.lastError,/contrato Desktop/);
});

test("live runtime proof mismatching active Git journal fails closed without false success", async t => {
  const root=mkdtempSync(join(tmpdir(),"ordax-desktop-mismatch-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const journal={schema:"ordax.desktop-dev-update-state/1",activeSha:b,
    previousSha:null,pendingSha:null,attemptedSha:null,pinnedSha:null,
    rejectedSha:null,incompatibleSha:null};
  writeFileSync(join(root,"desktop-dev-update-state.json"),JSON.stringify(journal));
  const mismatch=await readDesktopUpdateStatus(root,{renderedSourceSha:a});
  assert.equal(mismatch.sourceSha,a,"show running source, not unbootable journal source");
  assert.equal(mismatch.lastAppliedSha,b,"preserve accurate Git journal history");
  assert.equal(mismatch.status,"unavailable");
  assert.equal(mismatch.phase,"error");
  assert.match(mismatch.lastError,/journal difere/);
  const tampered=await readDesktopUpdateStatus(root,{renderedSourceSha:"../bad"});
  assert.equal(tampered.status,"unavailable");
  assert.equal(tampered.phase,"error");
});

test("staged source, active source and pinned rollback produce real canonical phases", () => {
  const state = {schema:"ordax.desktop-dev-update-state/1", activeSha:a,
    previousSha:null,pendingSha:b,attemptedSha:null,pinnedSha:null,rejectedSha:null};
  const staged = projectDesktopUpdateState(state);
  assert.equal(staged.sourceSha,a);
  assert.equal(staged.targetSha,b);
  assert.equal(staged.status,"updating");
  assert.equal(staged.phase,"activating","verified staged source waits only for safe health-gated relaunch");
  assert.equal(staged.deliveryNumber,0);
  assert.equal(staged.applyMode,"surface-restart");
  assert.equal(projectDesktopUpdateState({...state,attemptedSha:b}).phase,"health-wait");
  assert.equal(projectDesktopUpdateState({...state,pendingSha:null}).status,"running");
  assert.equal(projectDesktopUpdateState({...state,pendingSha:null,pinnedSha:a}).status,"pinned");
  assert.equal(projectDesktopUpdateState({...state,pendingSha:null,rejectedSha:b}).status,"rejected");
});

test("incompatible official revision is visible without fabricating a release or hiding known-good", async t => {
  const root=mkdtempSync(join(tmpdir(),"ordax-desktop-incompatible-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const state={schema:"ordax.desktop-dev-update-state/1",activeSha:a,
    previousSha:null,pendingSha:null,attemptedSha:null,pinnedSha:null,
    rejectedSha:null,incompatibleSha:b};
  writeFileSync(join(root,"desktop-dev-update-state.json"),JSON.stringify(state));
  const snap=await readDesktopUpdateStatus(root);
  assert.equal(snap.sourceSha,a);
  assert.equal(snap.targetSha,b);
  assert.equal(snap.status,"running");
  assert.equal(snap.phase,"blocked");
  assert.equal(snap.updateTransport,"git-main");
  assert.equal(snap.deliveryNumber,0);
  assert.match(snap.lastError,/contrato Desktop/);
  writeFileSync(join(root,"desktop-dev-update-state.json"),
    JSON.stringify({...state,incompatibleSha:"../../bad"}));
  const rejected=await readDesktopUpdateStatus(root);
  assert.equal(rejected.status,"unavailable");
  assert.equal(rejected.phase,"error");
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
  const host = readFileSync(new URL("../tools/windows-desktop/host.cjs", import.meta.url),"utf8");
  const main = readFileSync(new URL("../tools/windows-desktop/main.cjs", import.meta.url),"utf8");
  const nativeHost = readFileSync(new URL("../tools/windows-emulator/native-host.mjs", import.meta.url),"utf8");
  assert.ok(host.includes("ORDAX_DESKTOP_UPDATE_USER_DATA:userData"));
  assert.ok(main.includes("userData,log"));
  // The Native HTTP paths now have a single authorization owner.
  // Keep proving their actual providers use this same Desktop journal.
  assert.ok(observationPolicy.OBSERVATION_ROUTES.includes("/__ordax/native/update"));
  assert.ok(observationPolicy.OBSERVATION_ROUTES.includes("/__ordax/native/update-history"));
  assert.ok(nativeHost.includes("OBSERVATION_ROUTES.includes(path)"));
  assert.ok(nativeHost.includes("createDesktopObservationGrantMiddleware"));
  assert.ok(nativeHost.includes("readDesktopUpdateStatus(directory,{renderedSourceSha})"));
  assert.ok(nativeHost.includes("process.env.ORDAX_DESKTOP_RENDERED_SOURCE_SHA"));
});
