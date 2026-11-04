'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const {join, dirname, resolve} = require('node:path');
const {stageStandalonePackage, verifyStandaloneStage} = require('./standalone-stage.cjs');
const SHA = 'c'.repeat(40);

function fixture() {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'ordax-desktop-extraction-'));
  const shell = join(root, 'tools', 'windows-desktop');
  const packageJson = {
    name:'ordax-os-desktop-dev', version:'0.1.0-alpha.20', main:'main.cjs',
    build:{
      files:['main.cjs','runtime.cjs','package.json'],
      extraResources:[
        {from:'../../system',to:'runtime-template/system',filter:['**/*','!surface/runtime/packages.txt']},
        {from:'../windows-emulator',to:'runtime-template/tools/windows-emulator',filter:['**/*']},
        {from:'../../docs/contracts/surface-source.json',to:'runtime-template/docs/contracts/surface-source.json'},
        {from:'../../out/windows-desktop-native',to:'runtime-template/desktop-assets',filter:['**/*']},
      ],
      directories:{output:'../../out/windows-desktop-installer'},
      nsis:{include:'installer.nsh'},
    },
  };
  function put(path, value='safe') {
    const target=join(root,path);
    fs.mkdirSync(dirname(target),{recursive:true});
    fs.writeFileSync(target,value);
  }
  put('tools/windows-desktop/package.json',JSON.stringify(packageJson));
  for (const p of ['main.cjs','runtime.cjs','installer.nsh','package-lock.json'])
    put('tools/windows-desktop/'+p);
  put('system/composition/native/index.html','Native OS');
  put('system/surface/runtime/packages.txt','apk-only');
  put('tools/windows-emulator/native-host.mjs');
  put('docs/contracts/surface-source.json','{}');
  put('out/windows-desktop-native/source-provenance.json',JSON.stringify({schema:'ordax.desktop-native-bundle-provenance/1',os_sha:SHA,source_commit:'d'.repeat(40)}));
  return {root, shell, pkg:packageJson, put,
    out:join(root,'out','windows-desktop-standalone'),
    cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('stages a self-contained Desktop shell from verified OS resources without a second UI authority', () => {
  const f=fixture();
  try {
    const staged=stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative:()=>true});
    assert.equal(staged.os_sha,SHA);
    const content=verifyStandaloneStage(f.out);
    assert.equal(content.os_sha,SHA);
    assert.ok(content.files.some(record=>record.path==='runtime-template/system/composition/native/index.html'));
    assert.ok(content.files.some(record=>record.path==='runtime-template/desktop-assets/source-provenance.json'));
    assert.ok(!content.files.some(record=>record.path.endsWith('packages.txt')));
    assert.equal(fs.existsSync(join(f.out,'runtime-template/system/surface/runtime/packages.txt')),false);
    const pkg=JSON.parse(fs.readFileSync(join(f.out,'shell/package.json'),'utf8'));
    assert.deepEqual(pkg.build.extraResources,[{from:'../runtime-template',to:'runtime-template',filter:['**/*']}]);
    assert.equal(pkg.build.directories.output,'../../windows-desktop-installer');
    assert.equal(fs.existsSync(join(f.out,'shell/installer.nsh')),true);
    assert.equal(fs.existsSync(join(f.out,'shell/package-lock.json')),true);
    assert.throws(()=>stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /cannot be silently overwritten/);
  } finally {f.cleanup();}
});

test('requires a verified Native bundle and exact source SHA before touching out/',()=>{
  const f=fixture();
  try {
    assert.throws(()=>stageStandalonePackage({sourceRoot:f.root,osSha:'bad',verifyNative:()=>true}),
      /exact 40-character/);
    assert.throws(()=>stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative:()=>false}),
      /existing provenance gate/);
    assert.equal(fs.existsSync(f.out),false);
  } finally {f.cleanup();}
});

test('fails closed on source symlinks, even when the linked file is regular',()=>{
  const f=fixture();
  try {
    const file=join(f.root,'system','composition','native','index.html');
    const symlink=join(f.root,'system','composition','native','shadow.html');
    fs.symlinkSync(file,symlink);
    assert.throws(()=>stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /linked/);
    assert.equal(fs.existsSync(f.out),false);
  } finally {f.cleanup();}
});

test('rejects duplicated resource destinations case-insensitively',()=>{
  const f=fixture();
  try {
    const config=JSON.parse(fs.readFileSync(join(f.shell,'package.json'),'utf8'));
    config.build.extraResources.push({from:'../../docs/contracts/surface-source.json',
      to:'runtime-template/docs/contracts/SURFACE-source.json'});
    fs.writeFileSync(join(f.shell,'package.json'),JSON.stringify(config));
    assert.throws(()=>stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /Duplicate Desktop packaging target/);
  } finally {f.cleanup();}
});

test('detects staged byte tampering and extra files, with no modification of the installed product',()=>{
  const f=fixture();
  try {
    stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative:()=>true});
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
    assert.throws(()=>stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
      /Unsupported Desktop packaging exclusion/);
  } finally {f.cleanup();}
});


test('rejects a verified-but-different OS SHA instead of trusting the caller claim',()=>{
  const f=fixture();
  try {
    assert.throws(()=>stageStandalonePackage({sourceRoot:f.root,osSha:'d'.repeat(40),verifyNative:()=>true}),
      /not bound to requested OS SHA/);
  } finally {f.cleanup();}
});

test('staged writes cannot mutate their canonical OS source',()=>{
  const f=fixture();
  try {
    const canonical = join(f.root,'system/composition/native/index.html');
    stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative:()=>true});
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
    assert.throws(()=>stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative:()=>true}),
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
    assert.throws(()=>stageStandalonePackage({sourceRoot:f.root,osSha:SHA,verifyNative}),
      /Copied Desktop Native bundle fails canonical OS\/Surface provenance/);
    assert.equal(inspected.length,2);
    assert.equal(inspected[0][0],f.root);
    assert.equal(inspected[1][0].includes('.ordax-desktop-standalone-'),true);
    assert.ok(inspected[1][1].endsWith('runtime-template'+require('node:path').sep+'desktop-assets'));
    assert.equal(fs.existsSync(f.out),false,
      'rejected copy must not become a published stage');
  } finally {f.cleanup();}
});
