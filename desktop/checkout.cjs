'use strict';
// Canonical Native runtime checkout; the bundled snapshot is a safe offline fallback.
const { spawn } = require('node:child_process');
const { dirname, isAbsolute, join, resolve, win32: win32Path } = require('node:path');
const { createHash } = require('node:crypto');
const BUNDLED_GIT_LOCK = require('./git-toolchain-lock.json');
const { existsSync, lstatSync, readFileSync, readlinkSync, symlinkSync } = require('node:fs');

// Windows Desktop Dev prefers an official pinned MinGit in private resources.
function bundledGit({platform=process.platform,resourcesPath=process.resourcesPath,
  toolchainRoot=null,stat=lstatSync,read=readFileSync}={}) {
  if(platform!=='win32')return null;
  if(toolchainRoot===null && (typeof resourcesPath!=='string'||!resourcesPath))return null;
  if(toolchainRoot!==null &&
      (typeof toolchainRoot!=='string'||!win32Path.isAbsolute(toolchainRoot)))
    throw Error('Trusted packaged Git root must be an absolute Windows directory');
  const root=toolchainRoot??win32Path.join(resourcesPath,'runtime-template','toolchain');
  const gitRoot=win32Path.join(root,'git');
  const receiptFile=win32Path.join(root,'git-receipt.json');
  const exe=win32Path.join(gitRoot,'cmd','git.exe');
  const core=win32Path.join(gitRoot,'ucrt64','bin','git.exe');
  let receiptStat=null,rootStat=null;
  try {receiptStat=stat(receiptFile);}catch(error){if(error?.code!=='ENOENT')throw error;}
  try {rootStat=stat(gitRoot);}catch(error){if(error?.code!=='ENOENT')throw error;}
  if(!receiptStat&&!rootStat)throw Error('Packaged Desktop Git missing; refusing system PATH fallback');
  if(!receiptStat?.isFile() || receiptStat.isSymbolicLink() ||
     !rootStat?.isDirectory() || rootStat.isSymbolicLink())
    throw Error('Untrusted bundled Git directory/receipt; refusing fallback');
  const receipt=JSON.parse(read(receiptFile,'utf8'));
  if(receipt?.schema!=='ordax.windows-min-git-receipt/1' ||
     receipt.version!==BUNDLED_GIT_LOCK.version ||
     receipt.archive_sha256!==BUNDLED_GIT_LOCK.sha256 ||
     receipt.git_exe_sha256!==BUNDLED_GIT_LOCK.git_exe_sha256 ||
     receipt.core_exe_sha256!==BUNDLED_GIT_LOCK.core_exe_sha256)
    throw Error('Bundled Git receipt disagrees with canonical source lock');
  for(const dir of [win32Path.join(gitRoot,'cmd'),win32Path.join(gitRoot,'ucrt64'),
                    win32Path.join(gitRoot,'ucrt64','bin')]) {
    const info=stat(dir);
    if(!info.isDirectory() || info.isSymbolicLink())
      throw Error('Bundled Git contains an unsafe directory');
  }
  for(const [file,digest] of [[exe,BUNDLED_GIT_LOCK.git_exe_sha256],
                             [core,BUNDLED_GIT_LOCK.core_exe_sha256]]) {
    const info=stat(file);
    if(!info.isFile() || info.isSymbolicLink())
      throw Error('Bundled Git executable is missing or linked');
    if(createHash('sha256').update(read(file)).digest('hex')!==digest)
      throw Error('Bundled Git executable fails its canonical source lock');
  }
  return exe;
}

// Legacy Desktop Dev must discover an already installed Git even when the
// Electron process PATH was inherited from an installer or Remote session.
// Use absolute system install paths first; never install another Git, invoke
// a shell, or accept an executable path supplied by a remote MCP argument.
function resolveInstalledGit({
  platform=process.platform,env=process.env,stat=lstatSync,
  resourcesPath=process.resourcesPath,read=readFileSync,
}={}){
  if(platform!=="win32")return "git";
  const privateGit=bundledGit({platform,resourcesPath,stat,read});
  if(privateGit)return privateGit;
  const prefixes=[
    env.ProgramW6432,env.ProgramFiles,
    "C:\\Program Files",env["ProgramFiles(x86)"],
    "C:\\Program Files (x86)",
  ];
  const seen=new Set();
  for(const prefix of prefixes){
    if(typeof prefix!=="string"||!win32Path.isAbsolute(prefix))continue;
    const path=win32Path.join(prefix,"Git","cmd","git.exe");
    const key=path.toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);
    try {
      const file=stat(path);
      if(file.isFile()&&!file.isSymbolicLink())return path;
    }catch {}
  }
  // Portable/managed Git installations remain supported when present in PATH.
  return "git";
}

function git(argv, cwd, timeoutMs = 90000, maxStdoutBytes = 1024) {
  // The default diagnostic output is small. A Git diff used to skip a
  // Native build must instead capture every path, or report failure:
  // silently keeping only the last 1024 bytes could hide a changed owner.
  if (!Number.isInteger(maxStdoutBytes) || maxStdoutBytes < 1024 ||
      maxStdoutBytes > 65536) throw new RangeError('Invalid bounded Git stdout limit');
  return new Promise(resolve => {
    let stdout = '', stderr = '', finished = false, stdoutBytes = 0;
    // This updater accesses the public, immutable OrdaX OS source only.
// Global Git Credential Manager / gh auth helpers can block for minutes
// even on anonymous reads, exceeding the 25s discovery deadline. Empty
// credential.helper overrides all inherited helpers for this invocation;
// never prompt or forward an account credential to a public checkout.
let child;
    try {
      child = spawn(resolveInstalledGit(), ['-c','credential.helper=',...argv], {
        cwd, windowsHide:true, env: { ...process.env, GIT_TERMINAL_PROMPT:'0' },
        stdio:['ignore','pipe','pipe']
      });
    } catch(error) {
      resolve({ok:false,stdout:'',stderr:'Bundled Git unavailable: '+error.message});
      return;
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', b => {
      stdoutBytes += b.length;
      stdout = (stdout + b.toString()).slice(-maxStdoutBytes);
    });
    child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-1024); });
    const finish = ok => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      resolve({ ok:ok && (maxStdoutBytes === 1024 || stdoutBytes <= maxStdoutBytes),
        stdout:stdout.trim(), stderr:stderr.trim() });
    };
    child.on('error', () => finish(false));
    child.on('close', code => finish(code === 0));
  });
}

async function isTrusted(checkout) {
  // Only trust validation needs the OS distribution authority. Keep that
  // dependency lazy so cache/staging source tests do not require a packaged
  // runtime-template or a sibling OS checkout merely to import this module.
  const { OFFICIAL_REMOTE } = require('./runtime.cjs');
  const origin = await git(['-C',checkout,'config','--get','remote.origin.url'],checkout,10000);
  return origin.ok && origin.stdout === OFFICIAL_REMOTE;
}

function hasDesktopHostContract(root) {
  try {
    const path = join(root,'tools','windows-emulator','desktop-host-contract.json');
    const manifest = JSON.parse(readFileSync(path,'utf8'));
    const capabilities = manifest?.desktopHost?.capabilities;
    return manifest.schema === 1
      && manifest.desktopHost.contractVersion === 1
      && manifest.desktopHost.nativeSource === 'system/composition/native/index.html'
      && Array.isArray(capabilities)
      && ['no-external-browser','dynamic-loopback-port','external-state-directory']
        .every(feature => capabilities.includes(feature))
      && existsSync(join(root,'tools','windows-emulator','dev-supervisor.mjs'))
      && existsSync(join(root,'system','composition','native','index.html'));
  } catch { return false; }
}

function dependencies(checkout,template,userData=null) {
  const dir=join(checkout,'node_modules');
  if (existsSync(dir)) return dir;
  const {ensureRuntimeToolchain}=require('./toolchain-cache.cjs');
  const source=ensureRuntimeToolchain(template,userData);
  symlinkSync(source,dir,process.platform==='win32'?'junction':'dir');
  return dir;
}

// Staging must never run a 13k-file archive expansion or full tree hash
// synchronously inside Electron's main event loop. Share the exact verifier
// used by the legacy fallback, but execute it in a separate Node process.
async function dependenciesForStage(checkout,template,userData){
  const dir=join(checkout,'node_modules');
  // Vite executes from the VERIFIED toolchain directory, not through the
  // candidate junction. Existing links are never trusted by type alone:
  // verify the canonical cache first and require this junction to target it.
  // Node realpathSync/existsSync can fail while following Windows junctions
  // on supported Owner machines, so inspect the reparse point with lstat and
  // compare its explicit readlink target without traversing it.
  const linkStat=()=>{
    try{return lstatSync(dir)}
    catch(error){if(error?.code==='ENOENT')return null;throw error}
  };
  const assertJunction=stat=>{
    if(!stat?.isSymbolicLink())
      throw Error('Staged compiler dependency is not a junction');
  };
  let stat=linkStat();
  if(stat)assertJunction(stat);
  const {ensureRuntimeToolchainIsolated}=require('./toolchain-cache.cjs');
  const source=await ensureRuntimeToolchainIsolated(template,userData);
  const normalized=path=>{
    const absolute=resolve(path);
    return process.platform==='win32'?absolute.toLowerCase():absolute;
  };
  const mountedTarget=current=>{
    assertJunction(current);
    const link=readlinkSync(dir);
    const target=isAbsolute(link)?link:resolve(dirname(dir),link);
    if(normalized(target)!==normalized(source))
      throw Error('Staged compiler dependency does not match verified cache');
    return source;
  };
  stat=linkStat();
  if(stat)return mountedTarget(stat);
  symlinkSync(source,dir,process.platform==='win32'?'junction':'dir');
  return mountedTarget(linkStat());
}

// Only the immutable Desktop Dev transaction manager may materialize source
// updates. This helper never merges a Git checkout in place.
module.exports = {git, bundledGit, resolveInstalledGit, isTrusted, hasDesktopHostContract, dependencies, dependenciesForStage};
