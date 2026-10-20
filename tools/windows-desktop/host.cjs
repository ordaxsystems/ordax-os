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
      hostname:'127.0.0.1',port,path:'/tools/windows-emulator/index.html',timeout:1200,
    },r=>{r.resume();resolve(r.statusCode===200);});
    request.on('timeout',()=>request.destroy());
    request.on('error',()=>resolve(false));
  });
}
async function startHost({root,stateDirectory,log}) {
  const port=await freePort();
  const child=fork(join(root,'tools/windows-emulator/dev-supervisor.mjs'),[],{
    cwd:root,execPath:process.execPath,windowsHide:true,
    stdio:['ignore','pipe','pipe','ipc'],
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',ORDAX_EMULATOR_NO_BROWSER:'1',
      ORDAX_EMULATOR_PORT:String(port),ORDAX_EMULATOR_STATE_DIR:stateDirectory},
  });
  child.stdout.on('data',b=>log('runtime: '+String(b).trim()));
  child.stderr.on('data',b=>log('runtime: '+String(b).trim()));
  child.on('error',e=>log('Runtime error: '+e.message));
  const deadline=Date.now()+45000;
  while(Date.now()<deadline && child.exitCode===null) {
    if(await isReady(port)) return {child,url:'http://127.0.0.1:'+port};
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  stopHost(child);
  throw Error('Canonical Native server did not become ready');
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
module.exports={startHost,stopHost,freePort};
