import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createDesktopProductRuntimeSupervisor,createDesktopSignedRuntimeHandoff} from "./product-runtime-supervisor.mjs";

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
 assert.equal(status.state,"blocked");
 assert.equal(status.reason,"component_trust_not_authorized");
 assert.deepEqual(spawned.kills,["SIGTERM"]);
 assert.equal(status.capabilityDigest,null);
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
