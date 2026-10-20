'use strict';
const { fork, spawn } = require('node:child_process');
const { join } = require('node:path');
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
async function startHost({root,stateDirectory,userData,log}) {
  const port=await freePort();
  const child=fork(join(root,'tools/windows-emulator/dev-supervisor.mjs'),[],{
    cwd:root,execPath:process.execPath,windowsHide:true,
    stdio:['ignore','pipe','pipe','ipc'],
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',ORDAX_EMULATOR_NO_BROWSER:'1',
      ORDAX_DESKTOP_HOST:'1',
      ORDAX_DESKTOP_UPDATE_USER_DATA:userData,
      ORDAX_EMULATOR_PORT:String(port),ORDAX_EMULATOR_STATE_DIR:stateDirectory},
  });
  const startedAt=Date.now();
  let viteReadyAt=null;
  child.stdout.on('data',b=>{
    const line=String(b);
    log('runtime: '+line.trim());
    if(viteReadyAt===null && /ready in/i.test(line)){
      viteReadyAt=Date.now();
      log('Desktop host stage vite-ready after '+Math.round((viteReadyAt-startedAt)/1000)+'s');
    }
  });
  child.stderr.on('data',b=>log('runtime: '+String(b).trim()));
  child.on('error',e=>log('Runtime error: '+e.message));
  // A cold Windows profile can need tens of seconds to initialize Vite.
  // Readiness is confirmed by an actual HTTP response, not merely the Vite log.
  // Allow a bounded cold-start budget and a separate page-transformation grace
  // after Vite reports ready. Never retry with 1.2s request cancellations.
  const processDeadline=startedAt+120000;
  const absoluteDeadline=startedAt+150000;
  let probes=0;
  while(child.exitCode===null) {
    const deadline=viteReadyAt===null
      ? processDeadline
      : Math.min(absoluteDeadline,Math.max(processDeadline,viteReadyAt+30000));
    if(Date.now()>=deadline)break;
    probes++;
    if(await isReady(port)){
      log('Desktop host stage http-ready after '+Math.round((Date.now()-startedAt)/1000)+'s; probes='+probes);
      return {child,url:'http://127.0.0.1:'+port};
    }
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  const exited=child.exitCode!==null;
  stopHost(child);
  throw Error(exited
    ? 'Canonical Native server exited before HTTP readiness: '+child.exitCode
    : 'Canonical Native server not ready within bounded cold start (Vite stage: '+(viteReadyAt===null?'not reached':'ready')+')');
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
