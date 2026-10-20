'use strict';
// Windows-only materializer of the canonical Owner/Development main source.
// Never rewrites a running tree. Only exact verified, clean, immutable versions
// can become boot candidates. MVP/Stable must not use this Git channel.
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, lstatSync, existsSync, openSync, closeSync, fsyncSync } = require('node:fs');
const { OFFICIAL_REMOTE } = require('./runtime.cjs');
const { git, isTrusted, hasDesktopHostContract, dependencies } = require('./checkout.cjs');
const { hasNativeBundle, buildNativeCandidate } = require('./native-build.cjs');

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
  if (template) dependencies(path, template);
  return path;
}

// Do not start network I/O during app boot. A prepared candidate gets only
// one trial; if no health receipt was durably written, next boot falls back.
async function chooseBootVersion({ userData, template, log = () => {} }) {
  const state = readState(userData);
  if (state.pendingSha && !state.attemptedSha) {
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

async function stageMain({ userData, template, log = () => {}, remote = OFFICIAL_REMOTE, runGit = git, buildCandidate = buildNativeCandidate }) {
  if (remote !== OFFICIAL_REMOTE) throw Error('Untrusted update source');
  const state = readState(userData);
  if (state.pinnedSha) return {status:'pinned',sha:state.pinnedSha};
  if (state.pendingSha) return {status:'pending',sha:state.pendingSha};
  // Only lightweight remote discovery when no update is needed.
  const remoteReply = await runGit(['ls-remote','--heads',OFFICIAL_REMOTE,'refs/heads/main'],userData,25000);
  const remoteSha = remoteReply.ok ? remoteReply.stdout.split(/\s+/)[0] : '';
  if (!SHA_RE.test(remoteSha)) return {status:'unavailable'};
  if (remoteSha === state.activeSha || remoteSha === state.rejectedSha)
    return {status: remoteSha === state.activeSha ? 'current':'rejected',sha:remoteSha};
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
      const clone = await runGit(['clone','--filter=blob:none','--sparse',
        '--single-branch','--no-tags','--branch','main',OFFICIAL_REMOTE,staging],userData,120000);
      if (!clone.ok) return {status:'unavailable'};
      const sparse = await runGit(['-C',staging,'sparse-checkout','set',
        'system','tools/windows-emulator','tools/surface-web','tools/windows-desktop'],staging,60000);
      if (!sparse.ok) return {status:'unavailable'};
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
      await buildCandidate(staging,template,{log});
      if (!hasNativeBundle(staging)) return {status:'incompatible'};
      renameSync(staging,target);
    } finally {
      // Delete ONLY the uniquely owned staging directory, never user/source.
      // Retry bounded Windows Git-handle contention, only for this transaction's
      // unique .candidate UUID directory. Never touch active/previous versions.
      if (existsSync(staging)) rmSync(staging,{recursive:true,force:true,maxRetries:10,retryDelay:200});
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
  stageMain, confirmHealthy, rejectCandidate, pinPrevious, unpin,
};