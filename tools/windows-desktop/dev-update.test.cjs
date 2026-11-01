'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, symlinkSync, lstatSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { OFFICIAL_REMOTE } = require('./runtime.cjs');
const { compiledBundleSha256 } = require('./native-build.cjs');
const { git } = require('./checkout.cjs');
const { readState, writeState, validateState, versionRoot, stageMain,
  chooseBootVersion, confirmHealthy, pinPrevious, unpin, shouldAutoActivate, desktopFirstRunComplete, createDesktopIdleActivation, createDesktopWindowIdleTracker,
  sweepStaleCandidates, removeOwnedCandidate, prepareWindowsGitDeletion } = require('./dev-update.cjs');

test('Desktop DEV Git sparse checkout includes the existing MCP candidate proof',()=>{
  const source=readFileSync(join(__dirname,'dev-update.cjs'),'utf8');
  assert.match(source,/'sparse-checkout','set',\s*'system','docs\/contracts','docs\/evidence','tools\/windows-emulator'/);
  const evidence=JSON.parse(readFileSync(join(__dirname,
    '../../docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json'),'utf8'));
  assert.equal(evidence.$schema,'ordax.desktop-runtime-candidate-evidence/1');
  assert.equal(evidence.candidate.platform,'windows-amd64');
  assert.equal(evidence.candidate.signature_present,false);
  // Bind to the current official OS evidence, not a superseded candidate hash.
  assert.match(evidence.candidate.sha256,/^[a-f0-9]{64}$/);
  assert.match(evidence.candidate.source_commit,/^[a-f0-9]{40}$/);
  assert.equal(evidence.candidate.sha256,evidence.physical_offline_proof.executable_sha256);
  assert.equal(evidence.candidate.source_commit,evidence.physical_offline_proof.source_commit);
  assert.equal(evidence.physical_offline_proof.passed,true);
  assert.equal(evidence.candidate.stable_activation_authorized,false);
});

test('Electron connects ordax-pull staging to automatic, health-gated idle activation',()=>{
  const source=readFileSync(join(__dirname,'main.cjs'),'utf8');
  assert.match(source,/const result=await stageMain\(\{userData,template,log\}\)/);
  assert.match(source,/idleActivation=createDesktopIdleActivation\(\{/);
  assert.match(source,/activationTimer=setInterval\(\(\)=>\{void idleActivation\?\.\(\);\},5\*1000\)/);
  assert.match(source,/allowPendingTrial:await desktopFirstRunComplete\(userData,template\)/);
  assert.match(source,/if\(!await desktopFirstRunComplete\(userData,template\)\)return;/);
  assert.match(source,/powerMonitor\.getSystemIdleTime\(\)/);
  assert.match(source,/getIdleSnapshot:\(\)=>windowIdle\.snapshot\(\{/);
  assert.match(source,/windowMinimized:window\.isMinimized\(\)/);
  assert.match(source,/window\.on\('minimize',windowIdle\.onBackground\)/);
  assert.match(source,/window\.on\('focus',windowIdle\.onAttention\)/);
  assert.match(source,/app\.relaunch\(\);\s*app\.quit\(\)/);
  assert.match(source,/isReady:\(\)=>!devProfile && !staging/);
  assert.match(source,/!browserHost\.hasActiveWork\(\)/);
  assert.match(source,/!window\.webContents\.isCurrentlyAudible\?\.\(\)/);
  assert.match(source,/runtime\.child\.signalCode===null/);
  assert.match(source,/if\(selected\.trial\) \{\s*confirmHealthy\(userData,selected\.sha\)/);
  assert.match(source,/rejectCandidate\(userData,selected\.sha\)/);
});

test('minimized OrdaX updates after 60s of its OWN inattention despite Windows idle being zero',()=>{
  let ms=1000;
  const tracker=createDesktopWindowIdleTracker({now:()=>ms});
  const state={pendingSha:'a'.repeat(40),attemptedSha:null,pinnedSha:null};
  const sample=()=>tracker.snapshot({windowVisible:true,windowFocused:false,
    windowMinimized:true,systemIdleSeconds:0});
  tracker.onBackground();
  ms+=59000;
  const before=sample();
  assert.deepEqual(before,{windowVisible:false,windowFocused:false,idleSeconds:59});
  assert.equal(shouldAutoActivate(state,before),false);
  ms+=1000;
  assert.equal(shouldAutoActivate(state,sample()),true);
});

test('background OrdaX measures its own focus loss without requiring global PC idle',()=>{
  let ms=0;
  const tracker=createDesktopWindowIdleTracker({now:()=>ms});
  const state={pendingSha:'a'.repeat(40),attemptedSha:null,pinnedSha:null};
  tracker.onBackground();
  ms=119000;
  assert.equal(shouldAutoActivate(state,tracker.snapshot({windowVisible:true,
    windowFocused:false,windowMinimized:false,systemIdleSeconds:0})),false);
  ms=120000;
  assert.equal(shouldAutoActivate(state,tracker.snapshot({windowVisible:true,
    windowFocused:false,windowMinimized:false,systemIdleSeconds:0})),true);
  tracker.onAttention(); // a user returned, so the timer must reset.
  assert.equal(shouldAutoActivate(state,tracker.snapshot({windowVisible:true,
    windowFocused:true,windowMinimized:false,systemIdleSeconds:0})),false);
  ms=350000;
  tracker.onBackground();
  ms=410000;
  assert.equal(shouldAutoActivate(state,tracker.snapshot({windowVisible:true,
    windowFocused:false,windowMinimized:false,systemIdleSeconds:0})),false);
});

test('focused OrdaX still requires REAL system idle; changing visibility never instantly relaunches',()=>{
  let ms=1000;
  const tracker=createDesktopWindowIdleTracker({now:()=>ms});
  const state={pendingSha:'a'.repeat(40),attemptedSha:null,pinnedSha:null};
  const focused=idleSeconds=>tracker.snapshot({
    windowVisible:true,windowFocused:true,windowMinimized:false,systemIdleSeconds:idleSeconds,
  });
  assert.equal(shouldAutoActivate(state,focused(0)),false);
  ms=3_601_000; // elapsed wall-clock time alone never makes a focused UI idle.
  assert.equal(shouldAutoActivate(state,focused(0)),false);
  assert.equal(shouldAutoActivate(state,focused(599)),false);
  assert.equal(shouldAutoActivate(state,focused(600)),true);
  tracker.onBackground();
  ms+=1000;
  assert.equal(shouldAutoActivate(state,tracker.snapshot({
    windowVisible:false,windowFocused:false,windowMinimized:true,systemIdleSeconds:600,
  })),false,'minimization resets own dwell instead of using previous PC idle');
});

test('window changes during async OOBE validation cancel an otherwise ready activation',async()=>{
  let ms=0;
  const tracker=createDesktopWindowIdleTracker({now:()=>ms});
  tracker.onBackground();
  ms=61000;
  let complete,launches=0;
  const activate=createDesktopIdleActivation({
    userData:'test-profile',template:'test-template',
    read:()=>({pendingSha:'a'.repeat(40),attemptedSha:null,pinnedSha:null}),
    isReady:()=>true,
    getIdleSnapshot:()=>tracker.snapshot({
      windowVisible:true,windowFocused:false,windowMinimized:true,systemIdleSeconds:0,
    }),
    firstRunComplete:()=>new Promise(resolve=>{complete=resolve}),
    relaunch:()=>{launches++},
  });
  const pending=activate();
  tracker.onAttention();
  ms+=1000;
  complete(true);
  assert.equal(await pending,false);
  assert.equal(launches,0);
});

test('ordax-pull serializes idle activation across concurrent timers',async()=>{
  let resolveReceipt;
  const ready={value:true};
  let state={pendingSha:'a'.repeat(40),attemptedSha:null,pinnedSha:null};
  let launches=0, reads=0;
  const activate=createDesktopIdleActivation({
    userData:'test-profile',template:'test-template',
    read:()=>{reads++;return {...state}},
    isReady:()=>ready.value,
    getIdleSnapshot:()=>({idleSeconds:900,windowVisible:false,windowFocused:false}),
    firstRunComplete:()=>new Promise(resolve=>{resolveReceipt=resolve}),
    relaunch:()=>{launches++},
  });
  const first=activate();
  assert.equal(await activate(),false,'only one asynchronous OOBE read at a time');
  resolveReceipt(true);
  assert.equal(await first,true);
  assert.equal(launches,1);
  assert.equal(reads,2,'candidate is rechecked immediately before relaunch');
  assert.equal(await activate(),false,'a requested relaunch may not be duplicated');
});

test('ordax-pull aborts relaunch when pending SHA or rollback pin changes during OOBE read',async()=>{
  for(const mutate of [
    state=>({...state,pendingSha:'b'.repeat(40)}),
    state=>({...state,pinnedSha:'a'.repeat(40)}),
    state=>({...state,pendingSha:null}),
  ]){
    let state={pendingSha:'a'.repeat(40),attemptedSha:null,pinnedSha:null};
    let finish,launches=0;
    const activate=createDesktopIdleActivation({
      userData:'test-profile',template:'test-template',
      read:()=>({...state}),
      isReady:()=>true,
      getIdleSnapshot:()=>({idleSeconds:900,windowVisible:false,windowFocused:false}),
      firstRunComplete:()=>new Promise(resolve=>{finish=resolve}),
      relaunch:()=>{launches++},
    });
    const pending=activate();
    state=mutate(state);
    finish(true);
    assert.equal(await pending,false);
    assert.equal(launches,0,'stale state cannot trigger an Electron relaunch');
  }
});

test('ordax-pull rechecks user activity and runtime readiness before relaunch',async()=>{
  for(const change of ['activity','host-not-ready']){
    let finish,launches=0,idle=900,ready=true;
    const activate=createDesktopIdleActivation({
      userData:'test-profile',template:'test-template',
      read:()=>({pendingSha:'a'.repeat(40),attemptedSha:null,pinnedSha:null}),
      isReady:()=>ready,
      getIdleSnapshot:()=>({idleSeconds:idle,windowVisible:false,windowFocused:false}),
      firstRunComplete:()=>new Promise(resolve=>{finish=resolve}),
      relaunch:()=>{launches++},
    });
    const pending=activate();
    if(change==='activity')idle=0;else ready=false;
    finish(true);
    assert.equal(await pending,false);
    assert.equal(launches,0);
  }
});

test('ordax-pull retries after failed Electron relaunch but not after success',async()=>{
  let attempt=0;
  const errors=[];
  const activate=createDesktopIdleActivation({
    userData:'test-profile',template:'test-template',
    read:()=>({pendingSha:'a'.repeat(40),attemptedSha:null,pinnedSha:null}),
    isReady:()=>true,
    getIdleSnapshot:()=>({idleSeconds:900,windowVisible:false,windowFocused:false}),
    firstRunComplete:async()=>true,
    log:line=>errors.push(line),
    relaunch:()=>{attempt++;if(attempt===1)throw Error('relaunch rejected')},
  });
  assert.equal(await activate(),false);
  assert.equal(await activate(),true);
  assert.equal(await activate(),false);
  assert.equal(attempt,2);
  assert.ok(errors.some(line=>line.includes('activation deferred')));
});

test('ordax-pull Desktop activates only verified pending Git revisions during safe inactivity',()=>{
  const sha='a'.repeat(40);
  const state={pendingSha:sha,attemptedSha:null,pinnedSha:null};
  const ui={windowVisible:true,windowFocused:true};
  assert.equal(shouldAutoActivate(state,{...ui,idleSeconds:599}),false,
    'focused Desktop cannot be interrupted before prolonged inactivity');
  assert.equal(shouldAutoActivate(state,{...ui,idleSeconds:600}),true);
  assert.equal(shouldAutoActivate(state,{windowVisible:true,windowFocused:false,idleSeconds:119}),false);
  assert.equal(shouldAutoActivate(state,{windowVisible:true,windowFocused:false,idleSeconds:120}),true);
  assert.equal(shouldAutoActivate(state,{windowVisible:false,windowFocused:false,idleSeconds:59}),false);
  assert.equal(shouldAutoActivate(state,{windowVisible:false,windowFocused:false,idleSeconds:60}),true);
  for(const invalid of [{...state,pendingSha:null},{...state,pendingSha:'bad'},
      {...state,attemptedSha:sha},{...state,pinnedSha:'b'.repeat(40)}]){
    assert.equal(shouldAutoActivate(invalid,{...ui,idleSeconds:9999}),false);
  }
  for(const idleSeconds of [NaN,Infinity,-1,undefined]){
    assert.equal(shouldAutoActivate(state,{...ui,idleSeconds}),false);
  }
});

test('ordax-pull checks canonical Native First Run receipt before auto update',async t=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-first-run-update-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const template=join(__dirname,'../..');
  const dir=join(root,'native-state');
  mkdirSync(dir);
  const file=join(dir,'native-state.json');
  assert.equal(await desktopFirstRunComplete(root,template),false);
  const firstRun={
    schema:'ordax.first-run-state/1',
    completed:false,locale:'pt-BR',timeZone:'America/Bahia',accountMode:null,
  };
  writeFileSync(file,JSON.stringify({firstRun}));
  assert.equal(await desktopFirstRunComplete(root,template),false);
  writeFileSync(file,'{invalid JSON');
  assert.equal(await desktopFirstRunComplete(root,template),false);
  writeFileSync(file,JSON.stringify({firstRun:{...firstRun,completed:true}}));
  assert.equal(await desktopFirstRunComplete(root,template),false,
    'flag alone is not a valid completion receipt');
  writeFileSync(file,JSON.stringify({firstRun:{...firstRun,completed:true,accountMode:'local-only'}}));
  assert.equal(await desktopFirstRunComplete(root,template),true);
  assert.equal(await desktopFirstRunComplete(root,join(root,'old-runtime-template')),false,
    'an older runtime without the validator must preserve offline boot and defer updates');
});

function gitCli(args,cwd) {
  const result=spawnSync('git',args,{cwd,encoding:'utf8',windowsHide:true,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
  if(result.status!==0)throw Error('fixture git failed: '+args.join(' ')+' '+result.stderr);
  return result.stdout.trim();
}
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'ordax-desktop-git-proof-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=join(root,'official-main-fixture');
  const userData=join(root,'userdata');
  const template=join(root,'template');
  mkdirSync(source,{recursive:true});mkdirSync(userData);mkdirSync(join(template,'node_modules'),{recursive:true});
  gitCli(['init','-q','-b','main'],source);
  gitCli(['config','user.email','desktop-test@ordax.example'],source);
  gitCli(['config','user.name','Desktop Fixture'],source);
  gitCli(['remote','add','origin',OFFICIAL_REMOTE],source);
  const composition=join(source,'system','composition','native');
  const emulator=join(source,'tools','windows-emulator');
  const web=join(source,'tools','surface-web');
  mkdirSync(composition,{recursive:true});
  mkdirSync(emulator,{recursive:true});
  mkdirSync(web,{recursive:true});
  writeFileSync(join(composition,'index.html'),'<!doctype html><title>OrdaX Native</title>');
  writeFileSync(join(emulator,'dev-supervisor.mjs'),'// canonical supervisor fixture');
  writeFileSync(join(emulator,'vite.config.mjs'),'// canonical vite fixture');
  writeFileSync(join(web,'README.md'),'fixture');
  writeFileSync(join(emulator,'desktop-host-contract.json'),JSON.stringify({
    schema:1,desktopHost:{contractVersion:1,
      nativeSource:'system/composition/native/index.html',
      capabilities:['no-external-browser','dynamic-loopback-port','external-state-directory']}
  }));
  // A Dev candidate source must carry its own OS-authoritative pinned visual
  // lock, rather than silently treating a missing external Surface as valid.
  mkdirSync(join(source,'docs','contracts'),{recursive:true});
  const surfaceLock={$schema:'prototype-ordax.surface-source/1',status:'canonical',
    source_repository:'ordaxsystems/ordax-surface',source_commit:'a'.repeat(40),
    visual_source_paths:['system/surface/ui','system/surface/workspace']};
  writeFileSync(join(source,'docs','contracts','surface-source.json'),JSON.stringify(surfaceLock));
  writeFileSync(join(source,'.gitignore'),'node_modules/\nout/\n');
  gitCli(['add','.'],source);
  gitCli(['commit','-qm','first canonical Native source'],source);
  const first=gitCli(['rev-parse','HEAD'],source);
  function advance(){
    writeFileSync(join(composition,'index.html'),'<!doctype html><title>OrdaX Native Updated</title>');
    gitCli(['add','.'],source);gitCli(['commit','-qm','verified second Native source'],source);
    return gitCli(['rev-parse','HEAD'],source);
  }
  // GitHub is never reached; only the network boundary is replaced with an
  // isolated genuine Git repository. The stored Git origin is still official.
  async function offlineGit(args,cwd,timeout) {
    if(args[0]==='ls-remote')return {ok:true,stdout:gitCli(['rev-parse','HEAD'],source)+'\trefs/heads/main'};
    if(args.includes('clone')){
      assert.ok(args.includes('core.longpaths=true'),'Git must support the canonical long OS paths');
      assert.ok(args.includes('core.autocrlf=false'),'Git must preserve source blob line endings');
      const target=args.at(-1);
      gitCli(['clone','--quiet','--no-hardlinks',source,target],root);
      gitCli(['-C',target,'remote','set-url','origin',OFFICIAL_REMOTE],root);
      return {ok:true,stdout:''};
    }
    return git(args,cwd,timeout);
  }
  async function offlineBuild(staging) {
    const bundle = join(staging,'out','windows-desktop-native');
    mkdirSync(join(bundle,'system','composition','native'),{recursive:true});
    mkdirSync(join(bundle,'assets'),{recursive:true});
    writeFileSync(join(bundle,'system','composition','native','index.html'),
      '<!doctype html><script type="module" src="/__ordax/desktop-assets/assets/index-123.js"></script>');
    writeFileSync(join(bundle,'assets','index-123.js'),'export const healthy = true;');
    const lock=JSON.parse(readFileSync(join(staging,'docs','contracts','surface-source.json'),'utf8'));
    writeFileSync(join(bundle,'surface-source-receipt.json'),JSON.stringify({
      schema:'ordax.surface-source-materialization/1',
      source_repository:lock.source_repository,source_commit:lock.source_commit,
      visual_source_sha256:'b'.repeat(64),file_count:2,
      bundle_sha256:compiledBundleSha256(staging)
    }));
  }
  return {root,source,userData,template,first,advance,offlineGit,offlineBuild};
}


function installVerifiedBundledFixture(f,sha) {
  const lockPath=join(f.template,'docs','contracts','surface-source.json');
  mkdirSync(join(f.template,'docs','contracts'),{recursive:true});
  writeFileSync(lockPath,readFileSync(join(f.source,'docs','contracts','surface-source.json')));
  const assets=join(f.template,'desktop-assets');
  mkdirSync(join(assets,'system','composition','native'),{recursive:true});
  mkdirSync(join(assets,'assets'),{recursive:true});
  writeFileSync(join(assets,'system','composition','native','index.html'),
    '<!doctype html><script src="/assets/app.js"></script>');
  writeFileSync(join(assets,'assets','app.js'),'export const installed=true;');
  writeFileSync(join(assets,'source-provenance.json'),JSON.stringify({
    schema:'ordax.desktop-native-bundle-provenance/1',os_sha:sha,
    source_repository:'ordaxsystems/ordax-surface',source_commit:'a'.repeat(40),
    visual_source_sha256:'b'.repeat(64),file_count:2,
    bundle_sha256:compiledBundleSha256(f.template,assets)
  }));
  return assets;
}

test('verified bundled main is current without staging, recompilation or a false health trial',async t=>{
  const f=fixture(t);
  installVerifiedBundledFixture(f,f.first);
  let cloneCalls=0,buildCalls=0;
  const monitorGit=async(...args)=>{
    if(args[0].includes('clone')) cloneCalls++;
    return f.offlineGit(...args);
  };
  const params={userData:f.userData,template:f.template,runGit:monitorGit,
    buildCandidate:async()=>{buildCalls++;throw Error('must not compile bundled main')}};
  const status=await stageMain(params);
  assert.deepEqual(status,{status:'current',sha:f.first,source:'verified-bundled'});
  assert.equal(cloneCalls,0);
  assert.equal(buildCalls,0);
  assert.equal(readState(f.userData).activeSha,null,
    'bundled snapshot must not masquerade as an activated Git transaction');
  assert.equal(existsSync(join(f.userData,'runtime-versions')),false);
  const boot=await chooseBootVersion({userData:f.userData,template:f.template});
  assert.equal(boot.root,f.template);
  assert.equal(boot.trial,false);
  // New upstream source must still stage normally; no permanent pin is added.
  const second=f.advance();
  const stage=await stageMain({...params,buildCandidate:f.offlineBuild});
  assert.equal(stage.status,'staged');
  assert.equal(stage.sha,second);
  assert.equal(cloneCalls,1);
});

test('stale incompatible marker can be retired only by exact verified bundled main',async t=>{
  const f=fixture(t);
  const assets=installVerifiedBundledFixture(f,f.first);
  writeState(f.userData,{...readState(f.userData),incompatibleSha:f.first});
  const result=await stageMain({userData:f.userData,template:f.template,
    runGit:f.offlineGit,buildCandidate:f.offlineBuild});
  assert.equal(result.status,'current');
  assert.equal(readState(f.userData).incompatibleSha,null);
  // A previously incompatible *different* official SHA is also superseded
  // when the current upstream main exactly matches the verified installed OS.
  writeState(f.userData,{...readState(f.userData),incompatibleSha:'e'.repeat(40)});
  const restored=await stageMain({userData:f.userData,template:f.template,
    runGit:f.offlineGit,buildCandidate:f.offlineBuild});
  assert.equal(restored.status,'current');
  assert.equal(readState(f.userData).incompatibleSha,null);
  // A modified installed binary cannot use the bundled-source fast path.
  writeFileSync(join(assets,'assets','app.js'),'export const installed=false;');
  const stage=await stageMain({userData:f.userData,template:f.template,
    runGit:f.offlineGit,buildCandidate:f.offlineBuild});
  assert.equal(stage.status,'staged');
  assert.equal(readState(f.userData).activeSha,null);
});

test('update state is durable, validated and never silently resets corruption', t=>{
  const f=fixture(t);
  const original=readState(f.userData);
  assert.equal(original.activeSha,null);
  writeState(f.userData,{...original,pendingSha:f.first});
  assert.equal(readState(f.userData).pendingSha,f.first);
  assert.throws(()=>validateState({...original,pendingSha:'../../other'}),/Untrusted/);
  writeFileSync(join(f.userData,'desktop-dev-update-state.json'),'{"bad":true}');
  assert.throws(()=>readState(f.userData),/Untrusted/);
  assert.match(readFileSync(join(f.userData,'desktop-dev-update-state.json'),'utf8'),/bad/);
});

test('real Git candidate is isolated, boot-trialled and committed only after health',async t=>{
  const f=fixture(t);
  const first=await stageMain({userData:f.userData,template:f.template,runGit:f.offlineGit,buildCandidate:f.offlineBuild});
  assert.equal(first.status,'staged');
  assert.equal(first.sha,f.first);
  assert.ok(existsSync(versionRoot(f.userData,f.first)));
  assert.equal(readState(f.userData).activeSha,null);
  const boot=await chooseBootVersion({userData:f.userData,template:f.template});
  assert.equal(boot.trial,true);
  assert.equal(boot.sha,f.first);
  assert.equal(readState(f.userData).attemptedSha,f.first);
  assert.throws(()=>confirmHealthy(f.userData,'f'.repeat(40)),/health/);
  const healthy=confirmHealthy(f.userData,f.first);
  assert.equal(healthy.activeSha,f.first);
  assert.equal(healthy.pendingSha,null);
  const restart=await chooseBootVersion({userData:f.userData,template:f.template});
  assert.equal(restart.root,versionRoot(f.userData,f.first));
  assert.equal(restart.trial,false);
});

test('unconfirmed candidate is rejected on next start, without deleting previous runtime',async t=>{
  const f=fixture(t);
  await stageMain({userData:f.userData,template:f.template,runGit:f.offlineGit,buildCandidate:f.offlineBuild});
  await chooseBootVersion({userData:f.userData,template:f.template});
  const restart=await chooseBootVersion({userData:f.userData,template:f.template});
  assert.equal(restart.root,f.template);
  assert.equal(readState(f.userData).rejectedSha,f.first);
  assert.equal(readState(f.userData).pendingSha,null);
  assert.ok(existsSync(versionRoot(f.userData,f.first)));
  assert.equal((await stageMain({userData:f.userData,template:f.template,runGit:f.offlineGit,buildCandidate:f.offlineBuild})).status,'rejected');
});

test('second fast-forward stages separately; explicit rollback pins previous commit',async t=>{
  const f=fixture(t);
  await stageMain({userData:f.userData,template:f.template,runGit:f.offlineGit,buildCandidate:f.offlineBuild});
  await chooseBootVersion({userData:f.userData,template:f.template});
  confirmHealthy(f.userData,f.first);
  const second=f.advance();
  const staged=await stageMain({userData:f.userData,template:f.template,runGit:f.offlineGit,buildCandidate:f.offlineBuild});
  assert.equal(staged.status,'staged');
  assert.equal(staged.sha,second);
  assert.ok(existsSync(versionRoot(f.userData,f.first)));
  assert.ok(existsSync(versionRoot(f.userData,second)));
  await chooseBootVersion({userData:f.userData,template:f.template});
  confirmHealthy(f.userData,second);
  const rolled=await pinPrevious(f.userData,f.template);
  assert.equal(rolled.activeSha,f.first);
  assert.equal(rolled.previousSha,second);
  assert.equal(rolled.pinnedSha,f.first);
  assert.equal((await stageMain({userData:f.userData,template:f.template,runGit:f.offlineGit,buildCandidate:f.offlineBuild})).status,'pinned');
  assert.equal((await chooseBootVersion({userData:f.userData,template:f.template})).sha,f.first);
  assert.equal(unpin(f.userData).pinnedSha,null);
});

test('first-run OOBE holds a verified pending version without rejecting or activating it',async t=>{
  const f=fixture(t);
  assert.equal((await stageMain({userData:f.userData,template:f.template,
    runGit:f.offlineGit,buildCandidate:f.offlineBuild})).status,'staged');
  const pending=readState(f.userData).pendingSha;
  const held=await chooseBootVersion({userData:f.userData,template:f.template,
    allowPendingTrial:false});
  assert.equal(held.trial,false);
  assert.equal(readState(f.userData).pendingSha,pending);
  assert.equal(readState(f.userData).attemptedSha,null);
  assert.equal(readState(f.userData).rejectedSha,null);
  const selected=await chooseBootVersion({userData:f.userData,template:f.template,
    allowPendingTrial:true});
  assert.equal(selected.trial,true);
  assert.equal(selected.sha,pending);
  confirmHealthy(f.userData,pending);
  assert.equal(readState(f.userData).activeSha,pending);
});

test('diverged, dirty or untrusted versions cannot be activated',async t=>{
  const f=fixture(t);
  await stageMain({userData:f.userData,template:f.template,runGit:f.offlineGit,buildCandidate:f.offlineBuild});
  await chooseBootVersion({userData:f.userData,template:f.template});
  confirmHealthy(f.userData,f.first);
  const second=f.advance();
  const stage=await stageMain({userData:f.userData,template:f.template,runGit:f.offlineGit,buildCandidate:f.offlineBuild});
  assert.equal(stage.status,'staged');
  // A locally modified tracked file is not an acceptable candidate.
  const file=join(versionRoot(f.userData,second),'system','composition','native','index.html');
  writeFileSync(file,'unauthorized changed runtime');
  const boot=await chooseBootVersion({userData:f.userData,template:f.template});
  assert.equal(boot.trial,false);
  assert.equal(boot.sha,f.first);
  assert.equal(readState(f.userData).rejectedSha,second);
});

test('incompatible official main SHA does not leak candidates or clone indefinitely', async t=>{
  const f=fixture(t);
  const contract=join(f.source,'tools','windows-emulator','desktop-host-contract.json');
  rmSync(contract);
  gitCli(['add','-u'],f.source);
  gitCli(['commit','-qm','upstream source without Desktop Host contract'],f.source);
  const incompatible=gitCli(['rev-parse','HEAD'],f.source);
  let clones=0;
  const trackGit=async (...args)=>{
    if(args[0].includes('clone'))clones++;
    return f.offlineGit(...args);
  };
  const params={userData:f.userData,template:f.template,runGit:trackGit,buildCandidate:f.offlineBuild};
  assert.equal((await stageMain(params)).status,'incompatible');
  assert.equal(readState(f.userData).incompatibleSha,incompatible);
  assert.deepEqual(readdirSync(join(f.userData,'runtime-versions')),[]);
  assert.equal((await stageMain(params)).status,'incompatible');
  assert.equal(clones,1,'same incompatible SHA must not clone again');
  assert.equal(readState(f.userData).pendingSha,null);
  f.advance();
  assert.equal((await stageMain(params)).status,'incompatible');
  assert.equal(clones,2,'a new official SHA is evaluated once');
  assert.deepEqual(readdirSync(join(f.userData,'runtime-versions')),[]);
  writeFileSync(contract,JSON.stringify({schema:1,desktopHost:{contractVersion:1,
    nativeSource:'system/composition/native/index.html',capabilities:[
      'no-external-browser','dynamic-loopback-port','external-state-directory']}}));
  gitCli(['add','.'],f.source);
  gitCli(['commit','-qm','upstream adds Desktop Host contract'],f.source);
  assert.equal((await stageMain(params)).status,'staged');
  assert.equal(readState(f.userData).incompatibleSha,null);
  assert.equal(clones,3);
});

test('legacy update state without incompatibleSha remains readable',t=>{
  const f=fixture(t);
  const legacy={...readState(f.userData)};
  delete legacy.incompatibleSha;
  writeFileSync(join(f.userData,'desktop-dev-update-state.json'),JSON.stringify(legacy));
  assert.equal(readState(f.userData).incompatibleSha,null);
  assert.throws(()=>validateState({...legacy,incompatibleSha:'invalid'}),/Untrusted/);
});

test('Windows busy Git candidate is deferred without suppressing incompatible SHA verdict',async t=>{
  const f=fixture(t);
  const contract=join(f.source,'tools','windows-emulator','desktop-host-contract.json');
  rmSync(contract);
  gitCli(['add','-u'],f.source);
  gitCli(['commit','-qm','no Desktop Host contract'],f.source);
  const expected=gitCli(['rev-parse','HEAD'],f.source);
  let clones=0;const log=[];
  const runGit=async (...args)=>{if(args[0].includes('clone'))clones++;return f.offlineGit(...args)};
  const result=await stageMain({userData:f.userData,template:f.template,runGit,
    buildCandidate:f.offlineBuild,log:m=>log.push(m),
    cleanupCandidate:()=>({removed:false,code:'EPERM'})});
  assert.equal(result.status,'incompatible');
  assert.equal(readState(f.userData).incompatibleSha,expected);
  assert.equal(clones,1);
  assert.equal(readdirSync(join(f.userData,'runtime-versions')).length,1);
  assert.ok(log.some(m=>m.includes('Deferred Desktop Git candidate cleanup')));
  assert.equal((await stageMain({userData:f.userData,template:f.template,runGit,
    buildCandidate:f.offlineBuild})).status,'incompatible');
  assert.equal(clones,1,'no repeated clone after a transient cleanup failure');
  const sweep=sweepStaleCandidates(f.userData,{now:Date.now()+180000});
  assert.equal(sweep.removed,1);
  assert.equal(sweep.deferred,0);
  assert.deepEqual(readdirSync(join(f.userData,'runtime-versions')),[]);
});

test('orphan maintenance never deletes noncandidate, fresh candidate, or verified SHA',t=>{
  const f=fixture(t);
  const versions=join(f.userData,'runtime-versions');
  mkdirSync(versions,{recursive:true});
  const orphan=join(versions,'.candidate-'+'f'.repeat(8)+'-'+ 'a'.repeat(4)+'-'+ 'b'.repeat(4)+'-'+ 'c'.repeat(4)+'-'+ 'd'.repeat(12));
  const other=join(versions,'custom-user-data');
  const sha=join(versions,'e'.repeat(40));
  for(const item of [orphan,other,sha]){mkdirSync(item);writeFileSync(join(item,'keep'),'data')}
  assert.deepEqual(sweepStaleCandidates(f.userData,{now:Date.now(),minAgeMs:180000}),{removed:0,deferred:0});
  const result=sweepStaleCandidates(f.userData,{now:Date.now()+200000,minAgeMs:180000});
  assert.equal(result.removed,1);
  assert.equal(existsSync(orphan),false);
  assert.equal(existsSync(other),true);
  assert.equal(existsSync(sha),true);
  assert.throws(()=>removeOwnedCandidate(sha),/Unsafe/);
});

test('hidden Windows Git folder is removable from owned candidate directory',t=>{
  if(process.platform!=='win32')return t.skip('Windows-specific Git hidden attribute');
  const f=fixture(t);
  const {execFileSync}=require('node:child_process');
  const candidate=join(f.userData,'runtime-versions','.candidate-'+
    '12ab34cd-1234-1234-1234-123456789abc');
  const gitDirectory=join(candidate,'.git');
  mkdirSync(gitDirectory,{recursive:true});
  writeFileSync(join(gitDirectory,'HEAD'),'ref: refs/heads/main');
  execFileSync('attrib.exe',['+H',gitDirectory],{windowsHide:true});
  const cleanup=removeOwnedCandidate(candidate);
  assert.equal(cleanup.removed,true);
  assert.equal(existsSync(candidate),false);
});
test('Windows read-only Git pack and commit graph are removable from owned candidate',t=>{
  if(process.platform!=='win32')return t.skip('Windows-only Git readonly objects');
  const f=fixture(t);
  const {execFileSync}=require('node:child_process');
  const candidate=join(f.userData,'runtime-versions',
    '.candidate-67ab1234-1234-1234-1234-123456789abc');
  const gitDirectory=join(candidate,'.git');
  const pack=join(gitDirectory,'objects','pack','pack-fixture.pack');
  const graph=join(gitDirectory,'objects','info','commit-graphs','graph-fixture.graph');
  mkdirSync(join(gitDirectory,'objects','pack'),{recursive:true});
  mkdirSync(join(gitDirectory,'objects','info','commit-graphs'),{recursive:true});
  for(const file of [pack,graph]) {
    writeFileSync(file,'fixture Git readonly content');
    execFileSync('attrib.exe',['+R',file],{windowsHide:true});
  }
  execFileSync('attrib.exe',['+H',gitDirectory],{windowsHide:true});
  try {
    for(const file of [pack,graph]) {
      assert.equal(statSync(file).mode & 0o200,0,
        'Git fixture must be read-only before normalization');
    }
    prepareWindowsGitDeletion(gitDirectory);
    for(const file of [pack,graph]) {
      assert.notEqual(statSync(file).mode & 0o200,0,
        'Git metadata must be writable before recursive removal');
    }
    assert.equal(removeOwnedCandidate(candidate).removed,true,
      'owned Windows candidate must clear Git readonly objects before removal');
    assert.equal(existsSync(candidate),false);
  } finally {
    // Keep the isolated test fixture removable if the regression fails.
    for(const file of [pack,graph]) {
      if(existsSync(file))execFileSync('attrib.exe',['-R',file],{windowsHide:true});
    }
  }
});

test('candidate deletion detaches Windows junction without erasing the shared Vite toolchain',t=>{
  const f=fixture(t);
  const target=join(f.template,'node_modules');
  const sentinel=join(target,'vite','bin','vite.js');
  mkdirSync(join(target,'vite','bin'),{recursive:true});
  writeFileSync(sentinel,'immutable installed compiler must survive cleanup');
  const candidate=join(f.userData,'runtime-versions',
    '.candidate-12345678-abcd-abcd-abcd-123456789abc');
  mkdirSync(candidate,{recursive:true});
  const mount=join(candidate,'node_modules');
  symlinkSync(target,mount,process.platform==='win32'?'junction':'dir');
  assert.equal(lstatSync(mount).isSymbolicLink(),true);
  const outcome=removeOwnedCandidate(candidate);
  assert.equal(outcome.removed,true);
  assert.equal(existsSync(candidate),false);
  assert.equal(readFileSync(sentinel,'utf8'),
    'immutable installed compiler must survive cleanup',
    'removing a Dev candidate may NEVER recurse into the installed runtime');
});

test('candidate cleanup refuses unexpected real node_modules tree before recursive deletion',t=>{
  const f=fixture(t);
  const candidate=join(f.userData,'runtime-versions',
    '.candidate-87654321-abcd-abcd-abcd-123456789abc');
  const unexpected=join(candidate,'node_modules');
  mkdirSync(unexpected,{recursive:true});
  writeFileSync(join(unexpected,'keep'),'candidate source is not an external junction');
  assert.throws(()=>removeOwnedCandidate(candidate),/Unsafe Desktop candidate node_modules/);
  assert.equal(readFileSync(join(unexpected,'keep'),'utf8'),
    'candidate source is not an external junction');
});

test('Desktop updater bounds and verifies the SAME journal bytes as the read-only observation', async t=>{
  const folder=mkdtempSync(join(tmpdir(),'ordax-dev-journal-contract-'));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const path=join(folder,'desktop-dev-update-state.json');
  const initial=readState(folder);
  assert.equal(initial.activeSha,null);
  const sha='a'.repeat(40);
  const saved=writeState(folder,{...initial,activeSha:sha});
  assert.equal(readState(folder).activeSha,sha);
  const {readDesktopDevUpdateState,readDesktopUpdateStatus}=await import(
    '../../system/adapters/desktop/update-observation.mjs'
  );
  assert.equal((await readDesktopDevUpdateState(folder)).activeSha,sha);
  const withoutRuntimeProof=await readDesktopUpdateStatus(folder);
  assert.equal(withoutRuntimeProof.status,'unavailable');
  assert.equal((await readDesktopUpdateStatus(folder,{renderedSourceSha:sha})).status,'running');
  assert.equal(saved.activeSha,sha);

  writeFileSync(path,Buffer.alloc(8193,65));
  assert.throws(()=>readState(folder),/bounded regular file/);
  assert.equal((await readDesktopUpdateStatus(folder)).status,'unavailable');
  writeFileSync(path,Buffer.from([0xff,0xfe,0xfd]));
  assert.throws(()=>readState(folder));
  assert.equal((await readDesktopUpdateStatus(folder)).status,'unavailable');

  // A malicious profile entry must not cause the updater to follow a link.
  const external=join(folder,'external-private-state.json');
  writeFileSync(external,JSON.stringify(saved));
  rmSync(path);
  try { symlinkSync(external,path,'file'); }
  catch(error) {
    // Some Windows runners deny symlink creation without Developer Mode.
    // Preserve the other real on-disk tests instead of a privilege-only fail.
    if(process.platform!=='win32' || !['EPERM','EACCES','ENOTSUP'].includes(error?.code)) throw error;
    t.diagnostic('Windows runner forbids creating a fixture symlink; size/UTF-8 checks remain enforced');
    return;
  }
  assert.throws(()=>readState(folder),/bounded regular file/);
  assert.equal((await readDesktopUpdateStatus(folder)).status,'unavailable');
  assert.equal(JSON.parse(readFileSync(external,'utf8')).activeSha,sha);
});

test('Desktop updater refuses malformed journal without clearing the verified known-good version',t=>{
  const folder=mkdtempSync(join(tmpdir(),'ordax-dev-bad-journal-'));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const journal=join(folder,'desktop-dev-update-state.json');
  const a='a'.repeat(40),b='b'.repeat(40);
  writeState(folder,{...readState(folder),activeSha:a,previousSha:b});
  assert.equal(readState(folder).activeSha,a);
  writeFileSync(journal,'{unclosed json');
  assert.throws(()=>readState(folder),SyntaxError);
  // Journal corruption can never be mistaken for a clean fresh install.
  assert.throws(()=>writeState(folder,{...readState(folder),activeSha:b}));
  writeState(folder,{...validateState({schema:'ordax.desktop-dev-update-state/1',
    activeSha:a,previousSha:b,pendingSha:null,attemptedSha:null,
    pinnedSha:null,rejectedSha:null,incompatibleSha:null})});
  assert.equal(readState(folder).activeSha,a);
});
