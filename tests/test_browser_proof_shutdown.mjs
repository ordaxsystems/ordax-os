import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stopOwnedBrowser} from '../tools/browser-proof/chromium.mjs';

function spawnOwnedNode(script) {
  const child=spawn(process.execPath,['-e',script],{
    windowsHide:true,stdio:'ignore',
  });
  let exitState=null;
  child.once('exit',(code,signal)=>{exitState={code,signal};});
  return {child,exited:()=>exitState};
}
async function waitForFile(path) {
  const deadline=Date.now()+7000;
  while(Date.now()<deadline){
    try{return await readFile(path,'utf8');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(done=>setTimeout(done,35));
  }
  throw Error('Browser proof descendant did not initialize');
}

test('stops only the owned browser proof process',async()=>{
  const {child,exited}=spawnOwnedNode('setInterval(()=>{},1000)');
  try {
    await stopOwnedBrowser(child,exited);
    assert.ok(exited(),'test-owned process must exit before profile cleanup');
  } finally {
    if(!exited())child.kill('SIGKILL');
  }
});

test('Windows cleanup terminates child processes retaining the disposable profile',{
  skip:process.platform!=='win32',
},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ordax-browser-shutdown-test-'));
  const marker=join(directory,'descendant.pid');
  const descendantCode='require("node:fs").writeFileSync('+JSON.stringify(marker)+',String(process.pid));setInterval(()=>{},1000);';
  const parentCode='require("node:child_process").spawn(process.execPath,["-e",'+JSON.stringify(descendantCode)+'],{windowsHide:true,stdio:"ignore"});setInterval(()=>{},1000);';
  const {child,exited}=spawnOwnedNode(parentCode);
  let descendantPid=null;
  try{
    descendantPid=Number(await waitForFile(marker));
    assert.ok(Number.isSafeInteger(descendantPid) && descendantPid>0);
    await stopOwnedBrowser(child,exited);
    assert.ok(exited(),'test-owned parent should exit');
    await new Promise(done=>setTimeout(done,100));
    assert.throws(()=>process.kill(descendantPid,0),{code:'ESRCH'},
      'owned grandchild must not keep its temporary profile locked');
  } finally{
    if(!exited())child.kill('SIGKILL');
    // Do not clean up while a child might still be alive on a failed proof.
    if(descendantPid!==null){
      try{process.kill(descendantPid,0);}
      catch(error){if(error.code==='ESRCH')await rm(directory,{recursive:true,force:true});}
    }else await rm(directory,{recursive:true,force:true});
  }
});
