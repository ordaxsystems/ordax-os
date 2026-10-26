'use strict';
const { fork, spawn } = require('node:child_process');
const { join } = require('node:path');
const { existsSync } = require('node:fs');
const net = require('node:net');
const http = require('node:http');
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
function isReady(port) {
  return new Promise(resolve => {
    const request=http.get({
      hostname:'127.0.0.1',port,path:'/system/composition/native/index.html',timeout:8000,
    },r=>{r.resume();resolve(r.statusCode===200);});
    request.on('timeout',()=>request.destroy());
    request.on('error',()=>resolve(false));
  });
}
async function startHost({root,stateDirectory,userData,log,builtAssetsRoot=null,
  fileToken,localSessionToken,nativeSessionToken,diagnosticToken,deviceProfileToken,stateToken,networkToken,observationToken,displayToken,sourceSha=""}) {
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
     !/^[0-9a-f]{64}$/.test(displayToken) ||
     new Set([fileToken,localSessionToken,nativeSessionToken,diagnosticToken,deviceProfileToken,stateToken,networkToken,observationToken,displayToken]).size!==9)
    throw TypeError("Desktop Native sessions require independent per-launch tokens");
  if(sourceSha!=="" && !/^[0-9a-f]{40}$/.test(sourceSha))
    throw TypeError("Desktop diagnostic source SHA must be verified");
  const port=await freePort();
  const installedNative=join(root,'tools','windows-emulator','desktop-native-server.mjs');
  // Only the installer/transaction verifier selects builtAssetsRoot. An
  // older installed fallback without the Native runner still uses Vite;
  // no unverified candidate or development checkout gains a new boot path.
  const staticHost=Boolean(builtAssetsRoot && existsSync(installedNative));
  // Old Git candidates may predate the compiled Native listener. Preserve
  // rollback by mounting the verified offline compiler only for those Vite
  // fallback versions, never for a normal compiled boot.
  if(!staticHost && root!==join(process.resourcesPath||'','runtime-template')){
    const {dependencies}=require('./checkout.cjs');
    dependencies(root,join(process.resourcesPath||'','runtime-template'),userData);
  }
  const entry=staticHost?installedNative:
    join(root,'tools','windows-emulator','dev-supervisor.mjs');
  const child=fork(entry,[],{
    cwd:root,execPath:process.execPath,windowsHide:true,
    stdio:['ignore','pipe','pipe','ipc'],
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',ORDAX_EMULATOR_NO_BROWSER:'1',
      ORDAX_DESKTOP_HOST:'1',
      ORDAX_DESKTOP_UPDATE_USER_DATA:userData,
      ORDAX_DESKTOP_FILE_TOKEN:fileToken,
      ORDAX_DESKTOP_LOCAL_SESSION_TOKEN:localSessionToken,
      ORDAX_DESKTOP_NATIVE_SESSION_TOKEN:nativeSessionToken,
      ORDAX_DESKTOP_DIAGNOSTIC_TOKEN:diagnosticToken,
      ORDAX_DESKTOP_DEVICE_PROFILE_TOKEN:deviceProfileToken,
      ORDAX_DESKTOP_STATE_TOKEN:stateToken,
      ORDAX_DESKTOP_NETWORK_TOKEN:networkToken,
      ORDAX_DESKTOP_OBSERVATION_TOKEN:observationToken,
      ORDAX_DESKTOP_DISPLAY_TOKEN:displayToken,
      ORDAX_DESKTOP_RENDERED_SOURCE_SHA:sourceSha,
      ORDAX_EMULATOR_PORT:String(port),ORDAX_EMULATOR_STATE_DIR:stateDirectory,
      ORDAX_DESKTOP_ASSETS_ROOT:builtAssetsRoot??''},
  });
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
  child.on('error',e=>log('Runtime error: '+e.message));
  // The installed Native server uses already-verified compiled bytes and
  // no source transformation; keep Vite's larger cold-start grace only for
  // backwards-compatible old bundles and explicit emulator development.
  // In both modes the health proof remains an actual HTTP 200.
  const processDeadline=startedAt+(staticHost?45000:120000);
  const absoluteDeadline=startedAt+(staticHost?60000:150000);
  let probes=0;
  while(child.exitCode===null) {
    const deadline=runtimeReadyAt===null
      ? processDeadline
      : Math.min(absoluteDeadline,Math.max(processDeadline,
          runtimeReadyAt+(staticHost?10000:30000)));
    if(Date.now()>=deadline)break;
    probes++;
    if(await isReady(port)){
      log((staticHost?'Installed Native':'Vite fallback')+
        ' http-ready after '+Math.round((Date.now()-startedAt)/1000)+'s; probes='+probes);
      return {child,url:'http://127.0.0.1:'+port};
    }
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  const exited=child.exitCode!==null;
  stopHost(child);
  throw Error(exited
    ? 'Canonical Native server exited before HTTP readiness: '+child.exitCode
    : 'Canonical Native server not ready within bounded cold start ('+
        (staticHost?'installed-host':'vite-fallback')+' stage: '+
        (runtimeReadyAt===null?'not reached':'ready')+')');
}
function stopHost(child) {
  if(!child?.pid) return;
  if(process.platform==='win32') {
    const kill=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{
      windowsHide:true,stdio:'ignore',
    });
    kill.on('error',()=>{});
  } else child.kill('SIGTERM');
}
module.exports={startHost,stopHost,freePort,isReady};
