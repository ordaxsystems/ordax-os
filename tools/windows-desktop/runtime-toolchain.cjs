'use strict';
// Deterministic, generated projection of the one canonical npm lock. Never
// install a second package manifest or maintain a Desktop-only dependency fork.
// Vite is required for the same OS/Surface Dev candidate compiler, but the
// installed host does not need @vitejs/plugin-react, TypeScript, or their
// build/test dependencies.
const {readFileSync,existsSync,lstatSync,mkdirSync,cpSync,rmSync,renameSync,mkdtempSync,writeFileSync}=require('node:fs');
const {join,resolve,dirname,sep}=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=resolve(__dirname,'../..');
const out=join(root,'out','windows-desktop-toolchain');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function assertName(name) {
  if(typeof name!=='string'||! /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ||
     name.includes('..')||name.includes('\\'))throw Error('Unsafe canonical npm dependency name');
}
function planRuntimePackages(manifest,lock) {
  const packages=lock?.packages;
  if(!manifest || !packages?.[''] || !packages['node_modules/vite']) {
    throw Error('Canonical npm lock unavailable for Native runtime');
  }
  for(const field of ['dependencies','devDependencies']){
    const a=manifest[field]||{},b=packages[''][field]||{};
    if(Object.keys(a).length!==Object.keys(b).length ||
       Object.keys(a).some(k=>a[k]!==b[k])){
      throw Error('Root npm manifest diverged from its canonical package lock');
    }
  }
  if(!manifest.devDependencies?.vite || !manifest.dependencies?.react){
    throw Error('Canonical Native runtime contract lacks Vite or React');
  }
  const installed=packages;
  const selected=new Set(),queue=[];
  function locate(parent,name){
    assertName(name);
    let current=parent;
    while(true){
      const candidate=(current?current+'/':'')+'node_modules/'+name;
      if(installed[candidate])return candidate;
      if(!current)break;
      const split=current.lastIndexOf('/node_modules/');
      current=split>=0?current.slice(0,split):'';
    }
    return null;
  }
  for(const name of [...Object.keys(manifest.dependencies||{}),'vite']){
    const path=locate('',name);
    if(!path)throw Error('Missing direct Native runtime dependency: '+name);
    queue.push(path);
  }
  while(queue.length){
    const path=queue.shift();
    if(selected.has(path))continue;
    if(!path.startsWith('node_modules/') || path.split('/').includes('..'))
      throw Error('Unsafe locked module path');
    const entry=installed[path];
    if(!entry)throw Error('Canonical npm package metadata missing: '+path);
    selected.add(path);
    const required=entry.dependencies||{};
    const optional=entry.optionalDependencies||{};
    const peer=entry.peerDependencies||{};
    for(const [name] of Object.entries({...required,...optional,...peer})){
      const match=locate(path,name);
      if(!match){
        if(Object.hasOwn(required,name)&&!Object.hasOwn(optional,name)&&
          !entry.peerDependenciesMeta?.[name]?.optional){
          throw Error('Missing required locked package: '+path+' -> '+name);
        }
        continue;
      }
      queue.push(match);
    }
  }
  if(!selected.has('node_modules/vite'))throw Error('Native runtime compiler was omitted');
  return [...selected].sort((a,b)=>a.split('/').length-b.split('/').length || a.localeCompare(b));
}
function materializeRuntimeToolchain(){
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const lockBytes=readFileSync(join(root,'package-lock.json'));
  const lock=JSON.parse(lockBytes);
  const keys=planRuntimePackages(manifest,lock);
  const source=join(root,'node_modules');
  if(!existsSync(source))throw Error('npm ci must run before Native runtime packaging');
  mkdirSync(out,{recursive:true});
  const stage=mkdtempSync(join(out,'.stage-'));
  const nodeModules=join(stage,'node_modules');
  let available=0,missingOptional=0;
  try{
    for(const key of keys){
      const original=join(root,...key.split('/'));
      if(!existsSync(original)){
        if(lock.packages[key]?.optional===true){missingOptional++;continue;}
        throw Error('Native toolchain has missing installed dependency '+key);
      }
      const stat=lstatSync(original);
      if(!stat.isDirectory()||stat.isSymbolicLink())
        throw Error('Native toolchain package must be a real directory: '+key);
      const target=join(stage,...key.split('/'));
      // Nested packages are already copied with their owner directory.
      if(existsSync(target)){available++;continue;}
      mkdirSync(dirname(target),{recursive:true});
      cpSync(original,target,{recursive:true,force:false,errorOnExist:true,
        filter:src=>{
          if(lstatSync(src).isSymbolicLink())
            throw Error('Linked file in canonical Native toolchain: '+src);
          return true;
        }});
      available++;
    }
    if(!existsSync(join(nodeModules,'vite','bin','vite.js'))||
       !existsSync(join(nodeModules,'react','package.json'))){
      throw Error('Generated Native toolchain lacks Vite or React');
    }
    // Shipping 12k individual files to NSIS made even same-version upgrades
    // take several minutes on real hardware. Archive the exact lock-derived
    // closure without omitting any compiler dependencies. The trusted runtime
    // materializes this only when a new Owner/Dev candidate needs Vite.
    const archive=join(out,'node_modules.tar.gz');
    const temporary=archive+'.partial';
    try {
      const tar=spawnSync('tar',['-czf',temporary,'-C',stage,'node_modules'],{
        encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:1024*1024,
      });
      if(tar.status!==0||tar.error)throw Error('Canonical archive creation failed: '+(tar.stderr||tar.error?.message||'unknown'));
      if(existsSync(archive))rmSync(archive);
      renameSync(temporary,archive);
    }finally{
      if(existsSync(temporary))rmSync(temporary);
    }
    const bytes=readFileSync(archive);
    const receipt={schema:'ordax.desktop-runtime-toolchain-archive/1',
      canonical_lock_sha256:sha256(lockBytes),requested_packages:keys.length,
      installed_packages:available,skipped_platform_optionals:missingOptional,
      archive:'node_modules.tar.gz',archive_sha256:sha256(bytes),
      archive_size:bytes.length};
    writeFileSync(join(out,'toolchain-receipt.json'),JSON.stringify(receipt)+'\n');
    const obsolete=join(out,'node_modules');
    if(existsSync(obsolete))rmSync(obsolete,{recursive:true,force:true});
    return receipt;
  } finally {
    if(existsSync(stage))rmSync(stage,{recursive:true,force:true});
  }
}
if(require.main===module){
  try{process.stdout.write(JSON.stringify(materializeRuntimeToolchain())+'\n');}
  catch(error){process.stderr.write('Native toolchain rejected: '+error.message+'\n');process.exitCode=1;}
}
module.exports={planRuntimePackages,materializeRuntimeToolchain};
