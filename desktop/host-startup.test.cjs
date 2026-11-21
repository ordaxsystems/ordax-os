'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {runInNewContext}=require('node:vm');
const {isReady,freePort,startHost,stopHost}=require('./host.cjs');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');


test('installed Desktop awaits its splash navigation before Native host startup',()=>{
  const source=readFileSync(join(__dirname,'main.cjs'),'utf8');
  assert.match(source,/const navigation=window\.loadURL\('data:text\/html/);
  assert.match(source,/navigation\.catch\(error=>log\(/);
  const awaitedSplash=source.indexOf("await status('Iniciando a Surface Native compartilhada...')");
  const nativeStart=source.indexOf('runtime=await startHost(',awaitedSplash);
  assert.ok(awaitedSplash>0&&nativeStart>awaitedSplash,
    'Native navigation must not cancel an unresolved splash load');
});
test('Native navigation installs before boot, blocks redirects and follows rollback origin',()=>{
  // Execute the canonical policy, not a duplicate test-only navigation gate.
  const source=readFileSync(join(__dirname,'main.cjs'),'utf8');
  const start=source.indexOf('function navigationPolicy() {');
  const end=source.indexOf('\nfunction menu(userData) {',start);
  assert.ok(start>0&&end>start,'single Native navigation owner must exist');
  const handlers=new Map(),opened=[];
  let popupHandler=null;
  const webContents={
    url:'data:text/html,starting',isDestroyed:()=>false,
    getURL(){return this.url;},
    on:(name,listener)=>handlers.set(name,listener),
    setWindowOpenHandler:handler=>{popupHandler=handler;},
  };
  const policy=runInNewContext('('+source.slice(start,end).trim()+')',{
    URL,window:{webContents},shell:{openExternal:url=>opened.push(url)},
  });
  const nav=policy();
  const navigate=(name,url,legacyUrl,main=true)=>{
    let rejected=0;
    handlers.get(name)({url,isMainFrame:main,preventDefault(){rejected++;}},legacyUrl);
    return rejected;
  };
  assert.equal(navigate('will-navigate','https://docs.example.com/preload'),1,
    'splash must never navigate to an external page');
  assert.equal(popupHandler({url:'https://docs.example.com/popup'}).action,'deny');
  assert.deepEqual(opened,[],'untrusted splash may not open external applications');
  assert.equal(navigate('will-redirect','https://docs.example.com/redirect'),1,
    'cross-origin redirects during cold startup must be rejected');
  assert.throws(()=>nav.setTrustedOrigin('https://example.com'),/loopback host origin/);
  assert.throws(()=>nav.setTrustedOrigin('http://127.0.0.1:43123/path'),/loopback host origin/);
  nav.setTrustedOrigin('http://127.0.0.1:43123');
  assert.equal(navigate('will-redirect','http://127.0.0.1:43123/system/composition/native/index.html'),0,
    'initial same-origin HTTP redirects remain compatible before Native load');
  webContents.url='http://127.0.0.1:43123/system/composition/native/index.html';
  assert.equal(navigate('will-navigate','http://127.0.0.1:43123/settings'),0);
  assert.equal(navigate('will-navigate','https://docs.example.com/manual'),1);
  assert.deepEqual(opened,['https://docs.example.com/manual'],
    'a user-originated external HTTPS link opens in the system browser');
  assert.equal(navigate('will-redirect','https://docs.example.com/redirect'),1);
  assert.deepEqual(opened,['https://docs.example.com/manual'],
    'server-side redirects are blocked without opening external apps');
  assert.equal(navigate('will-navigate','file:///C:/private'),1);
  assert.equal(navigate('will-navigate','javascript:alert(1)'),1);
  assert.equal(navigate('will-navigate','http://127.0.0.1:43124/'),1);
  assert.equal(navigate('will-navigate',undefined),1);
  assert.equal(navigate('will-navigate','file:///C:/secret','http://127.0.0.1:43123/'),1,
    'current event URL wins over stale legacy destination');
  assert.equal(navigate('will-navigate',undefined,'http://127.0.0.1:43123/settings'),0,
    'legacy tuple remains supported');
  assert.equal(navigate('will-navigate',undefined,'https://help.example.com/'),1);
  assert.equal(navigate('will-redirect','https://frame.example.com/',undefined,false),0,
    'iframe redirect is not a main-frame navigation');
  assert.equal(popupHandler({url:'https://help.example.com/new'}).action,'deny');
  assert.equal(popupHandler({url:'file:///C:/secret'}).action,'deny');
  assert.deepEqual(opened,[
    'https://docs.example.com/manual',
    'https://help.example.com/',
    'https://help.example.com/new',
  ]);
  nav.setTrustedOrigin(null);
  assert.equal(navigate('will-navigate','https://docs.example.com/disarmed'),1);
  assert.equal(popupHandler({url:'https://docs.example.com/disarmed'}).action,'deny');
  nav.setTrustedOrigin('http://127.0.0.1:43210');
  assert.equal(navigate('will-redirect','http://127.0.0.1:43123/'),1,
    'rollback must revoke the previous port before loading fallback');
  webContents.url='http://127.0.0.1:43210/system/composition/native/index.html';
  assert.equal(navigate('will-navigate','http://127.0.0.1:43210/home'),0);
  assert.equal(popupHandler({url:'https://docs.example.com/fallback'}).action,'deny');
  assert.equal(opened.at(-1),'https://docs.example.com/fallback');
  assert.match(source,/const nativeNavigation=navigationPolicy\(\);[\s\S]*?await status\('Iniciando a Surface Native compartilhada/);
  assert.equal(source.split('navigationPolicy();').length,2,
    'only one policy may be installed per BrowserWindow');
  assert.match(source,/bindNativeOrigin\(null\);\s*rejectCandidate/);
  assert.equal(source.split('bindNativeOrigin(runtime.url);').length,3,
    'both candidate and fallback bind the exact same Native origin');
});


test('Native external link failures are logged without unhandled Electron promises',async()=>{
  const source=readFileSync(join(__dirname,'main.cjs'),'utf8');
  const begin=source.indexOf('function navigationPolicy() {');
  const end=source.indexOf('\nfunction menu(userData) {',begin);
  assert.ok(begin>0 && end>begin);
  const logs=[],handlers=new Map();
  let popupHandler;
  const webContents={
    getURL:()=> 'http://127.0.0.1:43123/system/composition/native/index.html',
    isDestroyed:()=>false,
    on:(name,listener)=>handlers.set(name,listener),
    setWindowOpenHandler:handler=>{popupHandler=handler;},
  };
  let calls=0;
  const create=runInNewContext('('+source.slice(begin,end).trim()+')',{
    URL,window:{webContents},log:msg=>logs.push(msg),
    shell:{openExternal:()=>{
      calls++;
      return Promise.reject(Error('No HTTPS browser association'));
    }},
  });
  create().setTrustedOrigin('http://127.0.0.1:43123');
  assert.equal(popupHandler({url:'https://docs.example.com/'}).action,'deny');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  assert.ok(logs.some(line=>line.includes('System browser launch failed: No HTTPS browser association')),
    'a rejected shell Promise must have a handled diagnostic');
  let blocked=0;
  handlers.get('will-redirect')({
    url:'https://other.example.com/',isMainFrame:true,preventDefault(){blocked++;},
  });
  assert.equal(blocked,1);
  assert.equal(calls,1,'HTTP redirect never opens external browser');
});

test('Native Surface startup failure releases resources without losing unconfirmed owned process',()=>{
  const source=readFileSync(join(__dirname,'main.cjs'),'utf8');
  const begin=source.indexOf('function releaseFailedNativeStartup(');
  const end=source.indexOf('\nfunction monitorNativeHost(',begin);
  assert.ok(begin>0&&end>begin,'one canonical cleanup function must be wired before Native watchdog');
  const release=runInNewContext('('+source.slice(begin,end).trim()+')');
  const calls=[],logs=[];
  const child={pid:28736},currentHost={child,template:'verified-runtime-template'};
  const ports=()=>({
    currentHost,browser:{dispose:()=>calls.push('dispose')},
    disarm:()=>calls.push('disarm'),
    stop:(pid,template)=>{calls.push('stop');assert.equal(pid,child);
      assert.equal(template,currentHost.template);return true;},
    log:message=>logs.push(message),
  });
  assert.equal(release(ports()),null,'confirmed stop releases the exact Native process');
  assert.deepEqual(calls,['disarm','dispose','stop']);
  calls.length=0;
  const failed={...ports(),stop:()=>{calls.push('stop');return false}};
  assert.equal(release(failed),currentHost,'unconfirmed termination must remain owned for app quit');
  assert.deepEqual(calls,['disarm','dispose','stop']);
  assert.ok(logs.some(m=>m.includes('keeping exact PID')));
  calls.length=0;
  const throwing={...ports(),browser:{dispose:()=>{calls.push('dispose');throw Error('broken renderer');}}};
  assert.equal(release(throwing),null,'failed browser cleanup must not skip owned host termination');
  assert.deepEqual(calls,['disarm','dispose','stop']);
  assert.ok(logs.some(m=>m.includes('Internet host cleanup failed')));
  calls.length=0;
  assert.equal(release({...ports(),currentHost:null}),null);
  assert.deepEqual(calls,['disarm','dispose'],'no child must not trigger process stop');
  // The actual startup catch must route failures through this ownership policy.
  assert.match(source,/catch\(error\)\{\s*\/\/ Revoke navigation and privileged Internet commands[\s\S]*?bindNativeOrigin\(null\);\s*\/\/ A started host is not a healthy Surface;[\s\S]*?runtime=releaseFailedNativeStartup\(\{/,
    'revoke all Native/Internet grants before releasing the failed host');
  assert.match(source,/browserHost=null;\s*disarmNativeHostExit=null;\s*if\(nativeBootAbort\.signal\.aborted\)return;[^\n]*\s*log\('Startup failed:/);
  assert.match(source,/quitting=true;\s*let nativeStopConfirmed=true;\s*runDesktopShutdownStages\(\[/);
  assert.match(source,/\['abort-native-boot',\(\)=>nativeBootAbort\.abort\(\)\]/);
  assert.equal((source.match(/signal:nativeBootAbort\.signal/g)||[]).length,2,
    'both candidate and rollback host boots must share shutdown cancellation');
  assert.match(source,/if\(nativeBootAbort\.signal\.aborted \|\| !selected\.trial\)throw error;/,
    'a shutdown must not mark the trial as unhealthy');
  assert.match(source,
    /rejectCandidate\(userData,selected\.sha\);[\s\S]*?if\(runtime\?\.child && !stopHost\(runtime\.child,runtime\.template\)\)\s*throw Error\('Native rollback blocked: previous owned process tree not stopped'\);\s*runtime=null;\s*const fallback=await chooseBootVersion/,
    'never start a rollback Native host while the rejected candidate tree is unconfirmed');
});

test('cold Native HTTP probe waits for delayed but valid response rather than canceling after 1.2 seconds',async t=>{
  const server=http.createServer((request,response)=>{
    assert.equal(request.url,'/system/composition/native/index.html');
    setTimeout(()=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<main>OrdaX</main>');},1650);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const started=Date.now();
  const result=await isReady(server.address().port);
  assert.equal(result,true);
  assert.ok(Date.now()-started>=1500);
});
test('Native HTTP readiness aborts a hanging loopback response on shutdown',async t=>{
  const server=http.createServer(()=>{});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const controller=new AbortController();
  const started=Date.now();
  const pending=isReady(server.address().port,null,controller.signal);
  setTimeout(()=>controller.abort(),80);
  assert.equal(await pending,false,'a cancelled response must never attest Native readiness');
  assert.ok(Date.now()-started<1200,'shutdown must not wait for the 8s HTTP probe deadline');
});

test('Native HTTP probe refuses an unbound local port without fabricating readiness',async()=>{
  const port=await freePort();
  assert.equal(await isReady(port),false);
});

test('installed Native boot refuses unrelated HTTP 200 and forged readiness proofs',async t=>{
  const foreign=http.createServer((request,response)=>{
    if(request.url==='/__ordax/desktop-host-ready'){
      response.writeHead(200,{'X-Ordax-Desktop-Ready-Proof':'f'.repeat(64)});
      return response.end();
    }
    response.writeHead(200,{'Content-Type':'text/html'});
    response.end('<main>Unrelated local web server</main>');
  });
  await new Promise(resolve=>foreign.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>foreign.close(resolve)));
  const port=foreign.address().port;
  assert.equal(await isReady(port),true,'Vite legacy probe is unchanged');
  assert.equal(await isReady(port,'a'.repeat(64)),false,'installed host must reject a spoofed 200');
  assert.equal(await isReady(port,'invalid'),false,'malformed grant cannot authenticate');
});

test('installed Native readiness fails closed when peer returns plain HTML without a proof',async t=>{
  const server=http.createServer((request,response)=>{
    response.writeHead(200,{'Content-Type':'text/html'});
    response.end('<title>Not OrdaX</title>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal(await isReady(server.address().port,'b'.repeat(64)),false);
});

test('signaled Native child fails startup immediately instead of waiting for readiness deadline',async t=>{
  // The child intentionally never binds the reserved port. On POSIX,
  // exitCode remains null while signalCode records SIGTERM.
  const root=mkdtempSync(join(tmpdir(),'ordax-native-early-exit-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const target=join(root,'tools','windows-emulator');
  mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'desktop-native-server.mjs'),
    'process.kill(process.pid, "SIGTERM");\n','utf8');
  const tokens=['a','b','c','d','e','f','1','2','3','4','5'].map(x=>x.repeat(64));
  const started=Date.now();
  await assert.rejects(startHost({
    root,template:root,stateDirectory:root,userData:root,log:()=>{},
    builtAssetsRoot:root,
    fileToken:tokens[0],localSessionToken:tokens[1],
    nativeSessionToken:tokens[2],diagnosticToken:tokens[3],
    deviceProfileToken:tokens[4],stateToken:tokens[5],
    networkToken:tokens[6],observationToken:tokens[7],
    displayToken:tokens[8],localAiToken:tokens[9],surfaceReportToken:tokens[10],
  }),/Canonical Native server exited before HTTP readiness: (SIGTERM|1|143)/);
  assert.ok(Date.now()-started<10000,'dead Native child must not burn 45-second startup deadline');
});

test('closing Electron during Native cold boot cancels its exact running child',async t=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-native-boot-cancel-'));
  const marker=join(root,'native-child.pid');
  // This isolated fixture launches one plain Node process, not PyInstaller.
  // Inject a test-only OS tree-stop adapter scoped to that exact process PID;
  // production never substitutes this mock for the OS-owned implementation.
  const adapter=join(root,'system','adapters','desktop');
  mkdirSync(adapter,{recursive:true});
  writeFileSync(join(adapter,'owned-process-tree.cjs'),
    "module.exports.stopOwnedWindowsProcessTree=pid=>{"+
    "try{process.kill(pid,'SIGTERM');return true}catch{return false}};\n");
  const target=join(root,'tools','windows-emulator');
  mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'desktop-native-server.mjs'),
    'import {writeFileSync} from "node:fs";\n'+
    'writeFileSync('+JSON.stringify(marker)+',String(process.pid));\n'+
    'setInterval(()=>{},1000);\n');
  let pid=null;
  const controller=new AbortController();
  t.after(()=>{
    controller.abort();
    if(pid){try{process.kill(pid,'SIGTERM');}catch{}}
    rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  const tokens=['a','b','c','d','e','f','1','2','3','4','5'].map(x=>x.repeat(64));
  const options={
    root,template:root,stateDirectory:root,userData:root,log:()=>{},
    builtAssetsRoot:root,signal:controller.signal,
    fileToken:tokens[0],localSessionToken:tokens[1],
    nativeSessionToken:tokens[2],diagnosticToken:tokens[3],
    deviceProfileToken:tokens[4],stateToken:tokens[5],
    networkToken:tokens[6],observationToken:tokens[7],
    displayToken:tokens[8],localAiToken:tokens[9],surfaceReportToken:tokens[10],
  };
  const pending=startHost(options);
  for(let i=0;i<60 && !pid;i++){
    if(require('node:fs').existsSync(marker))pid=Number(readFileSync(marker,'utf8'));
    if(!pid)await new Promise(resolve=>setTimeout(resolve,75));
  }
  assert.ok(Number.isInteger(pid)&&pid>0,'a real Native child must exist before cancellation');
  controller.abort();
  await assert.rejects(pending,/Desktop Native startup cancelled by shutdown/);
  let alive=true;
  for(let i=0;i<35;i++){
    try{process.kill(pid,0);}catch{alive=false;break;}
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  assert.equal(alive,false,'aborted cold boot must not leave a Native process alive');
});

test('already-aborted Desktop startup cannot spawn a Native process',async()=>{
  const controller=new AbortController();controller.abort();
  const tokens=['a','b','c','d','e','f','1','2','3','4','5'].map(x=>x.repeat(64));
  await assert.rejects(startHost({
    root:'missing',template:'missing',stateDirectory:'missing',userData:'missing',
    log:()=>{},signal:controller.signal,builtAssetsRoot:'missing',
    fileToken:tokens[0],localSessionToken:tokens[1],nativeSessionToken:tokens[2],
    diagnosticToken:tokens[3],deviceProfileToken:tokens[4],stateToken:tokens[5],
    networkToken:tokens[6],observationToken:tokens[7],displayToken:tokens[8],
    localAiToken:tokens[9],surfaceReportToken:tokens[10],
  }),/Desktop Native startup cancelled by shutdown/);
});

test('Native Surface reporter requires its own valid per-launch grant before starting a child',async()=>{
  const tokens=['a','b','c','d','e','f','1','2','3','4','5'].map(x=>x.repeat(64));
  const opts={root:'unused',template:'unused',stateDirectory:'unused',userData:'unused',log:()=>{},
    fileToken:tokens[0],localSessionToken:tokens[1],nativeSessionToken:tokens[2],
    diagnosticToken:tokens[3],deviceProfileToken:tokens[4],stateToken:tokens[5],
    networkToken:tokens[6],observationToken:tokens[7],
    displayToken:tokens[8],localAiToken:tokens[9],
  };
  await assert.rejects(startHost(opts),/independent per-launch tokens/);
  await assert.rejects(startHost({...opts,surfaceReportToken:tokens[0]}),
    /independent per-launch tokens/);
  await assert.rejects(startHost({...opts,surfaceReportToken:'invalid'}),
    /independent per-launch tokens/);
});

test('Native host child receives only its distinct per-launch Surface report grant',async t=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-native-surface-grant-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const target=join(root,'tools','windows-emulator');
  mkdirSync(target,{recursive:true});
  const observation=join(root,'grant-check.json');
  writeFileSync(join(target,'desktop-native-server.mjs'),
    'import {writeFileSync} from "node:fs";\n'+
    'const report=process.env.ORDAX_DESKTOP_SURFACE_REPORT_TOKEN;\n'+
    'writeFileSync('+JSON.stringify(observation)+', JSON.stringify({valid:/^[0-9a-f]{64}$/.test(report??""),distinct:report!==process.env.ORDAX_DESKTOP_FILE_TOKEN}));\n'+
    'process.exit(2);\n');
  const tokens=['a','b','c','d','e','f','1','2','3','4','5'].map(x=>x.repeat(64));
  await assert.rejects(startHost({
    root,template:root,stateDirectory:root,userData:root,log:()=>{},builtAssetsRoot:root,
    fileToken:tokens[0],localSessionToken:tokens[1],nativeSessionToken:tokens[2],
    diagnosticToken:tokens[3],deviceProfileToken:tokens[4],stateToken:tokens[5],
    networkToken:tokens[6],observationToken:tokens[7],
    displayToken:tokens[8],localAiToken:tokens[9],surfaceReportToken:tokens[10],
  }),/Canonical Native server exited before HTTP readiness: 2/);
  assert.deepEqual(JSON.parse(require('node:fs').readFileSync(observation,'utf8')),
    {valid:true,distinct:true});
});


test('Desktop shutdown waits for the OS-owned Native process tree before exit',t=>{
  if(process.platform!=='win32'){t.skip('Windows process-tree contract');return;}
  const root=mkdtempSync(join(tmpdir(),'ordax-native-owned-tree-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const adapter=join(root,'system','adapters','desktop');
  mkdirSync(adapter,{recursive:true});
  const receipt=join(root,'tree-stopped.txt');
  writeFileSync(join(adapter,'owned-process-tree.cjs'),
    "module.exports.stopOwnedWindowsProcessTree=(pid)=>{" +
    "require('node:fs').writeFileSync("+JSON.stringify(receipt)+",String(pid));"+
    "return true;};\n");
  const child={pid:28734,exitCode:null,signalCode:null,
    kill:()=>{throw Error('Must not fall back to SIGTERM')}};
  assert.equal(stopHost(child,root),true);
  assert.equal(require('node:fs').readFileSync(receipt,'utf8'),'28734');
});

test('Desktop shutdown never acts on an already-exited Native PID',()=>{
  const exited={pid:28735,exitCode:0,signalCode:null,
    kill:()=>{throw Error('Exited PID must not be reused')}};
  assert.equal(stopHost(exited,'C:\\Windows\\missing-template'),true);
});

test('Desktop shutdown retains the exact Native host when Windows tree policy is unavailable',()=>{
  let signals=0;
  const child={pid:28736,exitCode:null,signalCode:null,kill:()=>{signals++;}};
  assert.equal(stopHost(child,'C:\\Windows\\missing-template'),false);
  assert.equal(signals,0,'no bootloader-only SIGTERM may orphan the Product child');
});

test('Electron refuses to exit with an unconfirmed Native process tree and retries the same owner',()=>{
  const source=readFileSync(join(__dirname,'main.cjs'),'utf8');
  const start=source.indexOf("app.on('before-quit',");
  const end=source.indexOf("app.on('window-all-closed'",start);
  const beginShutdown=source.indexOf('function runDesktopShutdownStages(');
  assert.ok(beginShutdown>0 && start>beginShutdown && end>start);
  const shutdown=runInNewContext('('+source.slice(beginShutdown,start).trim()+')');
  for(const confirmed of [false,true]){
    const events=[],messages=[],timers=[],dialogs=[];
    let onBeforeQuit,logClosed=0,treeCalls=0;
    const requestQuit=()=>onBeforeQuit({preventDefault:()=>events.push('prevented')});
    const context={
      app:{on:(event,cb)=>{if(event==='before-quit')onBeforeQuit=cb},
        quit:requestQuit},
      quitting:false,shutdownReason:'unclassified',
      nativeShutdownRetryTimer:null,nativeShutdownRetryCount:0,
      nativeBootAbort:{abort:()=>{}},disarmNativeHostExit:null,
      initialUpdateTimer:null,updateTimer:null,activationTimer:null,
      browserHost:null,
      runtime:{child:{pid:28737},template:'verified'},
      stream:{end:()=>{logClosed++;}},
      stopHost:()=>{treeCalls++;return confirmed},
      log:message=>messages.push(message),
      setTimeout:(cb,delay)=>{assert.equal(delay,800);timers.push(cb);return {}},
      clearTimeout:()=>{},
      dialog:{showErrorBox:(title,body)=>dialogs.push({title,body})},
      runDesktopShutdownStages:(stages,report)=>shutdown(stages,report,{clock:()=>0}),
    };
    runInNewContext(source.slice(start,end),context);
    requestQuit();
    assert.equal(treeCalls,1,'one exact Native owner stop attempt');
    assert.deepEqual(events,confirmed?[]:['prevented']);
    assert.equal(context.quitting,confirmed);
    assert.equal(logClosed,confirmed?1:0);
    if(!confirmed){
      assert.notEqual(context.runtime,null,'unconfirmed child remains owned');
      assert.ok(messages.some(m=>m.includes('exit deferred')));
      assert.equal(timers.length,1);
      timers.shift()();timers.shift()();
      assert.equal(treeCalls,3,'two bounded retries use the same owner');
      assert.equal(events.length,3,'all failed stops block Electron exit');
      assert.equal(context.nativeShutdownRetryCount,2);
      assert.equal(timers.length,0,'no infinite retry loop');
      assert.equal(dialogs.length,1,'owner sees an explicit shutdown blocker');
      assert.equal(logClosed,0);
    }else{
      assert.equal(context.runtime,null);
      assert.equal(timers.length,0);
      assert.equal(dialogs.length,0);
    }
  }
});

test('Electron teardown still stops exact Native child when Chromium cleanup throws',()=>{
  const source=readFileSync(join(__dirname,'main.cjs'),'utf8');
  const begin=source.indexOf('function runDesktopShutdownStages(');
  const end=source.indexOf("\napp.on('before-quit'",begin);
  assert.ok(begin>0&&end>begin,'one Electron-owned shutdown sequence');
  const release=runInNewContext('('+source.slice(begin,end).trim()+')');
  const calls=[],messages=[];
  const result=release([
    ['abort-native-boot',()=>calls.push('abort')],
    ['dispose-browser',()=>{calls.push('browser');throw Error('Chromium detach refused');}],
    ['stop-native',()=>{calls.push('native');return false;}],
    ['close-log',()=>calls.push('log')],
  ],msg=>messages.push(msg),{clock:()=>0});
  assert.equal(result,false);
  assert.deepEqual(calls,['abort','browser','native','log'],
    'one teardown error must never skip the Native owner or log closure');
  assert.ok(messages.some(msg=>msg.includes('dispose-browser failed: Chromium detach refused')));
  assert.ok(messages.some(msg=>msg.includes('stop-native not confirmed')));
  assert.match(source,/\['dispose-browser',\(\)=>\{browserHost\?\.dispose\(\);browserHost=null;\}\]/);
  assert.match(source,/\['stop-native',\(\)=>\{[\s\S]*?stopHost\(runtime\.child,runtime\.template\)/,
    'shutdown retains the exact Native host PID and canonical OS stop policy');
});

test('Electron shutdown records the slow native stage and isolates a failed diagnostic logger',()=>{
  const source=readFileSync(join(__dirname,'main.cjs'),'utf8');
  const begin=source.indexOf('function runDesktopShutdownStages(');
  const end=source.indexOf("\napp.on('before-quit'",begin);
  const release=runInNewContext('('+source.slice(begin,end).trim()+')');
  const stages=[],messages=[];
  let tick=0;
  const result=release([
    ['native',()=>{stages.push('native');tick+=670;return true;}],
    ['stream',()=>stages.push('stream')],
  ],message=>messages.push(message),{clock:()=>tick,slowMs:500});
  assert.equal(result,true);
  assert.deepEqual(stages,['native','stream']);
  assert.deepEqual(messages,['Desktop shutdown stage native took 670ms']);
  assert.doesNotThrow(()=>release([
    ['browser',()=>{throw Error('browser denied');}],
    ['native',()=>stages.push('native-after-log-failure')],
  ],()=>{throw Error('logger closed');},{clock:()=>0}));
  assert.equal(stages.at(-1),'native-after-log-failure',
    'logging failure cannot disable shutdown stage isolation');
});
