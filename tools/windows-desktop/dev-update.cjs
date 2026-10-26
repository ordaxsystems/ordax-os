'use strict';
// Windows-only materializer of the canonical Owner/Development main source.
// Never rewrites a running tree. Only exact verified, clean, immutable versions
// can become boot candidates. MVP/Stable must not use this Git channel.
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { join, basename, dirname } = require('node:path');
const { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, lstatSync, existsSync, unlinkSync, openSync, closeSync, fsyncSync } = require('node:fs');
const { OFFICIAL_REMOTE } = require('./runtime.cjs');
const { git, isTrusted, hasDesktopHostContract, dependencies } = require('./checkout.cjs');
const { hasNativeBundle, buildNativeCandidate, verifyBundledNativeReceipt } = require('./native-build.cjs');
const { prepareWindowsGitDeletion } = require('./git-cleanup.cjs');

const SHA_RE = /^[0-9a-f]{40}$/;
const CHANNEL_SCHEMA = 'ordax.desktop-dev-update-state/1';
const STATE_FILENAME = 'desktop-dev-update-state.json';
const VERSIONS_DIR = 'runtime-versions';
const DEFAULT_STATE = Object.freeze({
  schema: CHANNEL_SCHEMA, activeSha: null, previousSha: null,
  pendingSha: null, attemptedSha: null, pinnedSha: null, rejectedSha: null,
  incompatibleSha: null,
});

function shaOrNull(value) {
  return value === null || (typeof value === 'string' && SHA_RE.test(value));
}
function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schema !== CHANNEL_SCHEMA ||
      !['activeSha','previousSha','pendingSha','attemptedSha','pinnedSha','rejectedSha'].every(
        field => shaOrNull(value[field])
      ) || !shaOrNull(value.incompatibleSha ?? null)) {
    throw Error('Untrusted Desktop Dev update state; refusing update');
  }
  if (value.pinnedSha && value.pinnedSha !== value.activeSha) {
    throw Error('Pinned Desktop Dev SHA must match the running source');
  }
  if (value.pendingSha && value.pendingSha === value.activeSha) {
    throw Error('A running source cannot be staged as an update');
  }
  if (value.attemptedSha && value.attemptedSha !== value.pendingSha) {
    throw Error('Desktop Dev attempted SHA is not the pending SHA');
  }
  return Object.freeze({
    schema: CHANNEL_SCHEMA,
    activeSha: value.activeSha, previousSha: value.previousSha,
    pendingSha: value.pendingSha, attemptedSha: value.attemptedSha,
    pinnedSha: value.pinnedSha, rejectedSha: value.rejectedSha,
    // A previously persisted v1 state may not have this optional field.
    incompatibleSha: value.incompatibleSha ?? null,
  });
}
function statePath(userData) { return join(userData, STATE_FILENAME); }
function readState(userData) {
  const path = statePath(userData);
  if (!existsSync(path)) return { ...DEFAULT_STATE };
  if (!lstatSync(path).isFile()) throw Error('Desktop update state is not a regular file');
  return validateState(JSON.parse(readFileSync(path, 'utf8')));
}
function writeState(userData, state) {
  const value = validateState(state);
  mkdirSync(userData, { recursive: true });
  const path = statePath(userData), tmp = path + '.' + randomUUID() + '.tmp';
  let descriptor = null;
  try {
    descriptor = openSync(tmp, 'wx', 0o600);
    writeFileSync(descriptor, JSON.stringify(value) + '\n');
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = null;
    renameSync(tmp, path);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
  return value;
}

const CANDIDATE_NAME = /^\.candidate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TRANSIENT_DELETE_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
function removeOwnedCandidate(candidate) {
  if (basename(dirname(candidate)) !== VERSIONS_DIR ||
      !CANDIDATE_NAME.test(basename(candidate))) {
    throw Error('Unsafe Desktop candidate cleanup path');
  }
  if (!existsSync(candidate)) return {removed:true};
  const stat = lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw Error('Desktop candidate cleanup refused non-directory or link');
  }
  let phase='prepare';
  try {
    prepareWindowsGitDeletion(join(candidate,'.git'));
    // Verified candidates borrow installed Vite via a Windows directory
    // junction at node_modules. Node/Electron recursive deletion of its
    // parent can traverse the reparse point and erase the shared toolchain.
    // Unlink the junction ITSELF first; never recurse into its target.
    phase='detach-runtime';
    const dependencyMount=join(candidate,'node_modules');
    let mounted=null;
    try { mounted=lstatSync(dependencyMount); }
    catch(error){ if(error?.code!=='ENOENT')throw error; }
    if(mounted) {
      if(!mounted.isSymbolicLink()) {
        throw Error('Unsafe Desktop candidate node_modules: expected a removable runtime junction');
      }
      unlinkSync(dependencyMount);
    }
    phase='remove';
    rmSync(candidate,{recursive:true,force:true,maxRetries:10,retryDelay:200});
    return {removed:!existsSync(candidate)};
  } catch(error) {
    if (!TRANSIENT_DELETE_ERRORS.has(error?.code)) throw error;
    return {removed:false,code:error.code,phase};
  }
}
// A bounded maintenance pass runs on later update checks. It deletes only
// aged, unpromoted candidate UUIDs. Active/previous/pending SHA directories,
// unrelated user files and links are never traversed or removed.
function sweepStaleCandidates(userData, {now=Date.now(),minAgeMs=120000,log=()=>{}}={}) {
  const dir=join(userData,VERSIONS_DIR);
  const result={removed:0,deferred:0};
  if (!existsSync(dir)) return result;
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    if (!entry.isDirectory() || !CANDIDATE_NAME.test(entry.name)) continue;
    const candidate=join(dir,entry.name);
    const stat=lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        now-stat.mtimeMs < minAgeMs) continue;
    const attempt=removeOwnedCandidate(candidate);
    if (attempt.removed) result.removed++;
    else {
      result.deferred++;
      log('Deferred stale Desktop Git candidate cleanup: '+entry.name+' '+attempt.code+' phase='+attempt.phase);
    }
  }
  return result;
}

// A packaged Desktop already contains an immutable, source-bound Native bundle.
// Recompiling the *same* revision as a Git candidate is unnecessary and can
// even create a new trial/rollback transaction for a no-op update. Treat the
// bundle as current only after validating the existing provenance AND bytes.
// Never use this comparison to override a previously activated Git revision.
function verifiedBundledSourceSha(template) {
  const assets=join(template,'desktop-assets');
  if (!verifyBundledNativeReceipt(template,assets)) return null;
  try {
    const receipt=JSON.parse(readFileSync(join(assets,'source-provenance.json'),'utf8'));
    return SHA_RE.test(receipt.os_sha) ? receipt.os_sha : null;
  } catch { return null; }
}

function versionRoot(userData, sha) {
  if (!SHA_RE.test(sha)) throw Error('Invalid runtime version SHA');
  return join(userData, VERSIONS_DIR, sha);
}
async function verifiedVersion(userData, sha, template) {
  if (!sha) return null;
  const path = versionRoot(userData, sha);
  if (!existsSync(path) || !lstatSync(path).isDirectory()) return null;
  if (!await isTrusted(path) || !hasDesktopHostContract(path) || !hasNativeBundle(path)) return null;
  const head = await git(['-C',path,'rev-parse','HEAD'],path,10000);
  if (!head.ok || head.stdout !== sha) return null;
  const clean = await git(['-C',path,'status','--porcelain=v1','--untracked-files=all'],path,10000);
  if (!clean.ok || clean.stdout) return null;
  // A compiled verified version never needs Vite at boot. Resolve the
  // optional compiler cache only for a real build or legacy Vite fallback.
  return path;
}

// Same durable First Run gate as Owner/Development USB's ordax-main-watch.
// Windows Native already stores the canonical firstRun record under the
// host-owned native-state directory. Reuse the OS validator rather than
// redefining what "completed" means in Electron or inventing an OOBE marker.
async function desktopFirstRunComplete(userData,template){
  const file=join(userData,'native-state','native-state.json');
  try{
    if(!lstatSync(file).isFile())return false;
    const saved=JSON.parse(readFileSync(file,'utf8'));
    const validator=join(template,'system','contracts','first-run-state-store.mjs');
    const {validateFirstRunState}=await import(pathToFileURL(validator).href);
    return validateFirstRunState(saved.firstRun).completed===true;
  }catch{
    // An old bundled snapshot or corrupt OOBE state must NEVER break the
    // known-good offline Native boot. Refuse the update, not the application.
    // The existing Native state owner remains responsible for diagnostics.
    return false;
  }
}

// Do not start network I/O during app boot. A prepared candidate gets only
// one trial; if no health receipt was durably written, next boot falls back.
async function chooseBootVersion({ userData, template, log = () => {}, allowPendingTrial = true }) {
  const state = readState(userData);
  if (state.pendingSha && !state.attemptedSha && !allowPendingTrial) {
    log('Staged Desktop candidate held until canonical First Run is completed');
  } else if (state.pendingSha && !state.attemptedSha) {
    const candidate = await verifiedVersion(userData,state.pendingSha,template);
    if (candidate) {
      writeState(userData,{ ...state, attemptedSha: state.pendingSha });
      log('Trying staged Desktop Dev candidate ' + state.pendingSha.slice(0,12));
      return { root: candidate, sha: state.pendingSha, trial: true };
    }
    log('Staged Desktop candidate missing or untrusted; reverting to last known-good');
    writeState(userData,{ ...state, pendingSha:null,attemptedSha:null,rejectedSha:state.pendingSha });
  } else if (state.pendingSha) {
    log('Previous Desktop candidate boot had no health receipt; reverting to last known-good');
    writeState(userData,{ ...state, pendingSha:null,attemptedSha:null,rejectedSha:state.pendingSha });
  }
  const updated = readState(userData);
  const active = await verifiedVersion(userData,updated.activeSha,template);
  if (active) return {root:active,sha:updated.activeSha,trial:false};
  if (updated.activeSha) log('Last active Desktop Dev source unavailable; using immutable bundled fallback');
  return {root:template,sha:null,trial:false};
}
function confirmHealthy(userData, sha) {
  const state = readState(userData);
  if (!sha || state.pendingSha !== sha || state.attemptedSha !== sha) {
    throw Error('Desktop candidate health does not match the attempted commit');
  }
  return writeState(userData,{...state,activeSha:sha,previousSha:state.activeSha,
    pendingSha:null,attemptedSha:null,rejectedSha:null});
}
function rejectCandidate(userData, sha) {
  const state = readState(userData);
  if (!sha || state.pendingSha !== sha) return false;
  writeState(userData,{...state,pendingSha:null,attemptedSha:null,rejectedSha:sha});
  return true;
}
async function pinPrevious(userData,template) {
  const state = readState(userData);
  if (!state.previousSha) throw Error('No previous verified Desktop Dev source for rollback');
  if (!await verifiedVersion(userData,state.previousSha,template)) {
    throw Error('Previous Desktop Dev source failed verification; rollback refused');
  }
  return writeState(userData,{...state,activeSha:state.previousSha,
    previousSha:state.activeSha, pendingSha:null,attemptedSha:null,
    pinnedSha:state.previousSha});
}
function unpin(userData) {
  const state = readState(userData);
  return writeState(userData,{...state,pinnedSha:null});
}

// Owner/Development Git-main (ordax-pull) can prepare a new Native tree
// while the Windows app is running. Promotion still belongs exclusively to
// chooseBootVersion + confirmHealthy on the next Electron launch. Re-launch
// the app only during a genuine period of inactivity, never restart Windows
// or interrupt an actively used Surface to consume a staged update.
function shouldAutoActivate(state,{idleSeconds,windowVisible,windowFocused}={}){
  if(!state || !SHA_RE.test(state.pendingSha??'') ||
     state.attemptedSha || state.pinnedSha ||
     !Number.isFinite(idleSeconds) || idleSeconds<0) return false;
  if(windowVisible===false)return idleSeconds>=60;
  if(windowFocused===false)return idleSeconds>=120;
  return idleSeconds>=600;
}

// Serialize the idle handoff in the existing Desktop Dev transaction owner.
// OOBE is asynchronous: the user may roll back, another poll may stage a new
// SHA, or system activity may resume while its receipt is being read. Never
// use a stale state/snapshot to relaunch Electron or schedule two relaunches.
// Electron's OS idle timer describes the entire machine, not attention to
// OrdaX. An inactive/minimized window can safely accept its prepared Git
// revision even when the person is using another application or a remote
// session does not publish meaningful global idle seconds. Foreground OrdaX
// still requires actual OS idle time. A monotonic per-window clock, reset on
// focus/show/restore, prevents instant relaunch on mere minimization.
function createDesktopWindowIdleTracker({now=()=>performance.now()}={}){
  if(typeof now!=='function')throw new TypeError('Monotonic Desktop clock required');
  let inactiveSince=null;
  const tick=()=>{
    const current=now();
    if(!Number.isFinite(current))throw new TypeError('Invalid monotonic Desktop clock');
    return current;
  };
  return Object.freeze({
    onAttention:()=>{inactiveSince=null;},
    onBackground:()=>{if(inactiveSince===null)inactiveSince=tick();},
    snapshot:({windowVisible,windowFocused,windowMinimized,systemIdleSeconds})=>{
      const hidden=windowVisible===false || windowMinimized===true;
      if(!hidden && windowFocused===true){
        inactiveSince=null;
        return {windowVisible:true,windowFocused:true,idleSeconds:systemIdleSeconds};
      }
      const current=tick();
      if(inactiveSince===null)inactiveSince=current;
      return {
        windowVisible:!hidden,
        windowFocused:false,
        idleSeconds:Math.max(0,(current-inactiveSince)/1000),
      };
    },
  });
}

function createDesktopIdleActivation({
  userData,template,isReady,getIdleSnapshot,relaunch,log=()=>{},
  read=readState,firstRunComplete=desktopFirstRunComplete,
}){
  if(typeof isReady!=='function' || typeof getIdleSnapshot!=='function' ||
     typeof relaunch!=='function' || typeof read!=='function' ||
     typeof firstRunComplete!=='function')throw new TypeError('Desktop idle activation needs trusted lifecycle ports');
  let checking=false,requested=false;
  return async function activateWhenIdle(){
    if(checking || requested || !isReady())return false;
    checking=true;
    try{
      const prior=read(userData);
      if(!shouldAutoActivate(prior,getIdleSnapshot()))return false;
      if(!await firstRunComplete(userData,template))return false;
      // Recheck ALL mutable prerequisites after the asynchronous OOBE read.
      const latest=read(userData);
      if(!isReady() || latest.pendingSha!==prior.pendingSha ||
         !shouldAutoActivate(latest,getIdleSnapshot()))return false;
      requested=true;
      log('ordax-pull Desktop Dev: safely relaunching idle application for verified candidate '+latest.pendingSha);
      await relaunch();
      return true;
    }catch(error){
      requested=false;
      log('ordax-pull Desktop Dev activation deferred: '+error.message);
      return false;
    }finally{checking=false;}
  };
}

async function stageMain({ userData, template, log = () => {}, remote = OFFICIAL_REMOTE, runGit = git, buildCandidate = buildNativeCandidate, cleanupCandidate = removeOwnedCandidate }) {
  if (remote !== OFFICIAL_REMOTE) throw Error('Untrusted update source');
  // Best-effort orphan maintenance must not prevent a valid state decision.
  try { sweepStaleCandidates(userData,{log}); }
  catch(error) { log('Desktop candidate maintenance failed: '+error.message); }
  const state = readState(userData);
  if (state.pinnedSha) return {status:'pinned',sha:state.pinnedSha};
  if (state.pendingSha) return {status:'pending',sha:state.pendingSha};
  // Only lightweight remote discovery when no update is needed.
  const remoteReply = await runGit(['ls-remote','--heads',OFFICIAL_REMOTE,'refs/heads/main'],userData,25000);
  const remoteSha = remoteReply.ok ? remoteReply.stdout.split(/\s+/)[0] : '';
  if (!SHA_RE.test(remoteSha)) {
    log('Desktop Dev official main discovery unavailable; preserving known-good');
    return {status:'unavailable'};
  }
  if (remoteSha === state.activeSha || remoteSha === state.rejectedSha)
    return {status: remoteSha === state.activeSha ? 'current':'rejected',sha:remoteSha};
  // The bundled OS SHA is distinct from the transaction's activeSha=null.
  // Do not download, rebuild or trial a duplicate of already-installed bytes.
  // A user-selected Git version is always authoritative over this fallback.
  if (!state.activeSha && remoteSha === verifiedBundledSourceSha(template)) {
    // A successful comparison with official main supersedes any incompatibility
    // from an older SHA. Never leave an obsolete marker blocking the currently
    // installed, verified bundle; this does not rewrite a Git active/rollback SHA.
    if (state.incompatibleSha) {
      const latest=readState(userData);
      if (!latest.activeSha && !latest.pendingSha && !latest.pinnedSha) {
        writeState(userData,{...latest,incompatibleSha:null});
      }
    }
    return {status:'current',sha:remoteSha,source:'verified-bundled'};
  }
  // A verified source without the Desktop Host contract cannot become bootable
  // through repeated cloning of the identical official SHA.
  if (remoteSha === state.incompatibleSha) return {status:'incompatible',sha:remoteSha};

  const versions = join(userData,VERSIONS_DIR);
  mkdirSync(versions,{recursive:true});
  const existing = await verifiedVersion(userData,remoteSha,template);
  if (!existing) {
    const staging = join(versions,'.candidate-' + randomUUID());
    try {
      // Partial objects + sparse materialization. Git history is NOT shallow;
      // merge-base must be able to verify ancestry of the running version.
      // The official OS contains paths longer than Win32 MAX_PATH after
      // candidate UUID + userData nesting. Git for Windows needs a persisted
      // core.longpaths=true BEFORE sparse-checkout expands system/services.
      // Also keep canonical Git blob bytes independent of user autocrlf.
      const clone = await runGit(['-c','core.autocrlf=false','-c','core.longpaths=true',
        'clone','--config','core.autocrlf=false','--config','core.longpaths=true',
        '--filter=blob:none','--sparse',
        '--single-branch','--no-tags','--branch','main',OFFICIAL_REMOTE,staging],userData,120000);
      if (!clone.ok) return {status:'unavailable'};
      const sparse = await runGit(['-C',staging,'sparse-checkout','set',
        'system','docs/contracts','tools/windows-emulator','tools/surface-web','tools/windows-desktop'],staging,60000);
      if (!sparse.ok) {
        log('Windows Git sparse-checkout refused official main candidate: '+
          String(sparse.stderr||'no Git diagnostic').slice(-350));
        return {status:'unavailable'};
      }
      const head = await runGit(['-C',staging,'rev-parse','HEAD'],staging,10000);
      if (!head.ok || head.stdout !== remoteSha || !await isTrusted(staging))
        return {status:'untrusted'};
      if (!hasDesktopHostContract(staging)) {
        const latest = readState(userData);
        if (!latest.pendingSha && !latest.pinnedSha && latest.activeSha === state.activeSha) {
          writeState(userData,{...latest,incompatibleSha:remoteSha});
        }
        log('Official main '+remoteSha.slice(0,12)+' lacks Desktop Host contract; deferring until main changes');
        return {status:'incompatible',sha:remoteSha};
      }
      if (state.activeSha) {
        const ancestry = await runGit(['-C',staging,'merge-base','--is-ancestor',
          state.activeSha,remoteSha],staging,10000);
        if (!ancestry.ok) return {status:'diverged'};
      }
      const target = versionRoot(userData,remoteSha);
      if (existsSync(target)) return {status:'conflict'};
      // Never promote source-only updates: an installed Desktop must boot the
      // bundle compiled from the identical staged SHA, not hundreds of modules
      // transformed on the first user launch. The staging directory is unique.
      try {
        await buildCandidate(staging,template,{log,userData});
      } catch(error) {
        // An immutable OS commit cannot acquire a different Surface SHA or
        // pass a different pinned blob hash on retry. Record that exact SHA,
        // never mask transient networking/toolchain errors as incompatible.
        if(error?.code!=='ORDAX_SURFACE_SOURCE_INCOMPATIBLE') throw error;
        const latest=readState(userData);
        if(!latest.pendingSha && !latest.pinnedSha && latest.activeSha===state.activeSha) {
          writeState(userData,{...latest,incompatibleSha:remoteSha});
        }
        log('Official main '+remoteSha.slice(0,12)+
          ' rejected its pinned Surface source: '+error.message);
        return {status:'incompatible',sha:remoteSha};
      }
      if (!hasNativeBundle(staging)) return {status:'incompatible'};
      renameSync(staging,target);
    } finally {
      // Cleanup is independent of accepting/rejecting the verified SHA.
      // Transient Windows Git/AV handle contention is recovered by the aged
      // candidate sweeper on later checks, never by disabling verification.
      if (existsSync(staging)) {
        const result=cleanupCandidate(staging);
        if (!result.removed) log('Deferred Desktop Git candidate cleanup: ' +
          basename(staging)+' '+result.code+' phase='+result.phase);
      }
    }
  }
  if (!await verifiedVersion(userData,remoteSha,template)) return {status:'untrusted'};
  // Re-read state after expensive I/O: another updater may have changed the
  // pointer; do not trample rollback pins or concurrent pending candidates.
  const latest = readState(userData);
  if (latest.pinnedSha || latest.pendingSha || latest.activeSha !== state.activeSha) {
    return {status:'conflict'};
  }
  writeState(userData,{...latest,pendingSha:remoteSha,attemptedSha:null,incompatibleSha:null});
  log('Validated Desktop Dev update ' + remoteSha.slice(0,12) +
      ' staged; activation requires next app start and health receipt');
  return {status:'staged',sha:remoteSha};
}
module.exports = {
  CHANNEL_SCHEMA, readState, writeState, validateState, versionRoot,
  chooseBootVersion, confirmedVersion: verifiedVersion,
  stageMain, shouldAutoActivate, desktopFirstRunComplete, createDesktopIdleActivation, createDesktopWindowIdleTracker, confirmHealthy, rejectCandidate, pinPrevious, unpin,
  prepareWindowsGitDeletion, removeOwnedCandidate, sweepStaleCandidates,
};