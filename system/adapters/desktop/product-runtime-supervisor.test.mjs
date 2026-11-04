import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {createDesktopProductRuntimeSupervisor,createDesktopSignedRuntimeHandoff,stopOwnedDesktopWindowsTree} from "./product-runtime-supervisor.mjs";

const SHA="a".repeat(40);
function fixture(t,{identity=true,approved=false}={}){
 const root=mkdtempSync(join(tmpdir(),"ordax-product-supervisor-"));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const systemRoot=join(root,"os");
 const userData=join(root,"OrdaX Desktop");
 const state=join(userData,"native-state","product-runtime");
 const policyDir=join(systemRoot,"docs","contracts");
 const lockDir=join(systemRoot,"system","services","device-agent");
 const packageRoot=join(userData,"Components","product-runtime","versions","v1");
 mkdirSync(policyDir,{recursive:true});
 mkdirSync(lockDir,{recursive:true});
 mkdirSync(state,{recursive:true});
 mkdirSync(packageRoot,{recursive:true});
 const policy={
   $schema:"prototype-ordax.runtime-component-trust-policy/1",
   status:approved?"canonical-public-trust-pinned":"operator-ceremony-pending",
   trust_domain:"runtime-components",
   public_anchor:{pinned:approved},
   current_gates:{
     canonical_component_trust_anchor_pinned:approved,
     component_publish_allowed:approved,
     production_component_slot_activation_allowed:approved,
   }
 };
 const lock={
   $schema:"prototype-ordax.studio-runtime-source-lock/1",
   source:{commit:SHA},
   distribution:{signed_runtime_slot_available:approved,source_binding_only:!approved},
   activation:{requires_signed_runtime_slot:true},
   candidate_evidence_by_target:{"windows-amd64":{source_commit:SHA}},
 };
 const policyFile=join(policyDir,"runtime-component-trust-policy.json");
 const lockFile=join(lockDir,"studio-runtime-source-lock.json");
 writeFileSync(policyFile,JSON.stringify(policy));
 writeFileSync(lockFile,JSON.stringify(lock));
 if(identity){
   writeFileSync(join(state,"agent-settings.json"),JSON.stringify({
     device_id:"11111111-1111-4111-8111-111111111111",
     control_plane_protocol:"cloudflare-v3",
     product_mcp_url:"https://ordax-mcp.ordaxsystems.workers.dev",
   }));
   writeFileSync(join(state,"device-token.cloudflare-v3.txt"),"b".repeat(64));
 }
 const executable=join(packageRoot,"ordax-runtime.exe");
 writeFileSync(executable,"signed-runtime-protocol-fixture");
 const makePlan=(path=executable,commit=SHA)=>[
   "PRODUCT_RUNTIME_HANDOFF_VERIFIED=YES",
   "SOURCE_COMMIT="+commit,
   "VERSION=1.2.3","REVISION=1","EXECUTABLE="+path,
   "RUNTIME_STARTED=NO","CENTRAL_SESSION_ATTESTED=NO",
 ].join("\n")+"\n";
 const plan=makePlan();
 return {root,systemRoot,userData,state,policy,lock,policyFile,lockFile,
   executable,makePlan,plan};
}
function child(){
 const proc=new EventEmitter();
 proc.pid=4455;
 proc.exitCode=null;
 proc.signalCode=null;
 proc.kills=[];
 proc.kill=signal=>{proc.kills.push(signal);proc.signalCode=signal;return true};
 return proc;
}

function stagePinnedDesktopDevCandidate(f){
  const directory=join(f.userData,"native-state","product-runtime-dev");
  const evidenceDirectory=join(f.systemRoot,"docs","evidence");
  mkdirSync(directory,{recursive:true});
  mkdirSync(evidenceDirectory,{recursive:true});
  const executable=join(directory,"ordax-product-agent.exe");
  const payload=Buffer.alloc(640);
  payload.write("MZ",0,"ascii");
  payload.write("dev-test-only",32,"ascii");
  writeFileSync(executable,payload);
  const hash=createHash("sha256").update(payload).digest("hex");
  const evidence={
    $schema:"ordax.desktop-runtime-candidate-evidence/1",
    status:"unsigned-candidate-physically-offline-proven",
    canonical_source_lock_promoted:false,
    candidate:{
      schema:"ordax.desktop-runtime-candidate/1",
      source_repository:"ordaxsystems/ordax-runtime",source_commit:SHA,
      profile:"ordax-desktop",platform:"windows-amd64",
      artifact:"ordax-product-agent.exe",sha256:hash,size_bytes:payload.length,
      offline_proof_verified:true,signature_present:false,
      signed_distribution_authorized:false,stable_activation_authorized:false,
    },
    physical_offline_proof:{
      passed:true,source_commit:SHA,executable_sha256:hash,
      remote_action_proven:false,
    },
  };
  const path=join(evidenceDirectory,"desktop-runtime-windows-candidate-2026-10-31.json");
  writeFileSync(path,JSON.stringify(evidence));
  return {executable,path,payload,evidence};
}
test("Runtime credential rejection (exit 43) halts retries until Owner rotates token",async t=>{
  const f=fixture(t,{approved:false});
  stagePinnedDesktopDevCandidate(f);
  let launches=0;
  const children=[];
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,
    spawnImpl:()=>{launches++;const p=child();children.push(p);return p},
  });
  assert.equal((await sup.reconcile()).state,"running");
  children[0].exitCode=43;
  children[0].emit("exit",43,null);
  assert.equal(sup.status().state,"blocked");
  assert.equal(sup.status().reason,"device_credential_recovery_required");
  assert.equal(sup.status().mcpReady,false);
  // Several Supervisor ticks cannot re-use the same rejected credential.
  for(let tick=0;tick<5;tick++){
    const state=await sup.reconcile();
    assert.equal(state.reason,"device_credential_recovery_required");
    assert.equal(state.processRunning,false);
  }
  assert.equal(launches,1);
  // Only the canonical Owner identity-store credential update releases latch.
  writeFileSync(join(f.state,"device-token.cloudflare-v3.txt"),"c".repeat(64));
  const recovered=await sup.reconcile();
  assert.equal(recovered.state,"running");
  assert.equal(recovered.reason,"dev_remote_attestation_pending");
  assert.equal(recovered.mcpReady,false);
  assert.equal(launches,2);
  sup.stop();
});
test("Runtime requested restart (exit 42) retains ordinary supervised recovery",async t=>{
  const f=fixture(t,{approved:false});
  stagePinnedDesktopDevCandidate(f);
  let launches=0;
  const children=[];
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,
    spawnImpl:()=>{launches++;const p=child();children.push(p);return p},
  });
  assert.equal((await sup.reconcile()).state,"running");
  children[0].exitCode=42;children[0].emit("exit",42,null);
  assert.equal(sup.status().reason,"runtime_exited");
  assert.equal((await sup.reconcile()).state,"running");
  assert.equal(launches,2);
  sup.stop();
});
test("credential recovery never bypasses signed production trust gate",async t=>{
  const f=fixture(t,{approved:true});
  let launches=0;
  const children=[];
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    verifiedHandoff:()=>f.plan,
    spawnImpl:()=>{launches++;const p=child();children.push(p);return p},
  });
  assert.equal((await sup.reconcile()).state,"running");
  children[0].exitCode=43;children[0].emit("exit",43,null);
  assert.equal((await sup.reconcile()).reason,"device_credential_recovery_required");
  assert.equal(launches,1);
  // Token rotation must not override the separate signed-release gate.
  f.policy.current_gates.component_publish_allowed=false;
  writeFileSync(f.policyFile,JSON.stringify(f.policy));
  writeFileSync(join(f.state,"device-token.cloudflare-v3.txt"),"c".repeat(64));
  assert.equal((await sup.reconcile()).reason,"component_trust_not_authorized");
  assert.equal(launches,1);
  sup.stop();
});

test("DEV candidate requires explicit opt-in; unsigned bytes alone grant nothing",async t=>{
  const f=fixture(t,{approved:false});
  stagePinnedDesktopDevCandidate(f);
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    spawnImpl:()=>{throw Error("DEV must not start without opt-in")},
  });
  assert.equal((await sup.reconcile()).reason,"component_trust_not_authorized");
  assert.equal(sup.status().mcpReady,false);
  sup.stop();
});
test("opted-in, hash-pinned DEV candidate starts ONE canonical scoped process",async t=>{
  const f=fixture(t,{approved:false});
  const candidate=stagePinnedDesktopDevCandidate(f);
  let launches=0,actual=null,settings=null;
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,verifiedHandoff:null,
    env:{ORDAX_COMPUTER_FULL_ACCESS:"1",ORDAX_MCP_DEV:"1",
      NODE_OPTIONS:"--require unsafe",UNRELATED:"safe"},
    spawnImpl:(file,args,options)=>{
      assert.equal(file,candidate.executable);
      assert.deepEqual(args,[]);
      settings=options;
      launches++;actual=child();return actual;
    },
  });
  const [one,two]=await Promise.all([sup.reconcile(),sup.reconcile()]);
  assert.equal(one.state,"running");
  assert.equal(one.reason,"dev_remote_attestation_pending");
  assert.equal(two.reason,"dev_remote_attestation_pending");
  assert.equal(launches,1);
  assert.equal(one.mcpReady,false);
  assert.equal(one.centralSessionAttested,false);
  assert.equal(one.capabilityDigest,null);
  assert.equal(settings.env.ORDAX_RUNTIME_HOST_PROFILE,"ordax-desktop");
  assert.equal(settings.env.ORDAX_AGENT_STATE_DIR,f.state);
  assert.equal(settings.env.ORDAX_MCP_DEV,undefined);
  assert.equal(settings.env.ORDAX_COMPUTER_FULL_ACCESS,undefined);
  assert.equal(settings.env.NODE_OPTIONS,undefined);
  assert.equal(settings.env.UNRELATED,"safe");
  sup.stop();
  assert.deepEqual(actual.kills,["SIGTERM"]);
});
test("DEV candidate tampering stops owned Runtime and never grants remote readiness",async t=>{
  const f=fixture(t,{approved:false});
  const candidate=stagePinnedDesktopDevCandidate(f);
  const spawned=child();
  let launches=0;
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,spawnImpl:()=>{launches++;return spawned},
  });
  assert.equal((await sup.reconcile()).state,"running");
  candidate.payload.write("CHANGED",32,"ascii");
  writeFileSync(candidate.executable,candidate.payload);
  const status=await sup.reconcile();
  assert.equal(status.state,"stopping");
  assert.equal(status.reason,"dev_candidate_unavailable");
  assert.equal(status.mcpReady,false);
  assert.equal(launches,1);
  assert.deepEqual(spawned.kills,["SIGTERM"]);
  spawned.exitCode=0;spawned.emit("exit",0);
  sup.stop();
});
test("signed production policy never falls back to unsigned DEV candidate",async t=>{
  const f=fixture(t,{approved:true});
  stagePinnedDesktopDevCandidate(f);
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,
    spawnImpl:()=>{throw Error("Must require signed provider")},
  });
  assert.equal((await sup.reconcile()).reason,"signed_windows_runtime_unavailable");
  sup.stop();
});
test("DEV candidate source mismatch and altered trust status fail closed",async t=>{
  const f=fixture(t,{approved:false});
  const d=stagePinnedDesktopDevCandidate(f);
  d.evidence.physical_offline_proof.source_commit="b".repeat(40);
  writeFileSync(d.path,JSON.stringify(d.evidence));
  let sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,spawnImpl:()=>{throw Error("must not spawn")},
  });
  assert.equal((await sup.reconcile()).reason,"component_trust_not_authorized");
  sup.stop();
  d.evidence.physical_offline_proof.source_commit=SHA;
  writeFileSync(d.path,JSON.stringify(d.evidence));
  f.policy.status="canonical-public-trust-pinned";
  writeFileSync(f.policyFile,JSON.stringify(f.policy));
  sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,spawnImpl:()=>{throw Error("must not spawn")},
  });
  assert.equal((await sup.reconcile()).reason,"component_trust_not_authorized");
  sup.stop();
});

test("canonical Go verifier receipt reused without a second signing authority",async t=>{
 const f=fixture(t,{approved:true});
 const verifierRoot=join(f.root,"installer");
 const helper=join(verifierRoot,"tools","runtime-component-channel",
   "ordax-runtime-component-channel.exe");
 const trust=join(verifierRoot,"system","trust","runtime-components-ed25519.json");
 mkdirSync(join(verifierRoot,"tools","runtime-component-channel"),{recursive:true});
 mkdirSync(join(verifierRoot,"system","trust"),{recursive:true});
 writeFileSync(helper,"trusted-installed-Go-verifier-fixture");
 writeFileSync(trust,'{"schema":"component-trust"}');
 let calls=0;
 const handoff=createDesktopSignedRuntimeHandoff({verifierRoot,
   execFileImpl:(exe,args,opts,done)=>{
     calls++;
     assert.equal(exe,helper);
     assert.equal(args[0],"inspect-native-product-handoff");
     assert.deepEqual(args.slice(1,3),["--target","windows-amd64"]);
     assert.ok(args.includes("--source-lock"));
     assert.ok(args.includes("--trust-policy"));
     assert.ok(args.includes("--trust"));
     assert.ok(args.includes("--root"));
     assert.equal(opts.windowsHide,true);
     done(null,f.plan);
   }});
 const received=await handoff({systemRoot:f.systemRoot,userData:f.userData});
 assert.equal(received,f.plan);
 assert.equal(calls,1);
});
test("missing installed Go verifier never returns a fake signed plan",async t=>{
 const f=fixture(t,{approved:true});
 const handoff=createDesktopSignedRuntimeHandoff({
   verifierRoot:join(f.root,"missing-installation"),
   execFileImpl:()=>{throw Error("must not run")},
 });
 await assert.rejects(()=>handoff({systemRoot:f.systemRoot,userData:f.userData}),
   /Trusted Windows verifier unavailable/);
});
test("production: existing unpinned trust cannot launch OS Runtime",async t=>{
 const f=fixture(t,{approved:false});
 let calls=0;
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,
   userData:f.userData,platform:"win32",verifiedHandoff:()=>{calls++;return f.plan},
   spawnImpl:()=>{throw Error("must not spawn")}});
 const status=await sup.reconcile();
 assert.equal(status.state,"blocked");
 assert.equal(status.reason,"component_trust_not_authorized");
 assert.equal(status.enrolled,true);
 assert.equal(status.capabilityDigest,null);
 assert.equal(status.mcpReady,false);
 assert.equal(calls,0);
 sup.stop();
});
test("unenrolled identity denied BEFORE attempting signed verification",async t=>{
 const f=fixture(t,{approved:true,identity:false});
 let calls=0;
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,
   userData:f.userData,platform:"win32",verifiedHandoff:()=>{calls++;return f.plan}});
 const status=await sup.reconcile();
 assert.equal(status.reason,"device_not_enrolled");
 assert.equal(calls,0);
 sup.stop();
});
test("approved policy with no signed Windows provider remains unavailable",async t=>{
 const f=fixture(t,{approved:true});
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,platform:"win32"});
 const status=await sup.reconcile();
 assert.equal(status.reason,"signed_windows_runtime_unavailable");
 assert.equal(status.mcpReady,false);
 sup.stop();
});
test("valid signed plan launches ONE scoped process without inherited Windows privilege",async t=>{
 const f=fixture(t,{approved:true});
 let launches=0;let spawned=null;let settings=null;
 const sup=createDesktopProductRuntimeSupervisor({
   systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
   env:{ORDAX_COMPUTER_FULL_ACCESS:"1",ORDAX_COMPUTER_ENABLED:"1",
     ORDAX_OWNER_SECRET:"not-inherited",PYTHONPATH:"untrusted-path",
     ORDAX_AGENT_STATE_DIR:"C:\\Windows Agent",UNRELATED:"safe"},
   verifiedHandoff:()=>f.plan,
   spawnImpl:(_file,_args,opts)=>{launches++;settings=opts;spawned=child();return spawned},
 });
 const [a,b]=await Promise.all([sup.reconcile(),sup.reconcile()]);
 assert.equal(launches,1);
 assert.equal(a.state,"running");assert.equal(b.state,"running");
 assert.equal(a.mcpReady,false);
 assert.equal(a.capabilityDigest,null);
 assert.equal(a.reason,"remote_attestation_pending");
 assert.equal(settings.env.ORDAX_RUNTIME_HOST_PROFILE,"ordax-desktop");
 assert.equal(settings.env.ORDAX_AGENT_STATE_DIR,f.state);
 assert.equal(settings.env.ORDAX_DESKTOP_USER_DATA,f.userData);
 assert.equal(settings.env.ORDAX_PRODUCT_MCP_URL,"https://ordax-mcp.ordaxsystems.workers.dev");
 assert.equal(settings.env.ORDAX_COMPUTER_FULL_ACCESS,undefined);
 assert.equal(settings.env.ORDAX_COMPUTER_ENABLED,undefined);
 assert.equal(settings.env.ORDAX_OWNER_SECRET,undefined);
 assert.equal(settings.env.PYTHONPATH,undefined);
 assert.equal(settings.env.UNRELATED,"safe");
 assert.equal(settings.cwd,join(f.userData,"native-state"));
 sup.stop();
 assert.deepEqual(spawned.kills,["SIGTERM"]);
 assert.equal(sup.status().mcpReady,false);
});
test("revoking canonical trust stops only process created by this supervisor",async t=>{
 const f=fixture(t,{approved:true});
 const spawned=child();
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,
   platform:"win32",verifiedHandoff:()=>f.plan,spawnImpl:()=>spawned});
 assert.equal((await sup.reconcile()).state,"running");
 f.policy.current_gates.component_publish_allowed=false;
 writeFileSync(f.policyFile,JSON.stringify(f.policy));
 const status=await sup.reconcile();
 assert.equal(status.state,"stopping");
 assert.equal(status.processRunning,true);
 assert.equal(status.reason,"component_trust_not_authorized");
 assert.deepEqual(spawned.kills,["SIGTERM"]);
 assert.equal(status.capabilityDigest,null);
 spawned.exitCode=0;spawned.emit("exit",0);
 assert.equal(sup.status().state,"stopped");
 assert.equal(sup.status().processRunning,false);
});
test("source mismatch, missing signature and executable outside Components all fail",async t=>{
 const f=fixture(t,{approved:true});
 const attempts=[
  f.makePlan(f.executable,"b".repeat(40)),
  f.plan.replace("PRODUCT_RUNTIME_HANDOFF_VERIFIED=YES",
    "PRODUCT_RUNTIME_HANDOFF_VERIFIED=NO"),
  f.makePlan(join(f.userData,"outside.exe")),
  f.makePlan(join(f.state,"runtime.exe")),
  f.makePlan(join(f.userData,"Components","runtime.py")),
  f.plan+"SOURCE_COMMIT="+SHA+"\n",
  f.plan.replace("RUNTIME_STARTED=NO","RUNTIME_STARTED=YES"),
 ];
 for(const wrong of attempts){
  const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,
    platform:"win32",verifiedHandoff:()=>wrong,
    spawnImpl:()=>{throw Error("must not spawn")}});
  assert.equal((await sup.reconcile()).reason,"signed_windows_runtime_unavailable");
  sup.stop();
 }
});
test("changed device token while verifying release cannot launch",async t=>{
 const f=fixture(t,{approved:true});
 let launched=0;
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,
   platform:"win32",
   verifiedHandoff:async()=>{
     writeFileSync(join(f.state,"device-token.cloudflare-v3.txt"),"c".repeat(64));
     return f.plan;
   },
   spawnImpl:()=>{launched++;return child()},
 });
 assert.equal((await sup.reconcile()).reason,"identity_or_release_changed");
 assert.equal(launched,0);
 sup.stop();
});
test("replacement is blocked until previous owned child really exits",async t=>{
 const f=fixture(t,{approved:true});
 const secondExecutable=join(f.userData,"Components","product-runtime","versions","v2","ordax-runtime.exe");
 mkdirSync(join(f.userData,"Components","product-runtime","versions","v2"),{recursive:true});
 writeFileSync(secondExecutable,"second verified binary");
 let plan=f.plan,launches=0,first=null;
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,
   platform:"win32",verifiedHandoff:()=>plan,
   spawnImpl:()=>{
     launches++;
     const next=child();
     if(launches===1)first=next;
     return next;
   }});
 assert.equal((await sup.reconcile()).state,"running");
 plan=f.makePlan(secondExecutable);
 const pending=await sup.reconcile();
 assert.equal(pending.state,"stopping");
 assert.equal(pending.reason,"previous_instance_still_running");
 assert.deepEqual(first.kills,["SIGTERM"]);
 assert.equal(launches,1);
 first.exitCode=0;
 first.emit("exit",0);
 assert.equal((await sup.reconcile()).state,"running");
 assert.equal(launches,2);
 sup.stop();
});
test("shutdown never reports a still-running child as fully stopped",async t=>{
 const f=fixture(t,{approved:true});
 const spawned=child();
 // Child.kill requests SIGTERM but cannot prove the process has exited yet.
 spawned.kill=signal=>{spawned.kills.push(signal);return true};
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,
   platform:"win32",verifiedHandoff:()=>f.plan,spawnImpl:()=>spawned});
 assert.equal((await sup.reconcile()).state,"running");
 const stopping=sup.stop();
 assert.equal(stopping.state,"stopping");
 assert.equal(stopping.processRunning,true);
 assert.equal(stopping.mcpReady,false);
 assert.deepEqual(spawned.kills,["SIGTERM"]);
 spawned.exitCode=0;spawned.emit("exit",0);
 assert.equal(sup.status().state,"stopped");
 assert.equal(sup.status().processRunning,false);
});
test("invalid token or device ID cannot reuse Windows identity",async t=>{
 const f=fixture(t,{approved:true});
 writeFileSync(join(f.state,"device-token.cloudflare-v3.txt"),"INVALID");
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,
   platform:"win32",verifiedHandoff:()=>f.plan});
 assert.equal((await sup.reconcile()).reason,"device_not_enrolled");
 sup.stop();
});
test("symlink in identity chain rejected when OS can create it",async t=>{
 const f=fixture(t,{approved:true,identity:false});
 const elsewhere=join(f.root,"outside");
 mkdirSync(elsewhere);
 try{rmSync(f.state,{recursive:true});symlinkSync(elsewhere,f.state,"junction")}
 catch(error){t.skip("Windows symlink privilege unavailable: "+error.code);return}
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,
   platform:"win32",verifiedHandoff:()=>f.plan});
 assert.equal((await sup.reconcile()).reason,"device_not_enrolled");
 sup.stop();
});
test("host ABI boundary rejects Linux and stops cleanly",async t=>{
 const f=fixture(t,{approved:true});
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,
   platform:"linux",verifiedHandoff:()=>f.plan});
 assert.equal((await sup.reconcile()).reason,"unsupported_host");
 assert.equal(sup.stop().state,"stopped");
 assert.equal((await sup.reconcile()).reason,"supervisor_closed");
});
test("unexpected Runtime exit cannot imply an attested session",async t=>{
 const f=fixture(t,{approved:true});
 const spawned=child();
 const sup=createDesktopProductRuntimeSupervisor({systemRoot:f.systemRoot,userData:f.userData,
   platform:"win32",verifiedHandoff:()=>f.plan,spawnImpl:()=>spawned});
 assert.equal((await sup.reconcile()).state,"running");
 spawned.exitCode=17;
 spawned.emit("exit",17);
 assert.equal(sup.status().state,"stopped");
 assert.equal(sup.status().mcpReady,false);
 assert.equal(sup.status().reason,"runtime_exited");
 sup.stop();
});


test("scoped Surface bridge is injected only into the owned Product child", async t=>{
  const f=fixture(t,{approved:false});
  stagePinnedDesktopDevCandidate(f);
  let launched=null;
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,
    nativeBridge:()=>({url:"http://127.0.0.1:45678/__ordax/native/desktop-surface-state",
      token:"c".repeat(64)}),
    env:{ORDAX_DESKTOP_SURFACE_BRIDGE_TOKEN:"fake-windows-token",
      ORDAX_COMPUTER_FULL_ACCESS:"1",UNRELATED:"safe"},
    spawnImpl:(_file,_args,opts)=>{launched=opts;return child()},
  });
  assert.equal((await sup.reconcile()).state,"running");
  assert.equal(launched.env.ORDAX_DESKTOP_SURFACE_BRIDGE_TOKEN,"c".repeat(64));
  assert.equal(launched.env.ORDAX_DESKTOP_SURFACE_BRIDGE_URL,
    "http://127.0.0.1:45678/__ordax/native/desktop-surface-state");
  assert.equal(launched.env.ORDAX_COMPUTER_FULL_ACCESS,undefined);
  assert.equal(launched.env.UNRELATED,"safe");
  sup.stop();
});

test("malformed, non-loopback and absent Native bridges block Product spawn",async t=>{
  for(const bridge of [
    null,
    {url:"http://localhost:45678/__ordax/native/desktop-surface-state",token:"c".repeat(64)},
    {url:"http://127.0.0.1:45678/__ordax/native/desktop-surface-state",token:"invalid"},
    {url:"http://127.0.0.1:45678/__ordax/native/desktop-surface-state?x=1",token:"c".repeat(64)},
  ]){
    const f=fixture(t,{approved:false});
    stagePinnedDesktopDevCandidate(f);
    const sup=createDesktopProductRuntimeSupervisor({
      systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
      developmentCandidate:true,nativeBridge:()=>bridge,
      spawnImpl:()=>{throw Error("Unverified bridge must not spawn")},
    });
    assert.equal((await sup.reconcile()).reason,"native_surface_bridge_unavailable");
    sup.stop();
  }
});

test("Windows tree termination operates on exact owned PID and Win32 child process tree",()=>{
  let invoked=null;
  const valid=stopOwnedDesktopWindowsTree(27182,{
    windowsRoot:"C:\\Windows",
    execImpl:(command,args,options)=>{
      invoked={command,args,options};
      return {status:0,error:null,signal:null};
    },
  });
  assert.equal(valid,true);
  assert.equal(invoked.command,"C:\\Windows\\System32\\taskkill.exe");
  assert.deepEqual(invoked.args,["/PID","27182","/T","/F"]);
  assert.equal(invoked.options.shell,false);
  assert.equal(invoked.options.timeout,5000);
  assert.equal(invoked.options.windowsHide,true);
  assert.equal(invoked.options.stdio,"ignore");
  for(const pid of [-1,0,Number.NaN,Infinity,1.4,0x100000000]){
    assert.equal(stopOwnedDesktopWindowsTree(pid,{
      windowsRoot:"C:\\Windows",execImpl:()=>{throw Error("invalid PID invoked")},
    }),false);
  }
  assert.equal(stopOwnedDesktopWindowsTree(123,{windowsRoot:"",execImpl:()=>({status:0})}),false);
  assert.equal(stopOwnedDesktopWindowsTree(123,{windowsRoot:"C:\\Windows",execImpl:()=>({status:5})}),false);
});

test("a supervised Windows Product Runtime stops its full tree without orphaning its frozen child",async t=>{
  const f=fixture(t,{approved:false});
  stagePinnedDesktopDevCandidate(f);
  const proc=child();
  proc.pid=27182;
  let stopped=[];
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,spawnImpl:()=>proc,
    stopTreeImpl:pid=>{stopped.push(pid);return true},
  });
  assert.equal((await sup.reconcile()).state,"running");
  sup.stop();
  assert.deepEqual(stopped,[27182]);
  assert.deepEqual(proc.kills,[]);
  assert.equal(sup.status().state,"stopping");
  proc.exitCode=1;
  proc.emit("exit",1,null);
  assert.equal(sup.status().state,"stopped");
});

test("failed native Windows tree termination falls back only to owned Runtime child",async t=>{
  const f=fixture(t,{approved:false});
  stagePinnedDesktopDevCandidate(f);
  const proc=child();
  proc.pid=27183;
  let treeCalls=0;
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,spawnImpl:()=>proc,
    stopTreeImpl:()=>{treeCalls++;return false},
  });
  assert.equal((await sup.reconcile()).state,"running");
  sup.stop();
  assert.equal(treeCalls,1);
  assert.deepEqual(proc.kills,["SIGTERM"]);
});

test("rotating a Device credential retires the old Product tree before reuse",async t=>{
  const f=fixture(t,{approved:false});
  stagePinnedDesktopDevCandidate(f);
  const processes=[];
  const stopped=[];
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,
    spawnImpl:()=>{const p=child();p.pid=4100+processes.length;processes.push(p);return p},
    stopTreeImpl:pid=>{stopped.push(pid);return true},
  });
  assert.equal((await sup.reconcile()).state,"running");
  writeFileSync(join(f.state,"device-token.cloudflare-v3.txt"),"d".repeat(64));
  const changing=await sup.reconcile();
  assert.equal(changing.state,"stopping");
  assert.equal(changing.mcpReady,false);
  assert.deepEqual(stopped,[4100]);
  assert.equal(processes.length,1,"old Product must leave before new spawn");
  processes[0].exitCode=0;
  processes[0].emit("exit",0);
  assert.equal((await sup.reconcile()).state,"running");
  assert.equal(processes.length,2);
  sup.stop();
});

test("rotated Native bridge grant forces a new scoped Product process",async t=>{
  const f=fixture(t,{approved:false});
  stagePinnedDesktopDevCandidate(f);
  let bridge={url:"http://127.0.0.1:45678/__ordax/native/desktop-surface-state",
    token:"c".repeat(64)};
  const processes=[],launched=[],stopped=[];
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,nativeBridge:()=>bridge,
    spawnImpl:(_exe,_args,opts)=>{
      const p=child();p.pid=4200+processes.length;
      processes.push(p);launched.push(opts.env);return p;
    },
    stopTreeImpl:pid=>{stopped.push(pid);return true},
  });
  assert.equal((await sup.reconcile()).state,"running");
  assert.equal((await sup.reconcile()).state,"running");
  assert.equal(processes.length,1,"unchanged grant must not trigger restart");
  bridge={...bridge,token:"d".repeat(64)};
  assert.equal((await sup.reconcile()).state,"stopping");
  assert.deepEqual(stopped,[4200]);
  processes[0].exitCode=0;
  processes[0].emit("exit",0);
  assert.equal((await sup.reconcile()).state,"running");
  assert.equal(processes.length,2);
  assert.equal(launched[0].ORDAX_DESKTOP_SURFACE_BRIDGE_TOKEN,"c".repeat(64));
  assert.equal(launched[1].ORDAX_DESKTOP_SURFACE_BRIDGE_TOKEN,"d".repeat(64));
  sup.stop();
});

test("lost or malformed bridge grant revokes an already running Product",async t=>{
  const f=fixture(t,{approved:false});
  stagePinnedDesktopDevCandidate(f);
  let bridge={url:"http://127.0.0.1:45678/__ordax/native/desktop-surface-state",
    token:"c".repeat(64)};
  const proc=child();
  const stopped=[];
  let launches=0;
  const sup=createDesktopProductRuntimeSupervisor({
    systemRoot:f.systemRoot,userData:f.userData,platform:"win32",
    developmentCandidate:true,nativeBridge:()=>bridge,
    spawnImpl:()=>{launches++;return proc},
    stopTreeImpl:pid=>{stopped.push(pid);return true},
  });
  assert.equal((await sup.reconcile()).state,"running");
  bridge=null;
  const revoked=await sup.reconcile();
  assert.equal(revoked.state,"stopping");
  assert.equal(revoked.reason,"native_surface_bridge_unavailable");
  assert.equal(revoked.mcpReady,false);
  assert.deepEqual(stopped,[proc.pid]);
  assert.equal(launches,1);
  proc.exitCode=0;
  proc.emit("exit",0);
  const blocked=await sup.reconcile();
  assert.equal(blocked.state,"blocked");
  assert.equal(blocked.reason,"native_surface_bridge_unavailable");
  assert.equal(launches,1);
  sup.stop();
});
