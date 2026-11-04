#!/usr/bin/env node
'use strict';
// A disposable, Git-committed-only handoff of the Windows Electron owner.
// Native OS, Surface, model and runtime resources never enter this archive.
const fs=require('node:fs');
const {join,resolve,dirname,isAbsolute}=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const SHA40=/^[0-9a-f]{40}$/;
const SCHEMA='ordax.desktop-owner-source-export/1';
const SHELL_PATH='tools/windows-desktop';
const MAX_FILES=200;
const MAX_ARCHIVE_BYTES=64*1024*1024;
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');
function command(program,args,options={}){
  const p=spawnSync(program,args,{encoding:'utf8',windowsHide:true,timeout:60000,
    maxBuffer:8*1024*1024,...options});
  if(p.error||p.status!==0)throw Error('Desktop owner Git export failed: '+
    (p.error?.message||String(p.stderr).slice(-300)||'nonzero exit code'));
  return p.stdout;
}
function ensureDirectory(directory){
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())
    throw Error('Unsafe Desktop handoff directory: '+directory);
}
function git(root,...args){return command('git',['-C',root,...args]).trim();}
function cleanEntry(path){
  return !!path && !isAbsolute(path) && !path.includes('\\') &&
    !path.split('/').some(x=>x===''||x==='.'||x==='..') &&
    !path.split('/').some(x=>['node_modules','.git','out'].includes(x));
}
function exportDesktopOwner({sourceRoot,osSha,outputRoot}={}){
  if(!SHA40.test(osSha))throw Error('Exact OS commit SHA required for Desktop owner export');
  const root=resolve(sourceRoot||join(__dirname,'../..'));
  ensureDirectory(root);
  const out=resolve(outputRoot||join(root,'out','windows-desktop-owner-export'));
  const allowed=join(root,'out');
  if(dirname(out)!==allowed)throw Error('Desktop owner export must remain in the OS out directory');
  if(fs.existsSync(out))throw Error('Desktop owner export already exists; refuse overwrite');
  if(git(root,'rev-parse','HEAD')!==osSha)throw Error('OS checkout diverges from requested Desktop owner export SHA');
  const origin=git(root,'remote','get-url','origin');
  if(!/^(?:https:\/\/github[.]com\/|git@github[.]com:|ssh:\/\/git@github[.]com\/)ordaxsystems\/ordax-os(?:[.]git)?$/i.test(origin))
    throw Error('Desktop owner export requires canonical ordax-os origin');
  if(git(root,'rev-parse','--show-prefix')!=='')
    throw Error('Desktop owner export requires repository root');
  const tree=git(root,'rev-parse',osSha+':'+SHELL_PATH);
  if(!SHA40.test(tree))throw Error('Desktop owner source tree hash unavailable');
  const rows=command('git',['-C',root,'ls-tree','-rz',osSha+':'+SHELL_PATH]).split('\0').filter(Boolean);
  if(rows.length<10||rows.length>MAX_FILES)throw Error('Unexpected number of Desktop owner source files');
  const files=rows.map(row=>{
    const match=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(row);
    if(!match||!cleanEntry(match[3]))throw Error('Unsafe or untracked Desktop owner source tree entry');
    return {path:match[3],git_blob_sha:match[2]};
  });
  const keys=new Set();
  for(const file of files){
    const key=file.path.toLowerCase();
    if(keys.has(key))throw Error('Windows case-fold collision in Desktop owner export');
    keys.add(key);
  }
  if(!keys.has('package.json')||!keys.has('package-lock.json')||
     !keys.has('main.cjs')||!keys.has('installer.nsh'))
    throw Error('Canonical Electron owner entrypoints absent from Git tree');
  fs.mkdirSync(allowed,{recursive:true});
  ensureDirectory(allowed);
  const temp=fs.mkdtempSync(join(allowed,'.ordax-desktop-owner-export-'));
  try{
    const archive=join(temp,'ordax-desktop-source.tar.gz');
    // Git for Windows can apply core.autocrlf to archive payloads. Disable
    // checkout EOL conversion for this one read-only archive operation.
    command('git',['-C',root,'-c','core.autocrlf=false','archive',
      '--format=tar.gz','--output='+archive,osSha+':'+SHELL_PATH]);
    const stat=fs.lstatSync(archive);
    if(!stat.isFile()||stat.size<100||stat.size>MAX_ARCHIVE_BYTES)
      throw Error('Detached Desktop source archive exceeds safe size bounds');
    // Verify the exported tree inventory independently of the Git index.
    const listed=command('tar',['-tzf',archive]).split(/\r?\n/).filter(Boolean)
      .map(p=>p.replace(/^\.\//,'')).filter(p=>!p.endsWith('/')).sort();
    const expected=files.map(f=>f.path).sort();
    if(JSON.stringify(listed)!==JSON.stringify(expected))
      throw Error('Desktop owner archive files diverge from committed Git tree');
    // Do not rely on tar names alone: check extracted bytes against exact Git
    // blob objects, even when OS attributes or Windows EOL rules would convert.
    const inspection=join(temp,'.inspect-extracted-git-blobs');
    fs.mkdirSync(inspection);
    try {
      command('tar',['-xzf',archive,'-C',inspection]);
      let extractedBytes=0;
      for(const file of files){
        const source=join(inspection,...file.path.split('/'));
        const st=fs.lstatSync(source);
        if(!st.isFile()||st.isSymbolicLink()||st.size>8*1024*1024)
          throw Error('Unsafe extracted Desktop owner source file');
        extractedBytes+=st.size;
        if(extractedBytes>64*1024*1024)
          throw Error('Desktop owner source exceeds extracted byte bound');
        const bytes=fs.readFileSync(source);
        const gitObject=createHash('sha1')
          .update('blob '+bytes.length+'\0').update(bytes).digest('hex');
        if(gitObject!==file.git_blob_sha)
          throw Error('Desktop owner archive bytes differ from committed Git blob: '+file.path);
      }
    }finally{fs.rmSync(inspection,{recursive:true,force:true});}
    const receipt={schema:SCHEMA,os_repository:'ordaxsystems/ordax-os',os_sha:osSha,
      source_tree_sha:tree,source_prefix:SHELL_PATH,
      proposed_owner:'ordaxsystems/ordax-desktop',
      archive:'ordax-desktop-source.tar.gz',archive_sha256:sha256(fs.readFileSync(archive)),
      file_count:files.length,files};
    fs.writeFileSync(join(temp,'owner-export-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    fs.renameSync(temp,out);
    return {directory:out,files:files.length,os_sha:osSha,source_tree_sha:tree,
      archive_sha256:receipt.archive_sha256};
  }catch(error){fs.rmSync(temp,{recursive:true,force:true});throw error;}
}
if(require.main===module){
  try{
    if(process.argv.length!==3)throw Error('Usage: node owner-export.cjs <exact-OS-SHA>');
    const result=exportDesktopOwner({osSha:process.argv[2]});
    process.stdout.write('ORDAX_DESKTOP_OWNER_SOURCE_EXPORT=VERIFIED '+result.os_sha+
      ' files='+result.files+' tree='+result.source_tree_sha+'\n');
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
module.exports={exportDesktopOwner};
