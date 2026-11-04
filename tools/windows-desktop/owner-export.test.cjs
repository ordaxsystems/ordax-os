'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const {join,dirname}=require('node:path');
const {spawnSync}=require('node:child_process');
const {exportDesktopOwner}=require('./owner-export.cjs');
function fixture(){
  const root=fs.mkdtempSync(join(os.tmpdir(),'ordax-owner-export-fixture-'));
  const git=(...args)=>{
    const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
    assert.equal(r.status,0,r.stderr||'Git fixture failed');return r.stdout.trim();
  };
  git('init','-q');git('config','core.autocrlf','true');
  git('config','user.name','OrdaX Desktop Export Fixture');
  git('config','user.email','ordax-export@invalid.example');
  git('remote','add','origin','https://github.com/ordaxsystems/ordax-os.git');
  const put=(name,bytes)=>{
    const p=join(root,name);fs.mkdirSync(dirname(p),{recursive:true});fs.writeFileSync(p,bytes);
  };
  for(const name of ['main.cjs','package.json','package-lock.json','installer.nsh',
    'runtime.cjs','native-build.cjs','local-dev.cjs','checkout.cjs','host.cjs','browser-host.cjs'])
    put('tools/windows-desktop/'+name,'Original '+name+'\n');
  put('system/sensitive-native.cjs','Canonical Native OS content');
  put('docs/contracts/source.json','Canonical OS contract');
  put('.gitignore','out/\n');
  git('add','.');git('commit','-qm','Fixture OS commit');
  return {root,git,put,sha:git('rev-parse','HEAD'),
    out:join(root,'out','windows-desktop-owner-export'),
    cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('export exact Git owner source tree without OS, Surface or models',t=>{
  const f=fixture();t.after(f.cleanup);
  const result=exportDesktopOwner({sourceRoot:f.root,osSha:f.sha});
  const receipt=JSON.parse(fs.readFileSync(join(f.out,'owner-export-receipt.json'),'utf8'));
  assert.equal(result.files,10);
  assert.equal(receipt.os_sha,f.sha);
  assert.equal(receipt.file_count,10);
  assert.deepEqual(receipt.files.map(e=>e.path).sort(),
    ['main.cjs','package.json','package-lock.json','installer.nsh','runtime.cjs',
      'native-build.cjs','local-dev.cjs','checkout.cjs','host.cjs','browser-host.cjs'].sort());
  const path=join(f.out,'ordax-desktop-source.tar.gz');
  const listed=spawnSync('tar',['-tzf',path],{encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  assert.doesNotMatch(listed.stdout,/system\//);
  assert.doesNotMatch(listed.stdout,/docs\/contracts\//);
  assert.throws(()=>exportDesktopOwner({sourceRoot:f.root,osSha:f.sha}),/already exists/);
});
test('export uses committed bytes instead of changed or assume-unchanged worktree',t=>{
  const f=fixture();t.after(f.cleanup);
  f.git('update-index','--assume-unchanged','tools/windows-desktop/main.cjs');
  f.put('tools/windows-desktop/main.cjs','Modified without Git status');
  const result=exportDesktopOwner({sourceRoot:f.root,osSha:f.sha});
  const dest=join(f.root,'expanded');
  fs.mkdirSync(dest);
  const x=spawnSync('tar',['-xzf',join(result.directory,'ordax-desktop-source.tar.gz'),'-C',dest],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);
  const commitBytes=spawnSync('git',['-C',f.root,'show',
    'HEAD:tools/windows-desktop/main.cjs'],{windowsHide:true});
  assert.equal(commitBytes.status,0,String(commitBytes.stderr));
  assert.deepEqual(fs.readFileSync(join(dest,'main.cjs')),commitBytes.stdout,
    'export must reproduce committed Git blob bytes regardless of Windows newline settings');
  assert.notDeepEqual(commitBytes.stdout,Buffer.from('Modified without Git status'));
});
test('rejection of stale commit and untrusted repository without writing export',t=>{
  const f=fixture();t.after(f.cleanup);
  assert.throws(()=>exportDesktopOwner({sourceRoot:f.root,osSha:'a'.repeat(40)}),/diverges/);
  f.git('remote','set-url','origin','https://github.com/example/other.git');
  assert.throws(()=>exportDesktopOwner({sourceRoot:f.root,osSha:f.sha}),/canonical ordax-os/);
  assert.equal(fs.existsSync(f.out),false);
});
test('tracked Git symlinks cannot become Windows Desktop source inputs',t=>{
  const f=fixture();t.after(f.cleanup);
  const blob=spawnSync('git',['-C',f.root,'hash-object','-w','--stdin'],
    {encoding:'utf8',input:'outside',windowsHide:true});
  assert.equal(blob.status,0,blob.stderr);
  f.git('update-index','--add','--cacheinfo','120000,'+blob.stdout.trim()+',tools/windows-desktop/linked.cjs');
  f.git('commit','-qm','Tracked symlink source');
  assert.throws(()=>exportDesktopOwner({sourceRoot:f.root,osSha:f.git('rev-parse','HEAD')}),
    /Unsafe or untracked/);
  assert.equal(fs.existsSync(f.out),false);
});
