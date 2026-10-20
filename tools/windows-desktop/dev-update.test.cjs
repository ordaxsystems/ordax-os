'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { OFFICIAL_REMOTE } = require('./runtime.cjs');
const { git } = require('./checkout.cjs');
const { readState, writeState, validateState, versionRoot, stageMain,
  chooseBootVersion, confirmHealthy, pinPrevious, unpin } = require('./dev-update.cjs');

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
    if(args[0]==='clone'){
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
  }
  return {root,source,userData,template,first,advance,offlineGit,offlineBuild};
}

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
