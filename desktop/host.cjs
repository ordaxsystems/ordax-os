'use strict';
const { fork } = require('node:child_process');
const { join, isAbsolute } = require('node:path');
const { existsSync } = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
function freePort() {
  return new Promise((resolve,reject) => {
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',() => {
      const port=server.address().port;
      server.close(err=>err?reject(err):resolve(port));
    });
  });
}
function isReady(port, nativeGrant=null,signal=null) {
  if(signal?.aborted)return Promise.resolve(false);
  const attested=nativeGrant!==null;
  if(attested && (typeof nativeGrant!=='string'||!/^[0-9a-f]{64}$/.test(nativeGrant)))
    return Promise.resolve(false);
  // Only the Vite development fallback retains its historical HTML probe.
  // An installed Native process must answer a fresh, grant-bound challenge.
  const challenge=attested?randomBytes(32).toString('hex'):null;
  return new Promise(resolve => {
    const request=http.get({
      hostname:'127.0.0.1',port,
      path:attested?'/__ordax/desktop-host-ready':'/system/composition/native/index.html',
      timeout:8000,signal,
      headers:attested?{'X-Ordax-Desktop-Ready-Challenge':challenge}:{},
    },r=>{
      r.resume();
      if(!attested) return resolve(r.statusCode===200);
      const proof=r.headers['x-ordax-desktop-ready-proof'];
      if(r.statusCode!==200||typeof proof!=='string'||!/^[0-9a-f]{64}$/.test(proof))
        return resolve(false);
      const expected=createHmac('sha256',Buffer.from(nativeGrant,'hex'))
        .update('ordax.desktop.native-ready/1:'+challenge).digest();
      resolve(timingSafeEqual(expected,Buffer.from(proof,'hex')));
    });
    request.on('timeout',()=>request.destroy());
    request.on('error',()=>resolve(false));
  });
}
// Node leaves exitCode null for processes killed by a signal. A failed
// fork may also emit 'error' before there is any PID to observe.
function hasHostExited(child) {
  return child.exitCode!==null || child.signalCode!==null;
}
async function startHost({root,template=root,stateDirectory,userData,log,builtAssetsRoot=null,
  fileToken,localSessionToken,nativeSessionToken,diagnosticToken,deviceProfileToken,stateToken,networkToken,observationToken,surfaceReportToken,displayToken,localAiToken,sourceSha="",powerHelperPath=null,signal=null}) {
  if(typeof fileToken!=="string" || !/^[0-9a-f]{64}$/.test(fileToken))
    throw TypeError("OrdaX Desktop Files require per-launch authorization");
  if(typeof localSessionToken!=="string" || !/^[0-9a-f]{64}$/.test(localSessionToken) ||
     localSessionToken===fileToken)
    throw TypeError("OrdaX Desktop local session requires an independent per-launch authorization");
  if(!/^[0-9a-f]{64}$/.test(nativeSessionToken) ||
     !/^[0-9a-f]{64}$/.test(diagnosticToken) ||
     !/^[0-9a-f]{64}$/.test(deviceProfileToken) ||
     !/^[0-9a-f]{64}$/.test(stateToken) ||
     !/^[0-9a-f]{64}$/.test(networkToken) ||
     !/^[0-9a-f]{64}$/.test(observationToken) ||
     !/^[0-9a-f]{64}$/.test(surfaceReportToken) ||
     !/^[0-9a-f]{64}$/.test(displayToken) ||
     !/^[0-9a-f]{64}$/.test(localAiToken) ||
     new Set([fileToken,localSessionToken,nativeSessionToken,diagnosticToken,deviceProfileToken,stateToken,networkToken,observationToken,surfaceReportToken,displayToken,localAiToken]).size!==11)
    throw TypeError("Desktop Native sessions require independent per-launch tokens");
  if(sourceSha!=="" && !/^[0-9a-f]{40}$/.test(sourceSha))
    throw TypeError("Desktop diagnostic source SHA must be verified");
  if(powerHelperPath!==null &&
     (typeof powerHelperPath!=='string'||!isAbsolute(powerHelperPath)))
    throw TypeError('Installed Native power helper must be an absolute attested Desktop resource');
  if(signal?.aborted)throw Error('Desktop Native startup cancelled by shutdown');
  const port=await freePort();
  if(signal?.aborted)throw Error('Desktop Native startup cancelled by shutdown');
  const installedNative=join(root,'tools','windows-emulator','desktop-native-server.mjs');
  // Only the installer/transaction verifier selects builtAssetsRoot. An
  // older installed fallback without the Native runner still uses Vite;
  // no unverified candidate or development checkout gains a new boot path.
  const staticHost=Boolean(builtAssetsRoot && existsSync(installedNative));
  // Old Git candidates may predate the compiled Native listener. Preserve
  // rollback by mounting the verified offline compiler only for those Vite
  // fallback versions, never for a normal compiled boot.
  if(!staticHost && root!==template){
    const {dependencies}=require('./checkout.cjs');
    dependencies(root,template,userData);
  }
  if(!staticHost && !existsSync(join(root,'node_modules','vite','bin','vite.js')))
    throw Error('Uncompiled Native fallback requires a verified offline Dev toolchain');
  const entry=staticHost?installedNative:
    join(root,'tools','windows-emulator','dev-supervisor.mjs');
  if(signal?.aborted)throw Error('Desktop Native startup cancelled by shutdown');
  const child=fork(entry,[],{
    cwd:root,execPath:process.execPath,windowsHide:true,
    stdio:['ignore','pipe','pipe','ipc'],
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',ORDAX_EMULATOR_NO_BROWSER:'1',
      ORDAX_DESKTOP_HOST:'1',
      ORDAX_DESKTOP_POWER_HELPER:powerHelperPath??'',
      ORDAX_DESKTOP_UPDATE_USER_DATA:userData,
      ORDAX_DESKTOP_FILE_TOKEN:fileToken,
      ORDAX_DESKTOP_LOCAL_SESSION_TOKEN:localSessionToken,
      ORDAX_DESKTOP_NATIVE_SESSION_TOKEN:nativeSessionToken,
      ORDAX_DESKTOP_DIAGNOSTIC_TOKEN:diagnosticToken,
      ORDAX_DESKTOP_DEVICE_PROFILE_TOKEN:deviceProfileToken,
      ORDAX_DESKTOP_STATE_TOKEN:stateToken,
      ORDAX_DESKTOP_NETWORK_TOKEN:networkToken,
      ORDAX_DESKTOP_OBSERVATION_TOKEN:observationToken,
      ORDAX_DESKTOP_SURFACE_REPORT_TOKEN:surfaceReportToken,
      ORDAX_DESKTOP_LOCAL_AI_TOKEN:localAiToken,
      ORDAX_DESKTOP_LOCAL_AI_ROOT:join(template,'local-ai-runtime'),
      // The signed component verifier is an installer resource. Git version
      // checkouts selected by ordax-pull never own this executable.
      ORDAX_DESKTOP_COMPONENT_VERIFIER_ROOT:template,
      ORDAX_DESKTOP_DISPLAY_TOKEN:displayToken,
      ORDAX_DESKTOP_RENDERED_SOURCE_SHA:sourceSha,
      // Explicit child-only proof that this is unversioned source execution,
      // never a packaged/staged candidate. It authorizes only an ephemeral
      // Native session; diagnostics still cannot be persisted without a SHA.
      ORDAX_DESKTOP_UNVERSIONED_SOURCE_SESSION:
        sourceSha==="" && !staticHost ? "1" : "",
      ORDAX_EMULATOR_PORT:String(port),ORDAX_EMULATOR_STATE_DIR:stateDirectory,
      ORDAX_DESKTOP_ASSETS_ROOT:builtAssetsRoot??''},
  });
  // Before ready, the async host has not yet been assigned to Electron's
  // runtime owner. Stop its exact child synchronously if Electron quits now.
  // The existing OS-owned process-tree policy remains the sole stop mechanism.
  const cancelPending=()=>{stopHost(child,template);};
  signal?.addEventListener('abort',cancelPending,{once:true});
  if(signal?.aborted)cancelPending();
  const startedAt=Date.now();
  let runtimeReadyAt=null;
  child.stdout.on('data',b=>{
    const line=String(b);
    log('runtime: '+line.trim());
    const ready=staticHost ? /Desktop native host ready on loopback/.test(line) :
      /ready in/i.test(line);
    if(runtimeReadyAt===null && ready){
      runtimeReadyAt=Date.now();
      log((staticHost?'Installed Native':'Vite fallback')+
        ' listener-ready after '+Math.round((runtimeReadyAt-startedAt)/1000)+'s');
    }
  });
  child.stderr.on('data',b=>log('runtime: '+String(b).trim()));
  let launchError=null;
  child.on('error',e=>{
    launchError=e;
    log('Runtime error: '+e.message);
  });
  // The installed Native server uses already-verified compiled bytes and
  // no source transformation; keep Vite's larger cold-start grace only for
  // backwards-compatible old bundles and explicit emulator development.
  // In both modes the health proof remains an actual HTTP 200.
  const processDeadline=startedAt+(staticHost?45000:120000);
  const absoluteDeadline=startedAt+(staticHost?60000:150000);
  let probes=0;
  try {
    while(!signal?.aborted && !hasHostExited(child) && launchError===null) {
      const deadline=runtimeReadyAt===null
        ? processDeadline
        : Math.min(absoluteDeadline,Math.max(processDeadline,
            runtimeReadyAt+(staticHost?10000:30000)));
      if(Date.now()>=deadline)break;
      probes++;
      if(await isReady(port,staticHost?nativeSessionToken:null,signal)){
        if(signal?.aborted)break;
        log((staticHost?'Installed Native':'Vite fallback')+
          ' http-ready after '+Math.round((Date.now()-startedAt)/1000)+'s; probes='+probes);
        return {child,url:'http://127.0.0.1:'+port,template};
      }
      await new Promise(resolve=>setTimeout(resolve,350));
    }
  } catch(error) {
    stopHost(child,template);
    throw error;
  } finally {
    signal?.removeEventListener('abort',cancelPending);
  }
  const cancelled=signal?.aborted;
  const exited=hasHostExited(child);
  stopHost(child,template);
  throw Error(cancelled
    ? 'Desktop Native startup cancelled by shutdown'
    : launchError
    ? 'Canonical Native server could not start: '+(launchError.code||'SPAWN_ERROR')
    : exited
      ? 'Canonical Native server exited before HTTP readiness: '+
          (child.signalCode||child.exitCode)
      : 'Canonical Native server not ready within bounded cold start ('+
        (staticHost?'installed-host':'vite-fallback')+' stage: '+
        (runtimeReadyAt===null?'not reached':'ready')+')');
}
// Detect a Native host that dies after successful boot. Only the current host
// can request recovery; deliberate shutdown, rollback and stale children cannot.
function watchHostAfterReady(child,{isCurrent,isStopping,onUnexpectedExit}={}) {
  if(!child || typeof child.once!=='function' ||
     typeof child.off!=='function' || typeof isCurrent!=='function' ||
     typeof isStopping!=='function' || typeof onUnexpectedExit!=='function')
    throw TypeError('Native host exit watcher requires a supervised child and guards');
  let active=true,delivered=false;
  const onExit=(code,signal)=>{
    if(!active || delivered || isStopping() || !isCurrent(child))return;
    delivered=true;
    onUnexpectedExit(Object.freeze({
      code:Number.isInteger(code)?code:null,
      signal:typeof signal==='string'?signal:null,
    }));
  };
  child.once('exit',onExit);
  // A process can exit between readiness and watcher registration.
  if(hasHostExited(child))queueMicrotask(()=>onExit(child.exitCode,child.signalCode));
  return ()=>{
    active=false;
    child.off('exit',onExit);
  };
}
// A Product Runtime may be an orphan if its Native parent crashed.
// Never auto-launch another Product Runtime until its owner can attest the
// previous process is gone. Unenrolled Desktop Dev can recover once.
function canAutoRelaunchHost({packaged,alreadyRetried,productIdentityPresent}={}) {
  return packaged===true && alreadyRetried===false &&
    productIdentityPresent===false;
}
function stopHost(child,template=null) {
  // Reuse the OS-owned synchronous Win32 process-tree policy. The old
  // asynchronous taskkill outlived Electron and could strand the supervised
  // Product Runtime when the parent disappeared. Never scan by process name.
  if(!child?.pid || hasHostExited(child)) return true;
  if(process.platform==='win32') {
    if(typeof template==='string') {
      try {
        const {stopOwnedWindowsProcessTree}=require(join(template,
          'system','adapters','desktop','owned-process-tree.cjs'));
        if(stopOwnedWindowsProcessTree(child.pid)) return true;
      } catch { /* No unverified or legacy process-tree authority. */ }
    }
    // Never kill only the Node Native host on Windows: it may own a
    // PyInstaller bootloader and a separately running Product Runtime child.
    // On policy failure retain the exact host PID for an owned retry; the
    // Electron before-quit gate must refuse exit until the tree is stopped.
    return false;
  }
  // Non-Windows development hosts do not launch this Windows Product child.
  try { child.kill('SIGTERM'); } catch {}
  return false;
}
module.exports={startHost,stopHost,freePort,isReady,watchHostAfterReady,canAutoRelaunchHost};
