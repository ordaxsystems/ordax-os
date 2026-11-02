'use strict';
// End-to-end STDIO adapter verification. This test deliberately uses a tiny
// disposable HTML fixture; it does NOT claim to be an OrdaX product UI proof.
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {createInterface}=require('node:readline');
const {mkdtempSync,existsSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');

test('real stdio NDJSON runner controls Chromium without a network listener',async t=>{
  const server=http.createServer((_req,res)=>{
    res.writeHead(200,{'content-type':'text/html'});
    res.end('<!doctype html><html><body><div id="ordax-boot-screen" data-state="ready"></div><div id="ordax-root"><button aria-label="Ajustes">Ajustes</button><p id="state">closed</p></div><script>document.querySelector("button").onclick=()=>document.querySelector("#state").textContent="opened";</script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const temp=mkdtempSync(join(tmpdir(),'ordax-visual-stdio-'));
  const artifacts=join(temp,'evidence');
  const child=spawn(process.execPath,[join(__dirname,'cli.cjs')],{
    cwd:__dirname,stdio:['pipe','pipe','pipe'],
    env:{...process.env,ORDAX_VISUAL_ARTIFACTS:artifacts}
  });
  const exit=once(child,'exit');
  let stderr='';
  child.stderr.on('data',part=>{stderr+=String(part).slice(0,1000);});
  const pending=new Map();
  const rl=createInterface({input:child.stdout,crlfDelay:Infinity});
  rl.on('line',line=>{
    let packet;
    try{packet=JSON.parse(line);}catch{return;}
    const task=pending.get(packet.id);
    if(task){pending.delete(packet.id);task(packet);}
  });
  t.after(async()=>{
    for(const [,task]of pending)task({ok:false,error:'test teardown'});
    if(child.exitCode===null&&!child.killed)child.kill();
    await new Promise(resolve=>server.close(resolve));
    rmSync(temp,{force:true,recursive:true});
  });
  let next=0;
  const send=async(op,args={})=>{
    const id=++next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('Bridge protocol timeout: '+op+'; '+stderr.slice(-300)));},30000);
      pending.set(id,packet=>{clearTimeout(timer);resolve(packet);});
      child.stdin.write(JSON.stringify({id,op,args})+'\n');
    });
  };
  const denied=await send('arbitrary_shell',{command:'whoami'});
  assert.equal(denied.ok,false);
  assert.match(denied.error,/Unknown bridge operation/);
  const url='http://127.0.0.1:'+server.address().port+'/system/composition/native/index.html';
  const launched=await send('launch',{mode:'web',url});
  assert.equal(launched.ok,true,JSON.stringify(launched));
  const listed=await send('list_windows');
  assert.equal(listed.result.length,1);
  const selected=await send('select_window',{id:listed.result[0].id});
  assert.equal(selected.ok,true);
  const asserted=await send('assert',{
    target:{role:'button',name:'Ajustes'},visible:true,minWidth:1
  });
  assert.equal(asserted.result.passed,true);
  const clicked=await send('click',{target:{role:'button',name:'Ajustes'}});
  assert.equal(clicked.ok,true);
  const inspected=await send('inspect',{target:{css:'#state'}});
  assert.equal(inspected.result.text,'opened');
  const a11y=await send('get_accessibility_tree');
  assert.match(a11y.result.ariaSnapshot,/Ajustes/);
  const e2e=await send('run_e2e',{scenario:'semantic-journey',steps:[
    {op:'assert',args:{target:{css:'#state'},textContains:'opened'}}
  ]});
  assert.equal(e2e.result.passed,true);
  assert.equal(e2e.result.assertions.length,1);
  const bad=await send('run_e2e',{scenario:'semantic-journey',steps:[
    {op:'inspect',args:{target:{css:'#never-mounted'}}}
  ]});
  assert.equal(bad.ok,false);
  assert.match(bad.error,/not mounted/);
  const receipt=await send('collect_artifacts');
  assert.equal(existsSync(receipt.result.diagnostics),true);
  assert.ok(receipt.result.artifacts.some(path=>path.endsWith('trace.zip')));
  const closed=await send('close');
  assert.equal(closed.ok,true);
  child.stdin.end();
  const [exitCode]=await exit;
  assert.equal(exitCode,0,stderr);
});