// OrdaX Supervisor: Windows adapter for the ONE canonical ordax-runtime.
// No credential, dispatcher, capability registry, signing key or second MCP lives here.
// Release activation is forbidden until the OS canonical component trust gates
// AND a signed, source-bound Windows executable have both been verified.
import {spawn,execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {lstatSync,readFileSync,realpathSync} from "node:fs";
import {isAbsolute,join,relative,sep} from "node:path";

const SHA40=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const TOKEN=/^[a-f0-9]{64}$/;
const HOST="ordax-desktop";
const SCHEMA="ordax.product-runtime-supervisor-status/1";
const POLICY_SCHEMA="prototype-ordax.runtime-component-trust-policy/1";
const SOURCE_SCHEMA="prototype-ordax.studio-runtime-source-lock/1";

function readRegular(file,limit){
  const st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>limit)
    throw Error("Untrusted product runtime input");
  return readFileSync(file);
}
function isWithin(root,path){
  const rel=relative(root,path);
  return rel && rel!==".."&&!rel.startsWith(".."+sep)&&!isAbsolute(rel);
}
function isSafeDirectory(root){
  const st=lstatSync(root);
  return st.isDirectory()&&!st.isSymbolicLink();
}
function readIdentity(userData){
  const base=join(userData,"native-state");
  const directory=join(base,"product-runtime");
  if(!isSafeDirectory(userData)||!isSafeDirectory(base)||!isSafeDirectory(directory))
    return null;
  const settings=JSON.parse(readRegular(join(directory,"agent-settings.json"),16384).toString("utf8"));
  const secret=readRegular(join(directory,"device-token.cloudflare-v3.txt"),128).toString("ascii").trim();
  if(typeof settings!=="object"||settings===null||
     !UUID.test(settings.device_id??"")||!TOKEN.test(secret)||
     settings.control_plane_protocol!=="cloudflare-v3"||
     typeof settings.product_mcp_url!=="string"||
     !["https://mcp.ordax.com.br","https://ordax-mcp.ordaxsystems.workers.dev"]
       .includes(settings.product_mcp_url.replace(/\/$/,"")))
    return null;
  return {directory,deviceId:settings.device_id,
    transport:settings.product_mcp_url,
    tokenFingerprint:createHash("sha256").update(secret,"ascii").digest("hex")};
}
function readReleaseGate(systemRoot){
  const policy=JSON.parse(readRegular(join(systemRoot,"docs","contracts",
    "runtime-component-trust-policy.json"),65536).toString("utf8"));
  const lock=JSON.parse(readRegular(join(systemRoot,"system","services",
    "device-agent","studio-runtime-source-lock.json"),65536).toString("utf8"));
  if(policy.$schema!==POLICY_SCHEMA||lock.$schema!==SOURCE_SCHEMA||
     policy.trust_domain!=="runtime-components"||
     policy.status!=="canonical-public-trust-pinned"||
     policy.public_anchor?.pinned!==true||
     policy.current_gates?.canonical_component_trust_anchor_pinned!==true||
     policy.current_gates?.component_publish_allowed!==true||
     policy.current_gates?.production_component_slot_activation_allowed!==true||
     lock.distribution?.signed_runtime_slot_available!==true||
     lock.distribution?.source_binding_only!==false||
     lock.activation?.requires_signed_runtime_slot!==true||
     lock.candidate_evidence_by_target?.["windows-amd64"]?.source_commit!==lock.source?.commit||
     !SHA40.test(lock.source?.commit??""))
    return null;
  return {sourceCommit:lock.source.commit};
}

// DEV is an independent, explicitly opted-in launch proof, not a signed-slot
// fallback. The canonical production trust policy and source lock remain
// untouched. Candidate bytes are pinned to the OS-owned CI evidence; a local
// file name, environment variable or Runtime self-report never proves them.
function readDesktopDevCandidateGate(systemRoot){
  const policy=JSON.parse(readRegular(join(systemRoot,"docs","contracts",
    "runtime-component-trust-policy.json"),65536).toString("utf8"));
  const evidence=JSON.parse(readRegular(join(systemRoot,"docs","evidence",
    "desktop-runtime-windows-candidate-2026-10-31.json"),65536).toString("utf8"));
  const candidate=evidence.candidate,proof=evidence.physical_offline_proof;
  if(policy.$schema!==POLICY_SCHEMA||policy.trust_domain!=="runtime-components"||
     policy.status!=="operator-ceremony-pending"||
     policy.current_gates?.canonical_component_trust_anchor_pinned!==false||
     policy.current_gates?.component_publish_allowed!==false||
     policy.current_gates?.production_component_slot_activation_allowed!==false||
     evidence.$schema!=="ordax.desktop-runtime-candidate-evidence/1"||
     evidence.status!=="unsigned-candidate-physically-offline-proven"||
     candidate?.schema!=="ordax.desktop-runtime-candidate/1"||
     candidate.source_repository!=="ordaxsystems/ordax-runtime"||
     candidate.profile!=="ordax-desktop"||candidate.platform!=="windows-amd64"||
     candidate.artifact!=="ordax-product-agent.exe"||
     !SHA40.test(candidate.source_commit??"")||
     !SHA256.test(candidate.sha256??"")||
     !Number.isSafeInteger(candidate.size_bytes)||
     candidate.size_bytes<512||candidate.size_bytes>32*1024*1024||
     candidate.offline_proof_verified!==true||
     candidate.signature_present!==false||
     candidate.signed_distribution_authorized!==false||
     candidate.stable_activation_authorized!==false||
     evidence.canonical_source_lock_promoted!==false||
     proof?.passed!==true||proof.source_commit!==candidate.source_commit||
     proof.executable_sha256!==candidate.sha256||
     proof.remote_action_proven!==false)
    return null;
  return {sourceCommit:candidate.source_commit,sha256:candidate.sha256,
    sizeBytes:candidate.size_bytes,dev:true};
}
function readDesktopDevCandidate(userData,gate){
  try {
    const base=join(userData,"native-state");
    const dir=join(base,"product-runtime-dev");
    const executable=join(dir,"ordax-product-agent.exe");
    if(!isSafeDirectory(userData)||!isSafeDirectory(base)||!isSafeDirectory(dir))
      return null;
    const file=lstatSync(executable);
    if(!file.isFile()||file.isSymbolicLink()||file.size!==gate.sizeBytes)
      return null;
    const parent=realpathSync(dir),resolved=realpathSync(executable);
    if(!isWithin(realpathSync(userData),parent)||
       !isWithin(parent,resolved)||relative(parent,resolved)!=="ordax-product-agent.exe")
      return null;
    const hash=createHash("sha256").update(readRegular(executable,32*1024*1024)).digest("hex");
    if(hash!==gate.sha256)return null;
    return {executable:resolved,sourceCommit:gate.sourceCommit,dev:true};
  } catch {return null}
}

// The Product component-channel Go helper already defines the seven-field
// inspect-native-product-handoff receipt. Never invent another source of
// signed artifact metadata for the Windows adapter.
function safePlan(userData,sourceCommit,receipt){
  if(typeof receipt!=="string"||receipt.length>4096||receipt.includes("\r"))return null;
  const fields=new Map();
  for(const line of receipt.trimEnd().split("\n")){
    const index=line.indexOf("=");
    if(index<=0)return null;
    const key=line.slice(0,index);
    if(!/^[A-Z][A-Z_]*$/.test(key)||fields.has(key))return null;
    fields.set(key,line.slice(index+1));
  }
  const expected=["PRODUCT_RUNTIME_HANDOFF_VERIFIED","SOURCE_COMMIT","VERSION",
    "REVISION","EXECUTABLE","RUNTIME_STARTED","CENTRAL_SESSION_ATTESTED"];
  if(fields.size!==expected.length||expected.some(k=>!fields.has(k))||
     fields.get("PRODUCT_RUNTIME_HANDOFF_VERIFIED")!=="YES"||
     fields.get("RUNTIME_STARTED")!=="NO"||
     fields.get("CENTRAL_SESSION_ATTESTED")!=="NO"||
     fields.get("SOURCE_COMMIT")!==sourceCommit||
     !/^(0|[1-9][0-9]*)\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(fields.get("VERSION")??"")||
     !/^(0|[1-9][0-9]*)$/.test(fields.get("REVISION")??"")||
     !Number.isSafeInteger(Number(fields.get("REVISION"))))
    return null;
  const executable=fields.get("EXECUTABLE");
  if(!executable||!isAbsolute(executable)||!executable.toLowerCase().endsWith(".exe")||
     !isWithin(join(userData,"Components"),executable))return null;
  try {
    const root=realpathSync(join(userData,"Components"));
    const actual=realpathSync(executable);
    if(!isWithin(root,actual)||!isSafeDirectory(root))return null;
    const stat=lstatSync(executable);
    if(!stat.isFile()||stat.isSymbolicLink())return null;
    return {executable:actual,sourceCommit};
  } catch {return null}
}
// The installed Electron resource owns the verifier executable and public key;
// active Git source only supplies its source lock and canonical trust policy.
// This invokes the SAME signed-slot verifier as the Native/USB Supervisor.
export function createDesktopSignedRuntimeHandoff({
  verifierRoot,execFileImpl=execFile,
}={}){
  if(typeof verifierRoot!=="string"||!isAbsolute(verifierRoot)||
     typeof execFileImpl!=="function")throw TypeError("Installed verifier root required");
  return ({systemRoot,userData})=>new Promise((resolve,reject)=>{
    const helper=join(verifierRoot,"tools","runtime-component-channel",
      "ordax-runtime-component-channel.exe");
    const trust=join(verifierRoot,"system","trust","runtime-components-ed25519.json");
    try{
      const executable=lstatSync(helper);
      if(!isSafeDirectory(verifierRoot)||!executable.isFile()||
         executable.isSymbolicLink()||executable.size<1||
         executable.size>32*1024*1024||!readRegular(trust,16384))
        throw Error("Trusted Windows verifier unavailable");
      if(!isWithin(realpathSync(verifierRoot),realpathSync(helper))||
         !isWithin(realpathSync(verifierRoot),realpathSync(trust)))
        throw Error("Windows component verifier escaped installed root");
    }catch{
      return reject(Error("Trusted Windows verifier unavailable"));
    }
    execFileImpl(helper,["inspect-native-product-handoff","--target","windows-amd64",
      "--source-lock",join(systemRoot,"system","services","device-agent",
        "studio-runtime-source-lock.json"),
      "--trust-policy",join(systemRoot,"docs","contracts",
        "runtime-component-trust-policy.json"),
      "--trust",trust,"--root",join(userData,"Components")],
    {encoding:"utf8",timeout:3000,maxBuffer:4096,windowsHide:true,
      env:{SystemRoot:process.env.SystemRoot??"",WINDIR:process.env.WINDIR??""}},
    (err,stdout)=>err?reject(Error("Verified Product Runtime unavailable")):
      resolve(stdout));
  });
}
function snapshot(state,reason,identity){
  return Object.freeze({
    schema:SCHEMA,host:HOST,state,reason,
    enrolled:identity,processRunning:state==="running"||state==="stopping",
    // Process presence must never be displayed as an attested MCP session.
    mcpReady:false,capabilityDigest:null,centralSessionAttested:false,
  });
}
export function createDesktopProductRuntimeSupervisor({
  systemRoot,userData,verifiedHandoff=null,developmentCandidate=false,spawnImpl=spawn,
  platform=process.platform,env=process.env,log=()=>{},
}={}){
  if(typeof systemRoot!=="string"||!isAbsolute(systemRoot)||
     typeof userData!=="string"||!isAbsolute(userData)||
     typeof developmentCandidate!=="boolean"||
     (verifiedHandoff!==null&&typeof verifiedHandoff!=="function")||
     typeof spawnImpl!=="function"||typeof log!=="function")
    throw TypeError("OrdaX Supervisor requires OS-owned roots and verifier");
  let active=null,closed=false,transition=Promise.resolve();
  // Exit 43 is the canonical Runtime credential-recovery request. Repeating
  // the same rejected identity every 30s cannot repair it and wastes calls.
  // Never persist the token or authorize retry until its fingerprint changes.
  let credentialRecoveryFingerprint=null;
  let current=snapshot("blocked","not_checked",false);
  const stopActive=()=>{
    if(!active)return true;
    const owned=active;
    if(owned.child.exitCode!==null||owned.child.signalCode!==null){
      active=null;return true;
    }
    // Do not start a replacement while the prior owned child may still be
    // executing. It is reaped only by its own exit/error event, never by PID.
    if(!owned.stopRequested){
      owned.stopRequested=true;
      try{owned.child.kill("SIGTERM")}catch{}
    }
    return false;
  };
  function reconcileNow(){
    if(closed){
      const ended=stopActive();
      return current=snapshot(ended?"stopped":"stopping","supervisor_closed",false);
    }
    if(platform!=="win32"){
      stopActive();return current=snapshot("blocked","unsupported_host",false);
    }
    let identity=null;
    try{identity=readIdentity(userData)}catch{}
    if(!identity){
      const ended=stopActive();
      return current=snapshot(ended?"blocked":"stopping","device_not_enrolled",false);
    }
    if(credentialRecoveryFingerprint===identity.tokenFingerprint){
      const ended=stopActive();
      return current=snapshot(ended?"blocked":"stopping",
        "device_credential_recovery_required",true);
    }
    credentialRecoveryFingerprint=null;
    let gate=null;
    try{gate=readReleaseGate(systemRoot)}catch{}
    // The unsigned candidate is eligible ONLY by explicit local DEV opt-in,
    // and only while all production trust/publication gates remain closed.
    if(!gate&&developmentCandidate){
      try{gate=readDesktopDevCandidateGate(systemRoot)}catch{}
    }
    if(!gate){
      const ended=stopActive();
      return current=snapshot(ended?"blocked":"stopping","component_trust_not_authorized",true);
    }
    if(!gate.dev&&!verifiedHandoff){
      const ended=stopActive();
      return current=snapshot(ended?"blocked":"stopping","signed_windows_runtime_unavailable",true);
    }
    return {gate,identity};
  }
  async function actuallyReconcile(){
    const prepared=reconcileNow();
    if(!prepared?.gate)return current;
    let plan=null;
    if(prepared.gate.dev){
      plan=readDesktopDevCandidate(userData,prepared.gate);
    }else{
      let receipt;
      try{receipt=await verifiedHandoff({
        systemRoot,userData,sourceCommit:prepared.gate.sourceCommit,
      })}catch{}
      plan=safePlan(userData,prepared.gate.sourceCommit,receipt);
    }
    if(!plan){
      const ended=stopActive();
      return current=snapshot(ended?"blocked":"stopping",
        prepared.gate.dev?"dev_candidate_unavailable":"signed_windows_runtime_unavailable",true);
    }
    // Recheck the exact trust and token after asynchronous signed-slot work.
    // A revoked key or an updated OS/source pin cannot authorize a launch.
    const fresh=reconcileNow();
    if(!fresh?.gate)return current;
    if(fresh.gate.sourceCommit!==prepared.gate.sourceCommit||
       fresh.gate.dev!==prepared.gate.dev||
       fresh.identity.deviceId!==prepared.identity.deviceId||
       fresh.identity.transport!==prepared.identity.transport||
       fresh.identity.tokenFingerprint!==prepared.identity.tokenFingerprint){
      const ended=stopActive();
      return current=snapshot(ended?"blocked":"stopping","identity_or_release_changed",true);
    }
    // Never reuse a process across unsigned DEV and signed release authority.
    const key=(plan.dev?"dev:":"signed:")+plan.executable+":"+
      plan.sourceCommit+":"+prepared.identity.deviceId;
    if(active?.key===key&&!active.stopRequested&&active.child.exitCode===null&&active.child.signalCode===null)
      return current=snapshot("running",plan.dev?"dev_remote_attestation_pending":"remote_attestation_pending",true);
    if(!stopActive()){
      return current=snapshot("stopping","previous_instance_still_running",true);
    }
    // Never inherit other Windows agent grants, secrets or interpreter overrides.
    const childEnv={};
    for(const [name,value] of Object.entries(env)){
      if(/^ORDAX_/i.test(name) ||
         /^(?:PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|PYTHONINSPECT|VIRTUAL_ENV|NODE_OPTIONS)$/i.test(name))
        continue;
      childEnv[name]=value;
    }
    Object.assign(childEnv,{
      ORDAX_RUNTIME_HOST_PROFILE:"ordax-desktop",
      ORDAX_DESKTOP_USER_DATA:userData,
      ORDAX_AGENT_STATE_DIR:prepared.identity.directory,
      ORDAX_PRODUCT_MCP_URL:prepared.identity.transport,
      PYTHONNOUSERSITE:"1",
    });
    let child;
    try{
      child=spawnImpl(plan.executable,[],{
        cwd:join(userData,"native-state"),env:childEnv,
        windowsHide:true,stdio:["ignore","ignore","ignore"],
      });
      if(!child?.pid||typeof child.kill!=="function")throw Error("Runtime process not started");
    }catch{
      return current=snapshot("blocked","runtime_spawn_failed",true);
    }
    active={key,child,stopRequested:false,
      tokenFingerprint:prepared.identity.tokenFingerprint};
    child.once?.("error",()=>{
      if(active?.child===child){
        active=null;
        if(current.state==="running"||current.state==="stopping")
          current=snapshot("blocked","runtime_spawn_failed",true);
      }
    });
    child.once?.("exit",(code)=>{
      if(active?.child===child){
        // An exit code is safe to publish; never log stderr, tokens, paths or
        // the remote control-plane payload as part of lifecycle diagnostics.
        log("Product Runtime exit code="+(Number.isInteger(code)?code:"signal"));
        // Runtime exit 43 means the Device credential was rejected or its
        // canonical store is unavailable. The only authorized recovery is
        // owner re-enrollment, not infinite process restarts or bypasses.
        const needsRecovery=code===43&&!active.stopRequested&&!closed;
        if(needsRecovery)
          credentialRecoveryFingerprint=active.tokenFingerprint;
        active=null;
        if(current.state==="running"||current.state==="stopping")
          current=needsRecovery
            ? snapshot("blocked","device_credential_recovery_required",true)
            : snapshot("stopped","runtime_exited",true);
      }
    });
    log("OrdaX product runtime process owned by Native host; remote session not attested");
    return current=snapshot("running",plan.dev?"dev_remote_attestation_pending":"remote_attestation_pending",true);
  }
  return Object.freeze({
    status(){return current},
    reconcile(){
      const op=transition.then(actuallyReconcile,actuallyReconcile);
      transition=op.catch(()=>{});
      return op;
    },
    stop(){
      closed=true;
      const ended=stopActive();
      current=snapshot(ended?"stopped":"stopping","supervisor_closed",false);
      return current;
    },
  });
}
