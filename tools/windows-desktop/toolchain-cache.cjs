'use strict';
// A single canonical npm lock yields one archived, content-bound Windows
// Dev compiler. Never install packages, fetch from npm or modify Program Files
// on a user's machine. Expanded files are a disposable per-user cache.
const {existsSync,mkdirSync,lstatSync,readFileSync,readdirSync,mkdtempSync,writeFileSync,renameSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync,fork}=require('node:child_process');
const HASH=/^[a-f0-9]{64}$/;
function calculateTreeDigest(root){
  const digest=createHash('sha256');
  // Digest traversal is also the single complete structural scan: checking
  // all entries a second time on Windows doubles expensive NTFS metadata IO.
  let count=0;
  const visit=(directory,prefix)=>{
    for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const path=join(directory,entry.name),stat=lstatSync(path);
      if(++count>65000)throw Error('Oversized Desktop compiler tree');
      if(stat.isSymbolicLink())throw Error('Untrusted compiler tree link');
      const name=prefix+entry.name;
      if(stat.isDirectory())visit(path,name+'/');
      else if(stat.isFile()){
        if(stat.size>64*1024*1024)throw Error('Oversized canonical compiler file');
        digest.update(name+'\\0');
        digest.update(createHash('sha256').update(readFileSync(path)).digest());
      }else throw Error('Untrusted compiler tree entry');
    }
  };
  visit(root,'');
  return digest.digest('hex');
}
// Same canonical tree digest as calculateTreeDigest, with bounded parallel
// Windows filesystem IO. The ordered entries and per-file SHA-256 are identical
// to the synchronous producer; neither metadata nor a saved marker authenticates
// the cache in place of reading the real file bytes.
async function calculateTreeDigestConcurrent(root,{concurrency=16}={}){
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>32)
    throw TypeError('Invalid Desktop compiler verification concurrency');
  const fs=require('node:fs/promises');
  const limit=async run=>{
    if(active>=concurrency)await new Promise(resolve=>waiting.push(resolve));
    active++;
    try{return await run();}
    finally{active--;waiting.shift()?.();}
  };
  let active=0;
  const waiting=[];
  let count=0;
  const visit=async(directory,prefix)=>{
    const entries=(await limit(()=>fs.readdir(directory,{withFileTypes:true})))
      .sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    const sections=await Promise.all(entries.map(async entry=>{
      const path=join(directory,entry.name);
      const stat=await limit(()=>fs.lstat(path));
      if(++count>65000)throw Error('Oversized Desktop compiler tree');
      if(stat.isSymbolicLink())throw Error('Untrusted compiler tree link');
      const name=prefix+entry.name;
      if(stat.isDirectory())return visit(path,name+'/');
      if(!stat.isFile())throw Error('Untrusted compiler tree entry');
      if(stat.size>64*1024*1024)throw Error('Oversized canonical compiler file');
      return [{path,name}];
    }));
    return sections.flat();
  };
  const files=await visit(root,'');
  const hashes=new Array(files.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,files.length)},async()=>{
    while(next<files.length){
      const index=next++;
      const bytes=await limit(()=>fs.readFile(files[index].path));
      hashes[index]=createHash('sha256').update(bytes).digest();
    }
  }));
  const result=createHash('sha256');
  files.forEach((file,i)=>{
    result.update(file.name+'\\0');
    result.update(hashes[i]);
  });
  return result.digest('hex');
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function assertRealFile(path){
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('Untrusted packed Desktop toolchain file');
  return stat;
}
function archiveReceipt(template){
  const directory=join(template,'toolchain');
  const receiptPath=join(directory,'toolchain-receipt.json');
  assertRealFile(receiptPath);
  const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
  if(receipt.schema!=='ordax.desktop-runtime-toolchain-archive/1' ||
    receipt.archive!=='node_modules.tar.gz' || !HASH.test(receipt.archive_sha256) ||
    !HASH.test(receipt.canonical_lock_sha256) ||
    !Number.isSafeInteger(receipt.archive_size)||receipt.archive_size<1||
    receipt.archive_size>256*1024*1024 ||
    !Number.isSafeInteger(receipt.installed_packages)||receipt.installed_packages<1 ||
    !HASH.test(receipt.tree_sha256))
    throw Error('Untrusted canonical Desktop toolchain receipt');
  const archive=join(directory,receipt.archive);
  if(assertRealFile(archive).size!==receipt.archive_size ||
      digest(readFileSync(archive))!==receipt.archive_sha256)
    throw Error('Desktop toolchain archive digest mismatch');
  return {archive,receipt};
}
function tar(args,timeout=180000,phase='extract'){
  const run=spawnSync('tar',args,{windowsHide:true,encoding:'utf8',
    timeout,maxBuffer:32*1024*1024});
  if(run.error||run.status!==0)throw Error('Canonical Desktop toolchain '+phase+' rejected: '+(run.error?.message||String(run.stderr||'').slice(-250)));
  return run.stdout;
}
function assertEntries(archive){
  const entries=tar(['-tzf',archive],45000,'list').trim().split(/\r?\n/);
  if(!entries.length||entries.length>65000)throw Error('Invalid toolchain archive entry count');
  const seen=new Set();
  for(const name of entries){
    const path=name.replace(/\/$/,'');
    const parts=path.split('/');
    if(!path||parts[0]!=='node_modules' ||
       parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')||p.includes(':')||/[\x00-\x1f]/.test(p)) ||
       seen.has(name))throw Error('Unsafe or duplicate Desktop toolchain archive entry');
    seen.add(name);
  }
  // Do not follow symlinks or hardlinks when expanding a privileged compiler.
  const verbose=tar(['-tvzf',archive],45000,'entry-types').trim().split(/\r?\n/);
  if(verbose.length!==entries.length ||
      verbose.some(line=>!['-','d'].includes(line[0])))
    throw Error('Unsupported Desktop toolchain archive link or device');
}
function validateExpanded(root){
  const nodeModules=join(root,'node_modules');
  const stat=lstatSync(nodeModules);
  if(!stat.isDirectory()||stat.isSymbolicLink())
    throw Error('Missing or linked expanded dependency root');
  // The immediately following calculateTreeDigest scans EVERY entry, rejects
  // links and unusual nodes, bounds the tree and authenticates its bytes.
  // This function checks only required compiler entrypoints, not a second
  // complete traversal of the 12.5k-file tree.
  for(const relative of ['vite/bin/vite.js','react/package.json']){
    assertRealFile(join(nodeModules,...relative.split('/')));
  }
  return nodeModules;
}
function ensureRuntimeToolchain(template,userData){
  const legacy=join(template,'node_modules');
  if(existsSync(legacy)){
    if(!lstatSync(legacy).isDirectory()||lstatSync(legacy).isSymbolicLink())
      throw Error('Untrusted unpacked Desktop compiler');
    return legacy;
  }
  if(typeof userData!=='string'||!userData)throw Error('Owner Dev compiler cache requires an explicit profile');
  const {archive,receipt}=archiveReceipt(template);
  const base=join(userData,'runtime-toolchains');
  mkdirSync(base,{recursive:true});
  if(lstatSync(base).isSymbolicLink())throw Error('Linked compiler cache root refused');
  const target=join(base,receipt.archive_sha256);
  const marker=join(target,'toolchain-cache-receipt.json');
  if(existsSync(target)){
    // The cache contains executable compiler code. A junction/symlink at
    // the final digest path can redirect a verified tree outside the owner
    // profile. Reject the indirection even when the bytes match the receipt.
    const targetStat=lstatSync(target);
    if(!targetStat.isDirectory()||targetStat.isSymbolicLink())
      throw Error('Untrusted linked Desktop compiler cache target');
    if(!existsSync(marker)||assertRealFile(marker).size>512||
      JSON.parse(readFileSync(marker,'utf8')).archive_sha256!==receipt.archive_sha256)
      throw Error('Untrusted existing Desktop compiler cache');
    const expanded=validateExpanded(target);
    if(calculateTreeDigest(expanded)!==receipt.tree_sha256)
      throw Error('Desktop compiler cache content digest mismatch');
    return expanded;
  }
  // An installer rebuild may create different tar/gzip bytes for exactly the
  // same canonical npm closure (timestamps and archive metadata differ).
  // Existing legacy cache directories are archive-addressed; reuse them
  // strictly by verifying their complete content digest against the NEW
  // authenticated receipt, never merely by trusting an old marker.
  for(const entry of readdirSync(base,{withFileTypes:true})){
    if(!HASH.test(entry.name)||entry.name===receipt.archive_sha256)continue;
    const candidate=join(base,entry.name),candidateStat=lstatSync(candidate);
    if(!candidateStat.isDirectory()||candidateStat.isSymbolicLink())
      throw Error('Untrusted linked Desktop compiler cache candidate');
    const candidateMarker=join(candidate,'toolchain-cache-receipt.json');
    if(!existsSync(candidateMarker)||assertRealFile(candidateMarker).size>512)continue;
    let prior;
    try{prior=JSON.parse(readFileSync(candidateMarker,'utf8'));}
    catch{continue;}
    if(prior.archive_sha256!==entry.name)continue;
    const expanded=validateExpanded(candidate);
    if(calculateTreeDigest(expanded)===receipt.tree_sha256)return expanded;
  }
  assertEntries(archive);
  const temp=mkdtempSync(join(base,'.extract-'));
  try{
    // The receipt authenticates paths and bytes, never source timestamps.
    // Restoring 12,500 NTFS timestamps adds per-file metadata writes and
    // lengthened physical Windows extraction (63s vs 40s in a local test).
    // BSD tar -m skips only timestamp restoration; no trust check is skipped.
    tar(['-xmzf',archive,'-C',temp],180000,'extract-no-mtime');
    const ready=validateExpanded(temp);
    if(calculateTreeDigest(ready)!==receipt.tree_sha256)
      throw Error('Expanded Desktop compiler does not match canonical receipt');
    writeFileSync(join(temp,'toolchain-cache-receipt.json'),
      JSON.stringify({archive_sha256:receipt.archive_sha256})+'\n',{flag:'wx'});
    renameSync(temp,target);
    return join(target,'node_modules');
  } finally {
    if(existsSync(temp))rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:200});
  }
}
// Prefer a fully authenticated existing compiler tree before re-extracting
// the same files from an installer with different gzip metadata. Every reused
// candidate is re-hashed with bounded parallel IO. The synchronous path remains
// the sole extractor/legacy validator if no prior verified tree matches.
async function reuseRuntimeToolchainConcurrent(template,userData){
  // Legacy/offline fixtures still ship an unpacked compiler. Retain the
  // existing fail-closed directory check before trying archive-only receipts.
  const legacy=join(template,'node_modules');
  if(existsSync(legacy)){
    const stat=lstatSync(legacy);
    if(!stat.isDirectory()||stat.isSymbolicLink())
      throw Error('Untrusted unpacked Desktop compiler');
    return legacy;
  }
  const {receipt}=archiveReceipt(template);
  const base=join(userData,'runtime-toolchains');
  mkdirSync(base,{recursive:true});
  if(lstatSync(base).isSymbolicLink())throw Error('Linked compiler cache root refused');
  const hashes=[receipt.archive_sha256,
    ...readdirSync(base).filter(name=>HASH.test(name)&&name!==receipt.archive_sha256)];
  for(const sha of hashes){
    const candidate=join(base,sha);
    if(!existsSync(candidate))continue;
    const stat=lstatSync(candidate);
    if(!stat.isDirectory()||stat.isSymbolicLink())
      throw Error('Untrusted linked Desktop compiler cache candidate');
    const marker=join(candidate,'toolchain-cache-receipt.json');
    if(!existsSync(marker)||assertRealFile(marker).size>512){
      if(sha===receipt.archive_sha256)throw Error('Untrusted existing Desktop compiler cache');
      continue;
    }
    let old;
    try{old=JSON.parse(readFileSync(marker,'utf8'));}
    catch{if(sha===receipt.archive_sha256)throw Error('Untrusted existing Desktop compiler cache');continue;}
    if(old.archive_sha256!==sha){
      if(sha===receipt.archive_sha256)throw Error('Untrusted existing Desktop compiler cache');
      continue;
    }
    const expanded=validateExpanded(candidate);
    if(await calculateTreeDigestConcurrent(expanded)===receipt.tree_sha256)
      return expanded;
    if(sha===receipt.archive_sha256)
      throw Error('Desktop compiler cache content digest mismatch');
  }
  return null;
}
// The installed updater is called from Electron's main process. Run the
// complete hash/list/extract/tree-verification transaction in a dedicated
// Node-compatible child so a slow Windows filesystem never freezes Surface.
// This is the SAME cache validator, not a second toolchain implementation.
function ensureRuntimeToolchainIsolated(template,userData){
  return new Promise((resolve,reject)=>{
    if(typeof template!=='string'||!template||
       typeof userData!=='string'||!userData)
      return reject(Error('Explicit Desktop template and profile are required'));
    let child;
    try{
      child=fork(__filename,[template,userData],{
        execPath:process.execPath,execArgv:[],windowsHide:true,
        env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},
        stdio:['ignore','ignore','pipe','ipc'],
      });
    }catch(error){reject(error);return;}
    let response=null,stderr='';
    child.stderr.on('data',bytes=>{
      stderr=(stderr+String(bytes)).slice(-400);
    });
    child.on('message',message=>{
      if(message?.schema==='ordax.desktop-toolchain-worker/1')
        response=message;
    });
    child.once('error',reject);
    child.once('close',code=>{
      if(code===0 && response?.ok===true && typeof response.path==='string')
        resolve(response.path);
      else reject(Error('Verified Desktop toolchain worker failed: '+
        String(response?.error??stderr??'unknown').slice(-400)));
    });
  });
}
if(require.main===module){
  (async()=>{
    try{
      const template=process.argv[2],userData=process.argv[3];
      const path=await reuseRuntimeToolchainConcurrent(template,userData)
        ||ensureRuntimeToolchain(template,userData);
      if(process.send)
        process.send({schema:'ordax.desktop-toolchain-worker/1',ok:true,path},
          ()=>process.disconnect());
      else process.stdout.write(path+'\\n');
    }catch(error){
      process.exitCode=1;
      const message=String(error?.message||error).slice(0,400);
      if(process.send)
        process.send({schema:'ordax.desktop-toolchain-worker/1',ok:false,error:message},
          ()=>process.disconnect());
      else process.stderr.write(message+'\\n');
    }
  })();
}
module.exports={archiveReceipt,ensureRuntimeToolchain,ensureRuntimeToolchainIsolated,assertEntries,calculateTreeDigest,calculateTreeDigestConcurrent};
