import test from "node:test";
import assert from "node:assert/strict";
import { createVerifiedSlotHostContextProvider } from "../system/services/components/verified-host-context.mjs";
import { createNativePendingComponentHostBootstrap } from "../system/composition/native/component-pending-host.mjs";

const current = { componentId:"notes", state:"current", source:"slot", revision:4,
  version:"0.4.0", sourceCommit:"a".repeat(40), entrypoint:"apps/notes/runtime.mjs", pendingHealth:null };
test("generic verified slot capability provider grants only exact current identity", () => {
  let calls=0;
  const provider=createVerifiedSlotHostContextProvider({componentId:"notes",verifiedCurrent:current,
    createPorts() {calls++;return Object.freeze({limited:true});}});
  assert.equal(provider("files"),null);
  assert.equal(calls,0);
  assert.equal(provider("notes").limited,true);
  assert.equal(calls,1);
  assert.throws(()=>createVerifiedSlotHostContextProvider({componentId:"notes",verifiedCurrent:{...current,state:"pending",pendingHealth:"unknown"},createPorts:()=>({limited:true})})("notes"),/state mismatch/);
  assert.throws(()=>createVerifiedSlotHostContextProvider({componentId:"notes",createPorts:()=>({limited:true})})("notes"),/verified current/);
});
test("generic pending host rejects import-only component and invalid port factories", () => {
  assert.throws(()=>createNativePendingComponentHostBootstrap({componentId:"notes",createPorts:()=>({})}),/mount-contract/);
  assert.throws(()=>createNativePendingComponentHostBootstrap({componentId:"files",createPorts:null}),/typed host-port/);
});
