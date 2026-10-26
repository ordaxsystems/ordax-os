'use strict';
// A single canonical npm lock yields one archived, content-bound Windows
// Dev compiler. Never install packages, fetch from npm or modify Program Files
// on a user's machine. Expanded files are a disposable per-user cache.
const {existsSync,mkdirSync,lstatSync,readFileSync,readdirSync,mkdtempSync,writeFileSync,renameSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const HASH=/^[a-f0-9]{64}$/;
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
    !Number.isSafeInteger(receipt.installed_packages)||receipt.installed_packages<1)
    throw Error('Untrusted canonical Desktop toolchain receipt');
  const archive=join(directory,receipt.archive);
  if(assertRealFile(archive).size!==receipt.archive_size ||
      digest(readFileSync(archive))!==receipt.archive_sha256)
    throw Error('Desktop toolchain archive digest mismatch');
  return {archive,receipt};
}
function tar(args,timeout=180000){
  const run=spawnSync('tar',args,{windowsHide:true,encoding:'utf8',
    timeout,maxBuffer:32*1024*1024});
  if(run.error||run.status!==0)throw Error('Canonical Desktop toolchain extraction rejected: '+(run.error?.message||String(run.stderr||'').slice(-250)));
  return run.stdout;
}
function assertEntries(archive){
  const entries=tar(['-tzf',archive],45000).trim().split(/\r?\n/);
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
  const verbose=tar(['-tvzf',archive],45000).trim().split(/\r?\n/);
  if(verbose.length!==entries.length ||
      verbose.some(line=>!['-','d'].includes(line[0])))
    throw Error('Unsupported Desktop toolchain archive link or device');
}
function validateExpanded(root){
  const nodeModules=join(root,'node_modules');
  if(!lstatSync(nodeModules).isDirectory())throw Error('Missing expanded dependency root');
  const queue=[nodeModules];let count=0;
  while(queue.length){
    const directory=queue.pop();
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      const item=join(directory,entry.name),stat=lstatSync(item);
      if(stat.isSymbolicLink())throw Error('Linked Desktop compiler entry is forbidden');
      if(stat.isDirectory())queue.push(item);
      else if(!stat.isFile())throw Error('Unsupported Desktop compiler filesystem entry');
      if(++count>65000)throw Error('Oversized Desktop compiler tree');
    }
  }
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
    if(!existsSync(marker)||assertRealFile(marker).size>512||
      JSON.parse(readFileSync(marker,'utf8')).archive_sha256!==receipt.archive_sha256)
      throw Error('Untrusted existing Desktop compiler cache');
    return validateExpanded(target);
  }
  assertEntries(archive);
  const temp=mkdtempSync(join(base,'.extract-'));
  try{
    tar(['-xzf',archive,'-C',temp]);
    const ready=validateExpanded(temp);
    writeFileSync(join(temp,'toolchain-cache-receipt.json'),
      JSON.stringify({archive_sha256:receipt.archive_sha256})+'\n',{flag:'wx'});
    renameSync(temp,target);
    return join(target,'node_modules');
  } finally {
    if(existsSync(temp))rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:200});
  }
}
module.exports={archiveReceipt,ensureRuntimeToolchain,assertEntries};
