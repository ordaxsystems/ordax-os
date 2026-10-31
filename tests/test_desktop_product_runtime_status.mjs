import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDesktopProductRuntimeStatus } from "../system/adapters/desktop/product-runtime-status.mjs";

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),"ordax-runtime-status-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const save=(p,v)=>{const name=join(root,p);mkdirSync(join(name,".."),{recursive:true});writeFileSync(name,JSON.stringify(v));};
  const lock={
    $schema:"prototype-ordax.studio-runtime-source-lock/1",
    source:{repository:"https://github.com/ordaxsystems/ordax-runtime",commit:"a".repeat(40)},
    runtime:{native_executable_name:"ordax-product-agent"},
    distribution:{signed_runtime_slot_available:false,runtime_artifact_claimed:false,source_binding_only:true},
    activation:{dispatch_enabled:false,attestation_enabled:false},
    candidate_evidence:{platform:"linux-amd64-musl"},
  };
  const trust={$schema:"prototype-ordax.runtime-component-trust-policy/1",
    trust_domain:"runtime-components",key_id:"ordax-runtime-components-v1",
    public_anchor:{pinned:false},current_gates:{canonical_component_trust_anchor_pinned:false}};
  const write=()=>{save("system/services/device-agent/studio-runtime-source-lock.json",lock);
    save("docs/contracts/runtime-component-trust-policy.json",trust);};
  write();return {root,lock,trust,write};
}

test("missing signed distribution, Windows artifact and dispatch are separately visible",t=>{
  const {root}=fixture(t); const result=readDesktopProductRuntimeStatus(root);
  assert.equal(result.state,"blocked");
  assert.equal(result.sourcePolicyOnly,true);
  assert.equal(result.ready,false);
  assert.equal(result.runtimeStarted,false);
  assert.equal(result.capabilityDigest,null);
  assert.deepEqual(result.blockers,[
    "canonical-component-trust-unpinned","signed-runtime-distribution-unavailable",
    "runtime-dispatch-disabled","central-session-attestation-disabled",
    "windows-runtime-artifact-not-proven","supervised-runtime-health-not-proven"]);
});

test("even permissive static flags never fabricate a supervised agent",t=>{
  const {root,lock,trust,write}=fixture(t);
  lock.distribution={signed_runtime_slot_available:true,runtime_artifact_claimed:true,source_binding_only:false};
  lock.activation={dispatch_enabled:true,attestation_enabled:true};
  lock.candidate_evidence.platform="windows-amd64";
  trust.current_gates.canonical_component_trust_anchor_pinned=true;
  trust.public_anchor.pinned=true;write();
  const result=readDesktopProductRuntimeStatus(root);
  assert.deepEqual(result.blockers,["supervised-runtime-health-not-proven"]);
  assert.equal(result.ready,false);
  assert.equal(result.centralSessionAttested,false);
});

test("corrupt, missing or mismatched policies fail closed without leaking paths",t=>{
  const {root,lock,write}=fixture(t);
  lock.source.repository="https://untrusted.invalid/runtime";write();
  assert.deepEqual(readDesktopProductRuntimeStatus(root).blockers,["canonical-runtime-policy-unavailable"]);
  assert.deepEqual(readDesktopProductRuntimeStatus(join(root,"missing")).blockers,["canonical-runtime-policy-unavailable"]);
});
