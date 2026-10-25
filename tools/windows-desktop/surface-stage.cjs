'use strict';
// Windows-only Git materializer of the canonical pinned Surface source.
// No second visual owner, update policy or runtime; git commit and blob hashes
// are checked before the temporary source is used for a candidate build.
const {spawn} = require('node:child_process');
const {createHash} = require('node:crypto');
const {mkdtempSync,readFileSync,lstatSync,existsSync,mkdirSync,writeFileSync,rmSync} = require('node:fs');
const {join,dirname,sep} = require('node:path');
const {tmpdir} = require('node:os');
const {TextDecoder} = require('node:util');

const SHA40=/^[0-9a-f]{40}$/;
const PATH=/^system\/surface\/(?:ui|workspace)\/[a-zA-Z0-9._/@+\-]+$/;
const MAX_FILES=3000, MAX_FILE_BYTES=8*1024*1024, MAX_ALL_BYTES=96*1024*1024;
const UTF8=new TextDecoder('utf-8',{fatal:true});

function pinnedSourceLock(root) {
  const lock=JSON.parse(readFileSync(join(root,'docs','contracts','surface-source.json'),'utf8'));
  if(lock.$schema!=='prototype-ordax.surface-source/1' ||
     lock.status!=='canonical' ||
     lock.source_repository!=='ordaxsystems/ordax-surface' ||
     !SHA40.test(lock.source_commit) ||
     JSON.stringify(lock.visual_source_paths)!==JSON.stringify(['system/surface/ui','system/surface/workspace'])) {
    throw Error('Untrusted canonical Surface source lock in OS revision');
  }
  return lock;
}

function git(argv,cwd,timeout=120000) {
  return new Promise((resolve,reject)=>{
    const child=spawn('git',argv,{cwd,windowsHide:true,
      env:{...process.env,GIT_TERMINAL_PROMPT:'0'},stdio:['ignore','pipe','pipe']});
    const chunks=[];let size=0,errorText='',done=false,timedOut=false;
    const finish=(error,result)=>{
      if(done)return;done=true;clearTimeout(timer);
      if(error)reject(error);else resolve(result);
    };
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},timeout);
    child.stdout.on('data',b=>{
      size+=b.length;
      if(size>16*1024*1024) {child.kill('SIGTERM');return;}
      chunks.push(b);
    });
    child.stderr.on('data',b=>{errorText=(errorText+String(b)).slice(-300);});
    child.once('error',e=>finish(Error('Pinned Surface Git operation unavailable: '+e.message)));
    child.once('close',code=>finish(timedOut||size>16*1024*1024||code!==0
      ? Error('Pinned Surface Git operation failed or exceeded bound: '+errorText.slice(-100))
      : null,Buffer.concat(chunks)));
  });
}

async function verifyPinnedSource(root,source) {
  const lock=pinnedSourceLock(root);
  const origin=(await git(['-C',source,'config','--get','remote.origin.url'],source,10000)).toString('utf8').trim();
  if(origin!=='https://github.com/'+lock.source_repository+'.git')throw Error('Surface origin is not canonical');
  const head=(await git(['-C',source,'rev-parse','HEAD'],source,10000)).toString('ascii').trim();
  if(head!==lock.source_commit)throw Error('Surface HEAD differs from immutable lock');
  const dirty=await git(['-C',source,'status','--porcelain','--untracked-files=all','--','system/surface/ui','system/surface/workspace'],source,10000);
  if(dirty.length)throw Error('Pinned Surface files are locally modified');
  const listing=await git(['-C',source,'ls-tree','-rz','HEAD','--','system/surface/ui','system/surface/workspace'],source,15000);
  const records=[];let total=0;
  const fingerprint=createHash('sha256');
  const seen=new Set();
  for(const entry of listing.toString('binary').split('\0')) {
    if(!entry)continue;
    const separator=entry.indexOf('\t');
    if(separator<0)throw Error('Malformed canonical Surface Git tree');
    const meta=entry.slice(0,separator).split(' ');
    const name=UTF8.decode(Buffer.from(entry.slice(separator+1),'binary'));
    if(meta.length!==3||!['100644','100755'].includes(meta[0])||meta[1]!=='blob'||
       !SHA40.test(meta[2])||!PATH.test(name)||name.split('/').some(c=>c==='.'||c==='..')||
       seen.has(name))throw Error('Unsafe pinned Surface Git file');
    seen.add(name);
    const file=join(source,...name.split('/'));
    const stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
       stat.size>MAX_FILE_BYTES)throw Error('Unsupported Surface file, link or size');
    const bytes=readFileSync(file);
    total+=bytes.length;
    if(total>MAX_ALL_BYTES || records.length>=MAX_FILES)throw Error('Pinned Surface source exceeds bounds');
    const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    if(blob!==meta[2])throw Error('Pinned Surface bytes differ from Git blob');
    fingerprint.update(Buffer.from(name+'\0','utf8'));
    fingerprint.update(createHash('sha256').update(bytes).digest());
    records.push({name,bytes});
  }
  if(!records.length || !['system/surface/ui/','system/surface/workspace/']
    .every(prefix=>records.some(x=>x.name.startsWith(prefix)))) {
    throw Error('Incomplete canonical Surface source');
  }
  return {lock,records,receipt:{schema:'ordax.surface-source-materialization/1',
    source_repository:lock.source_repository,source_commit:head,
    visual_source_sha256:fingerprint.digest('hex'),file_count:records.length}};
}

async function withVerifiedSurface(root,source,build) {
  const areas=['ui','workspace'].map(name=>join(root,'system','surface',name));
  if(areas.some(p=>existsSync(p)))throw Error('Candidate already includes visual source; duplicate forbidden');
  const {records,receipt}=await verifyPinnedSource(root,source);
  let created=false;
  try {
    created=true;
    for(const {name,bytes} of records) {
      const target=join(root,...name.split('/'));
      mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,bytes,{flag:'wx'});
    }
    return await build(receipt);
  } finally {
    if(created)for(const area of areas)rmSync(area,{recursive:true,force:true});
  }
}
async function withPinnedSurface(root,build) {
  const lock=pinnedSourceLock(root);
  const temporary=mkdtempSync(join(tmpdir(),'ordax-pinned-surface-'));
  const source=join(temporary,'source');
  try{
    await git(['-c','core.autocrlf=false','clone','--config','core.autocrlf=false',
      '--filter=blob:none','--single-branch','--branch','main','--no-tags',
      'https://github.com/'+lock.source_repository+'.git',source],temporary);
    await git(['-C',source,'checkout','--detach',lock.source_commit],temporary);
    return await withVerifiedSurface(root,source,build);
  }finally{rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
}
module.exports={pinnedSourceLock,verifyPinnedSource,withVerifiedSurface,withPinnedSurface};
