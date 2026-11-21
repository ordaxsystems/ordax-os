'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const {join, dirname, resolve} = require('node:path');
const {spawnSync} = require('node:child_process');
const {stageStandalonePackage, verifyStandaloneStage} = require('./standalone-stage.cjs');
const SHA = 'c'.repeat(40);

function fixture() {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'ordax-desktop-extraction-'));
  const shell = join(root, 'desktop');
  const packageJson = {
    name:'ordax-os-desktop-dev', version:'0.1.0-alpha.20', main:'main.cjs',
    build:{
      files:['main.cjs','runtime.cjs','package.json'],
      extraResources:[
        {from:'../system',to:'runtime-template/system',filter:['**/*','!surface/runtime/packages.txt']},
        {from:'../tools/windows-emulator',to:'runtime-template/tools/windows-emulator',filter:['**/*']},
        {from:'../docs/contracts/surface-source.json',to:'runtime-template/docs/contracts/surface-source.json'},
        {from:'../out/windows-desktop-native',to:'runtime-template/desktop-assets',filter:['**/*']},
        {from:'../out/windows-desktop-power/ordax-win32-power.exe',to:'runtime-template/tools/windows-power/ordax-win32-power.exe'},
      ],
      directories:{output:'../out/windows-desktop-installer'},
      nsis:{include:'installer.nsh'},
    },
  };
  function put(path, value='safe') {
    const target=join(root,path);
    fs.mkdirSync(dirname(target),{recursive:true});
    fs.writeFileSync(target,value);
  }
  put('desktop/package.json',JSON.stringify(packageJson));
  for (const p of ['main.cjs','runtime.cjs','installer.nsh','package-lock.json'])
    put('desktop/'+p);
  put('system/composition/native/index.html','Native OS');
  put('system/surface/runtime/packages.txt','apk-only');
  put('tools/windows-emulator/native-host.mjs');
  put('docs/contracts/surface-source.json','{}');
  put('out/windows-desktop-native/source-provenance.json',JSON.stringify({schema:'ordax.desktop-native-bundle-provenance/1',os_sha:SHA,source_commit:SHA}));
  put('out/windows-desktop-power/ordax-win32-power.exe',Buffer.concat([Buffer.from('MZ'),Buffer.alloc(3582)]));
  return {root, shell, pkg:packageJson, put,
    out:join(root,'out','windows-desktop-standalone'),
    cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}


function stageFromFixture(f,options) {
  // Retain security/packaging regression coverage, but exercise only the
  // canonical detached Git producer. No test may grant an OS-owned Electron
  // package to the current stage.
  const d=detachedFixture(f);
  try {
    const {osSha,...rest}=options;
    return stageStandalonePackage({
      ...rest,sourceRoot:f.root,
      osSha:osSha===SHA?d.osSha:osSha,
    });
  } finally {d.cleanup();}
}


test('staging refuses the removed OS-owned Electron input without a Desktop checkout',()=>{
  const f=fixture();
  try {
    assert.throws(()=>stageStandalonePackage({
      sourceRoot:f.root,osSha:SHA,verifyNative:()=>true
    }),/Git source|Git repository|source root|not a Git repository/);
    assert.equal(fs.existsSync(f.out),false,
      'implicit OS-owned staging must not touch output');
    const cli=spawnSync(process.execPath,[join(__dirname,'standalone-stage.cjs'),SHA],{
      encoding:'utf8',windowsHide:true,
    });
    assert.notEqual(cli.status,0,'the one-argument legacy entrypoint must fail');
    assert.match(cli.stderr,/--os-root/);
  }finally{f.cleanup();}
});


test('stages a self-contained Desktop shell from verified OS resources without a second UI authority', () => {
  const f=fixture();
  try {
    const staged=stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true});
    assert.match(staged.os_sha,/^[a-f0-9]{40}$/);
    const content=verifyStandaloneStage(f.out);
    assert.equal(content.os_sha,staged.os_sha);
    assert.ok(content.files.some(record=>record.path==='runtime-template/system/composition/native/index.html'));
    assert.ok(content.files.some(record=>record.path==='runtime-template/desktop-assets/source-provenance.json'));
    assert.ok(content.files.some(record=>record.path==='runtime-template/tools/windows-power/ordax-win32-power.exe'));
    assert.equal(fs.statSync(join(f.out,'runtime-template/tools/windows-power/ordax-win32-power.exe')).size,3584);
    assert.ok(!content.files.some(record=>record.path.endsWith('packages.txt')));
    assert.equal(fs.existsSync(join(f.out,'runtime-template/system/surface/runtime/packages.txt')),false);
    const pkg=JSON.parse(fs.readFileSync(join(f.out,'shell/package.json'),'utf8'));
    assert.deepEqual(pkg.build.extraResources,[
      {from:'../runtime-template',to:'runtime-template',filter:['**/*']},
      {from:'../stage-manifest.json',to:'runtime-template/docs/evidence/desktop-stage-manifest.json'}
    ]);
    assert.equal(content.product_owner,'ordaxsystems/ordax-os');
    assert.equal(content.runtime_owner,'ordaxsystems/ordax-os');
    assert.equal(pkg.build.directories.output,'../../windows-desktop-installer');
    assert.equal(fs.existsSync(join(f.out,'shell/installer.nsh')),true);
    assert.equal(fs.existsSync(join(f.out,'shell/package-lock.json')),true);
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /cannot be silently overwritten/);
  } finally {f.cleanup();}
});

test('requires a verified Native bundle and exact source SHA before touching out/',()=>{
  const f=fixture();
  try {
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:'bad',verifyNative:()=>true}),
      /exact 40-character/);
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>false}),
      /existing provenance gate/);
    assert.equal(fs.existsSync(f.out),false);
  } finally {f.cleanup();}
});

test('fails closed on linked source files and Windows directory junctions',()=>{
  const f=fixture();
  try {
    const native=join(f.root,'system','composition','native');
    const file=join(native,'index.html');
    const symlink=join(native,'shadow.html');
    try {
      fs.symlinkSync(file,symlink);
    } catch (error) {
      if (process.platform!=='win32' || !['EPERM','EACCES'].includes(error.code)) throw error;
      // Unprivileged Windows cannot create file symlinks; junctions still exercise linked-source rejection.
      fs.symlinkSync(native,join(f.root,'system','composition','shadow-native'),'junction');
    }
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /linked/);
    assert.equal(fs.existsSync(f.out),false);
  } finally {f.cleanup();}
});

test('rejects duplicated resource destinations case-insensitively',()=>{
  const f=fixture();
  try {
    const config=JSON.parse(fs.readFileSync(join(f.shell,'package.json'),'utf8'));
    config.build.extraResources.push({from:'../docs/contracts/surface-source.json',
      to:'runtime-template/docs/contracts/SURFACE-source.json'});
    fs.writeFileSync(join(f.shell,'package.json'),JSON.stringify(config));
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /Duplicate Desktop packaging target/);
  } finally {f.cleanup();}
});

test('detects staged byte tampering and extra files, with no modification of the installed product',()=>{
  const f=fixture();
  try {
    stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true});
    const changed=join(f.out,'runtime-template/docs/contracts/surface-source.json');
    fs.rmSync(changed);
    fs.writeFileSync(changed,'altered');
    assert.throws(()=>verifyStandaloneStage(f.out),/hash mismatch/);
    fs.writeFileSync(changed,'{}');
    fs.writeFileSync(join(f.out,'shell','unapproved.cjs'),'unexpected');
    assert.throws(()=>verifyStandaloneStage(f.out),/Unmanifested staged Desktop file/);
  } finally {f.cleanup();}
});

test('rejects unknown exclusion patterns instead of silently copying extra OS files',()=>{
  const f=fixture();
  try {
    const config=JSON.parse(fs.readFileSync(join(f.shell,'package.json'),'utf8'));
    config.build.extraResources[0].filter.push('!surface/runtime/**');
    fs.writeFileSync(join(f.shell,'package.json'),JSON.stringify(config));
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /Unsupported Desktop packaging exclusion/);
  } finally {f.cleanup();}
});


test('rejects a verified-but-different OS SHA instead of trusting the caller claim',()=>{
  const f=fixture();
  try {
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:'d'.repeat(40),verifyNative:()=>true}),
      /ordax-os source does not match pinned commit/);
  } finally {f.cleanup();}
});

test('staged writes cannot mutate their canonical OS source',()=>{
  const f=fixture();
  try {
    const canonical = join(f.root,'system/composition/native/index.html');
    stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true});
    const staged = join(f.out,'runtime-template/system/composition/native/index.html');
    assert.notEqual(fs.statSync(canonical).ino, fs.statSync(staged).ino,
      'standalone staging must not hardlink the OS source');
    fs.writeFileSync(staged,'staged modification only');
    assert.equal(fs.readFileSync(canonical,'utf8'),'Native OS');
    assert.throws(()=>verifyStandaloneStage(f.out),/hash mismatch/);
  } finally { f.cleanup(); }
});

test('existing dangling output links cannot be overwritten',()=>{
  const f=fixture();
  try {
    const external=join(f.root,'external');
    fs.symlinkSync(external,f.out,process.platform==='win32'?'junction':'dir');
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /cannot be silently overwritten/);
    assert.equal(fs.existsSync(external),false);
  } finally { f.cleanup(); }
});


test('copied payload must pass the canonical Native verifier before export',()=>{
  const f=fixture();
  try {
    const inspected=[];
    const verifyNative=(base,emittedRoot)=>{
      inspected.push([base,emittedRoot]);
      return emittedRoot===undefined; // source passes, copied payload fails
    };
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative}),
      /Copied Desktop Native bundle fails canonical OS\/Surface provenance/);
    assert.equal(inspected.length,2);
    assert.equal(inspected[0][0],f.root);
    assert.equal(inspected[1][0].includes('.ordax-desktop-standalone-'),true);
    assert.ok(inspected[1][1].endsWith('runtime-template'+require('node:path').sep+'desktop-assets'));
    assert.equal(fs.existsSync(f.out),false,
      'rejected copy must not become a published stage');
  } finally {f.cleanup();}
});


function detachedFixture(f) {
  const shell=f.shell;
  fs.writeFileSync(join(shell,'main.cjs'),'Desktop-owned Electron code');
  fs.writeFileSync(join(f.root,'.gitignore'),'out/\n');
  const osGit=(...args)=>{
    const r=spawnSync('git',['-C',f.root,...args],{encoding:'utf8',windowsHide:true});
    assert.equal(r.status,0,r.stderr||'OS Git fixture failed');
    return r.stdout.trim();
  };
  osGit('init','-q');
  osGit('config','user.name','OrdaX OS Test');
  osGit('config','user.email','ordax-os-fixture@invalid.example');
  osGit('remote','add','origin','https://github.com/ordaxsystems/ordax-os.git');
  osGit('add','-A');
  osGit('commit','-qm','Same-commit Desktop and Native OS fixture');
  const osSha=osGit('rev-parse','HEAD');
  const provenanceFile=join(f.root,'out','windows-desktop-native','source-provenance.json');
  const provenance=JSON.parse(fs.readFileSync(provenanceFile,'utf8'));
  fs.writeFileSync(provenanceFile,JSON.stringify({...provenance,os_sha:osSha,source_commit:osSha}));
  return {shell,osGit,osSha,sha:osSha,cleanup:()=>{}};
}

test('packages exact same-commit OS Desktop and Native resources',()=>{
  const f=fixture();
  const d=detachedFixture(f);
  try {
    const result=stageStandalonePackage({
      sourceRoot:f.root,osSha:d.osSha,
      verifyNative:()=>true
    });
    assert.equal(result.os_sha,d.osSha);
    assert.equal(fs.readFileSync(join(f.out,'shell/main.cjs'),'utf8'),
      'Desktop-owned Electron code');
    assert.equal(fs.readFileSync(join(f.out,'runtime-template/system/composition/native/index.html'),'utf8'),
      'Native OS');
    const manifest=verifyStandaloneStage(f.out);
    assert.equal(manifest.desktop_owner,'ordaxsystems/ordax-os');
    assert.equal(manifest.product_owner,'ordaxsystems/ordax-os');
    assert.equal(manifest.runtime_owner,'ordaxsystems/ordax-os');
    assert.equal(manifest.desktop_sha,d.sha);
    assert.equal(manifest.source_authority,'ordaxsystems/ordax-os/desktop/package.json');
  } finally {d.cleanup();f.cleanup();}
});

test('single OS source fails closed on a different SHA or origin',()=>{
  const f=fixture();
  const d=detachedFixture(f);
  try {
    const args={sourceRoot:f.root,osSha:d.osSha,verifyNative:()=>true};
    assert.throws(()=>stageStandalonePackage({...args,osSha:'f'.repeat(40)}),
      /source does not match pinned commit/);
    d.osGit('remote','set-url','origin','https://github.com/attacker/fake-desktop.git');
    assert.throws(()=>stageStandalonePackage(args),
      /canonical Git repository/);
    assert.equal(fs.existsSync(f.out),false);
  } finally {d.cleanup();f.cleanup();}
});

test('OS Desktop source rejects dirty files and external desktop inputs',()=>{
  const f=fixture();
  const d=detachedFixture(f);
  try {
    const args={sourceRoot:f.root,osSha:d.osSha,
      verifyNative:()=>true};
    fs.writeFileSync(join(d.shell,'main.cjs'),'not the committed code');
    assert.throws(()=>stageStandalonePackage(args),/uncommitted or untracked/);
    assert.throws(()=>stageStandalonePackage({...args,desktopRoot:'./desktop'}),
      /External Desktop source/);
    assert.equal(fs.existsSync(f.out),false);
  } finally {d.cleanup();f.cleanup();}
});


test('detached packaging rejects a mismatched OS HEAD and a dirty OS tree',()=>{
  const f=fixture(), d=detachedFixture(f);
  try {
    const args={sourceRoot:f.root,osSha:d.osSha,
      verifyNative:()=>true};
    assert.throws(()=>stageStandalonePackage({...args,osSha:'f'.repeat(40)}),
      /ordax-os source does not match pinned commit/);
    f.put('system/composition/native/index.html','Modified OS source');
    assert.throws(()=>stageStandalonePackage(args),
      /ordax-os checkout contains uncommitted or untracked files/);
    assert.equal(fs.existsSync(f.out),false);
  } finally {d.cleanup();f.cleanup();}
});

test('detached package cannot include an ignored, untracked Electron source',()=>{
  const f=fixture(), d=detachedFixture(f);
  try {
    d.osGit('config','core.excludesfile',join(d.shell,'.empty-global-gitignore'));
    fs.writeFileSync(join(d.shell,'.gitignore'),'ignored.cjs\n');
    d.osGit('add','desktop/.gitignore');
    const pkg=JSON.parse(fs.readFileSync(join(d.shell,'package.json'),'utf8'));
    pkg.build.files.push('ignored.cjs');
    fs.writeFileSync(join(d.shell,'package.json'),JSON.stringify(pkg));
    d.osGit('add','desktop/package.json');
    d.osGit('commit','-qm','Tracked package points to ignored source file');
    fs.writeFileSync(join(d.shell,'ignored.cjs'),'untrusted code');
    const newSha=d.osGit('rev-parse','HEAD');
    const evidence=join(f.root,'out/windows-desktop-native/source-provenance.json');
    const provenance=JSON.parse(fs.readFileSync(evidence,'utf8'));
    fs.writeFileSync(evidence,JSON.stringify({...provenance,os_sha:newSha,source_commit:newSha}));
    const args={sourceRoot:f.root,osSha:newSha,verifyNative:()=>true};
    assert.throws(()=>stageStandalonePackage(args),
      /Detached Desktop package file is not tracked by pinned Git commit/);
    assert.equal(fs.existsSync(f.out),false);
  } finally {d.cleanup();f.cleanup();}
});


test('rejects OS resources that shadow the installed stage receipt',()=>{
  const f=fixture();
  try {
    f.put('docs/evidence/desktop-stage-manifest.json','untrusted receipt');
    const pkg=JSON.parse(fs.readFileSync(join(f.shell,'package.json'),'utf8'));
    pkg.build.extraResources.push({from:'../docs/evidence/desktop-stage-manifest.json',
      to:'runtime-template/docs/evidence/desktop-stage-manifest.json'});
    fs.writeFileSync(join(f.shell,'package.json'),JSON.stringify(pkg));
    assert.throws(()=>stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /shadows reserved installed Desktop stage manifest/);
    assert.equal(fs.existsSync(f.out),false);
  } finally {f.cleanup();}
});
test('rejects altered standalone NSIS audit resource mapping',()=>{
  const f=fixture();
  try {
    stageFromFixture(f,{sourceRoot:f.root,osSha:SHA,verifyNative:()=>true});
    const pkgPath=join(f.out,'shell/package.json');
    const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
    pkg.build.extraResources[1].to='runtime-template/other-receipt.json';
    fs.writeFileSync(pkgPath,JSON.stringify(pkg));
    assert.throws(()=>verifyStandaloneStage(f.out),/hash mismatch/);
    const manifestPath=join(f.out,'stage-manifest.json');
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    fs.writeFileSync(manifestPath,JSON.stringify({...manifest,product_owner:'untrusted'}));
    assert.throws(()=>verifyStandaloneStage(f.out),/Invalid standalone stage manifest/);
  }finally{f.cleanup();}
});


test('detached package rejects modified Git assume-unchanged files',()=>{
  const f=fixture(), d=detachedFixture(f);
  try {
    const args={sourceRoot:f.root,osSha:d.osSha,
      verifyNative:()=>true};
    d.osGit('update-index','--assume-unchanged','desktop/main.cjs');
    fs.writeFileSync(join(d.shell,'main.cjs'),'silently altered but tracked');
    assert.equal(d.osGit('status','--porcelain','--untracked-files=all'),'',
      'Git status alone must not attest assume-unchanged source files');
    assert.throws(()=>stageStandalonePackage(args),
      /Detached Desktop bytes differ from pinned Git commit: main.cjs/);
    assert.equal(fs.existsSync(f.out),false);
  }finally{d.cleanup();f.cleanup();}
});

test('detached package rejects staged bytes changed after Git attestation',()=>{
  const f=fixture(), d=detachedFixture(f);
  const originalCopy=fs.copyFileSync;
  try {
    const args={sourceRoot:f.root,osSha:d.osSha,
      verifyNative:()=>true};
    fs.copyFileSync=(from,to,...flags)=>{
      originalCopy(from,to,...flags);
      if (from===join(d.shell,'main.cjs'))
        fs.writeFileSync(to,'copy-time corruption of tracked Desktop shell');
    };
    assert.throws(()=>stageStandalonePackage(args),
      /Copied Desktop bytes differ from pinned Git commit: main.cjs/);
    assert.equal(fs.existsSync(f.out),false);
  }finally{fs.copyFileSync=originalCopy;d.cleanup();f.cleanup();}
});

test('operational NSIS install retires only a superseded Desktop Dev shell delta receipt',()=>{
  const source=fs.readFileSync(join(__dirname,'installer.nsh'),'utf8');
  const body=source.match(/!macro customInstall\r?\n([\s\S]*?)\r?\n!macroend/)?.[1];
  assert.ok(body,'canonical NSIS install hook is required');
  const guards=[
    'StrCmp "$INSTDIR" "$LOCALAPPDATA\\Programs\\OrdaX OS Desktop Dev" 0 ordax_nsis_delta_done',
    'IfFileExists "$INSTDIR\\resources\\app.asar" 0 ordax_nsis_delta_done',
    'IfFileExists "$INSTDIR\\resources\\app.asar.delta-rollback" ordax_nsis_delta_done 0',
    'IfFileExists "$INSTDIR\\resources\\app.asar.delta-ready" ordax_nsis_delta_done 0',
    'IfFileExists "$APPDATA\\OrdaX OS Desktop Dev\\desktop-shell-delta-receipt.json.tmp" ordax_nsis_delta_done 0',
    'IfFileExists "$APPDATA\\OrdaX OS Desktop Dev\\desktop-shell-delta-receipt.json" 0 ordax_nsis_delta_done',
  ];
  let preceding=body.indexOf('install-files-complete');
  assert.ok(preceding>=0,'cleanup must follow the installed-files stage');
  for(const guard of guards){
    const next=body.indexOf(guard);
    assert.ok(next>preceding,'expected guard after previous stage: '+guard);
    preceding=next;
  }
  const mutation='Delete "$APPDATA\\OrdaX OS Desktop Dev\\desktop-shell-delta-receipt.json"';
  const at=body.indexOf(mutation);
  assert.ok(at>preceding,'receipt cleanup must follow every fail-closed guard');
  assert.match(body.slice(at),/ordax_nsis_delta_done:/);
  assert.equal((body.match(/^\s*Delete /gm)||[]).length,1,
    'do not delete profiles, grants, Runtime state or rollback evidence');
  assert.doesNotMatch(body,/RMDir|desktop-dev-update-state\.json|agent-settings\.json/);
});


test('new NSIS smoke cannot accept the historical OS-owned Electron receipt',()=>{
  const source=fs.readFileSync(join(__dirname,'install-smoke.ps1'),'utf8');
  assert.match(source,/\$stageReceipt\.desktop_owner -cne "ordaxsystems\/ordax-desktop"/);
  assert.match(source,/\$stageReceipt\.product_owner -cne "ordaxsystems\/ordax-desktop"/);
  assert.match(source,/\$stageReceipt\.source_authority -cne "ordaxsystems\/ordax-desktop\/package\.json"/);
  assert.match(source,/\$stageReceipt\.desktop_sha -cnotmatch "\^\[a-f0-9\]\{40\}\$"/);
  assert.doesNotMatch(source,/if \(\$stageReceipt\.desktop_owner\)/,
    'Desktop owner must not be an optional condition');
  assert.doesNotMatch(source,/tools\/windows-desktop\/package\.json/,
    'canonical NSIS cannot accept OS-owned Electron source');
});


test('canonical offline NSIS stores only the GGUF model as an extra precompressed resource',()=>{
  const pkg=JSON.parse(fs.readFileSync(join(__dirname,'package.json'),'utf8'));
  const defaultExtensions=['.avi','.mov','.m4v','.mp4','.m4p','.qt',
    '.mkv','.webm','.vmdk'];
  assert.deepEqual(pkg.build.nsis.preCompressedFileExtensions,
    [...defaultExtensions,'.gguf'],
    'retain built-in electron-builder exclusions without expanding to other Native binaries');
  assert.equal(pkg.build.nsis.include,'installer.nsh');
  assert.equal(pkg.build.nsis.oneClick,false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall,false);
  assert.equal(pkg.build.extraResources.some(entry=>
    entry.to==='runtime-template/local-ai-runtime'),true,
    'offline GGUF must remain bundled under the canonical Native resource mapping');
  assert.equal(pkg.build.asar,true,
    'embedded Electron ASAR integrity remains enabled');
});
