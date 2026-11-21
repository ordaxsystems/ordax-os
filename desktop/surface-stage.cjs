'use strict';
// Same-commit Surface verifier for the canonical OS checkout; never clones.
const {spawn,execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {readFileSync,lstatSync}=require('node:fs');
const {join}=require('node:path');
const {resolveInstalledGit}=require('./checkout.cjs');
const SHA40=/^[a-f0-9]{40}$/;
const PATH=/^system\/surface\/(?:ui|workspace)\/[A-Za-z0-9._/@+\-]+$/;
const LIMIT_FILES=3000, LIMIT_BYTES=96*1024*1024;
class SurfaceSourceContractError extends Error {
  constructor(msg){super(msg);this.code='ORDAX_SURFACE_SOURCE_INCOMPATIBLE'}
}
function pinnedSourceLock(root){
  const lock=JSON.parse(readFileSync(join(root,'docs/contracts/surface-source.json'),'utf8'));
  if(lock.$schema!=='prototype-ordax.surface-source/2' ||
    lock.status!=='canonical' || lock.source_repository!=='ordaxsystems/ordax-os' ||
    lock.source_ref!=='same-commit' || lock.source_policy!=='tracked-git-blobs-only' ||
    JSON.stringify(lock.visual_source_paths)!==
      JSON.stringify(['system/surface/ui','system/surface/workspace']))
    throw new SurfaceSourceContractError('Canonical OS same-commit Surface contract required');
  return lock;
}
function git(root,args,timeout=20000,input=null,maxBytes=2*1024*1024){
  return new Promise((resolve,reject)=>{
    const child=spawn(resolveInstalledGit(),['-c','credential.helper=','-C',root,...args],{
      cwd:root,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'},
      stdio:[input===null?'ignore':'pipe','pipe','pipe']});
    if(input!==null)child.stdin.end(input);
    const chunks=[];let total=0,tail='',done=false;
    const timer=setTimeout(()=>{child.kill();finish(Error('Bounded source Git timeout'))},timeout);
    function finish(error,data){if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(data)}
    child.stdout.on('data',b=>{total+=b.length;if(total>maxBytes)child.kill();else chunks.push(b)});
    child.stderr.on('data',b=>tail=(tail+String(b)).slice(-240));
    child.once('error',e=>finish(e));
    child.once('close',code=>finish(code===0&&total<=maxBytes?null:
      new SurfaceSourceContractError('Canonical OS Git proof unavailable: '+tail),Buffer.concat(chunks)));
  });
}
async function verifyPinnedSource(root){
  const lock=pinnedSourceLock(root);
  const origin=(await git(root,['config','--get','remote.origin.url'])).toString().trim();
  if(!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)ordaxsystems\/ordax-os(?:\.git)?$/i.test(origin))
    throw new SurfaceSourceContractError('Untrusted OS Git origin');
  const head=(await git(root,['rev-parse','HEAD'])).toString().trim();
  if(!SHA40.test(head))throw new SurfaceSourceContractError('OS source SHA invalid');
  const paths=lock.visual_source_paths;
  const dirty=await git(root,['status','--porcelain','--untracked-files=all','--',...paths]);
  if(dirty.length)throw new SurfaceSourceContractError('Surface source differs from same OS commit');
  const inventory=await git(root,['ls-tree','-rz',head,'--',...paths]);
  const seen=new Set(), fingerprint=createHash('sha256'), metas=[];
  for(const record of inventory.toString('binary').split('\0')){
    if(!record)continue;
    const tab=record.indexOf('\t');
    if(tab<0)throw new SurfaceSourceContractError('Invalid Surface tree entry');
    const [mode,type,sha]=record.slice(0,tab).split(' ');
    const name=Buffer.from(record.slice(tab+1),'binary').toString('utf8');
    if(!['100644','100755'].includes(mode)||type!=='blob'||!SHA40.test(sha)||
      !PATH.test(name)||name.split('/').some(s=>!s||s==='.'||s==='..')||
      seen.has(name))throw new SurfaceSourceContractError('Unsafe same-commit Surface tree');
    seen.add(name);
    const parts=name.split('/');
    for(let n=1;n<parts.length;n++){
      const st=lstatSync(join(root,...parts.slice(0,n)));
      if(!st.isDirectory()||st.isSymbolicLink())
        throw new SurfaceSourceContractError('Linked Surface ancestor');
    }
    const st=lstatSync(join(root,...parts));
    if(!st.isFile()||st.isSymbolicLink()||st.size>8*1024*1024)
      throw new SurfaceSourceContractError('Linked or oversized Surface blob');
    metas.push({name,sha});
    if(metas.length>LIMIT_FILES)throw new SurfaceSourceContractError('Surface file limit');
  }
  const input=Buffer.from(metas.map(x=>x.sha).join('\n')+'\n');
  const objects=await git(root,['cat-file','--batch'],60000,input,LIMIT_BYTES+LIMIT_FILES*100);
  let cursor=0,total=0,count=0;
  for(const {name,sha} of metas){
    const eol=objects.indexOf(10,cursor);
    if(eol<0)throw new SurfaceSourceContractError('Malformed Git batch response');
    const match=/^([a-f0-9]{40}) blob ([0-9]+)$/.exec(objects.toString('ascii',cursor,eol));
    if(!match||match[1]!==sha)throw new SurfaceSourceContractError('Wrong Git blob identity');
    const length=Number(match[2]),begin=eol+1,end=begin+length;
    if(!Number.isSafeInteger(length)||length>8*1024*1024||
      end>=objects.length||objects[end]!==10)
      throw new SurfaceSourceContractError('Unsafe Git batch blob size');
    const blob=objects.subarray(begin,end);
    if(createHash('sha1').update('blob '+length+'\0').update(blob).digest('hex')!==sha)
      throw new SurfaceSourceContractError('Git blob digest mismatch');
    total+=length;count++;
    if(total>LIMIT_BYTES)throw new SurfaceSourceContractError('Surface bytes limit');
    fingerprint.update(Buffer.from(name+'\0','utf8'));
    fingerprint.update(createHash('sha256').update(blob).digest());
    cursor=end+1;
  }
  if(cursor!==objects.length)throw new SurfaceSourceContractError('Unclaimed Git batch bytes');
  if(!count||!paths.every(p=>[...seen].some(x=>x.startsWith(p+'/'))))
    throw new SurfaceSourceContractError('Incomplete same-commit Surface tree');
  return {lock,receipt:{$schema:'ordax.surface-source-materialization/2',
    source_repository:lock.source_repository,source_commit:head,paths,
    file_count:count,visual_source_sha256:fingerprint.digest('hex'),
    source_only:true,live_os_mutated:false}};
}
async function withPinnedSurface(root,build){
  const {receipt}=await verifyPinnedSource(root);
  return build(receipt);
}
function sourceCommit(root) {
  const sha=execFileSync(resolveInstalledGit(),['-C',root,'rev-parse','HEAD'],{
    encoding:'utf8',windowsHide:true,timeout:15000,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
  }).trim();
  if(!SHA40.test(sha))throw new SurfaceSourceContractError('OS revision invalid');
  return sha;
}
module.exports={SurfaceSourceContractError,pinnedSourceLock,verifyPinnedSource,withPinnedSurface,sourceCommit};
