#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const BRANCH = process.env.ORDAX_REPO_BRANCH ?? 'main';
const UPDATE_INTERVAL_MS = Math.max(5, Number.parseInt(process.env.ORDAX_UPDATE_INTERVAL_SECONDS ?? '5', 10) || 5) * 1000;
const REMOTE_TIMEOUT_MS = Math.max(5, Number.parseInt(process.env.ORDAX_REMOTE_TIMEOUT_SECONDS ?? '20', 10) || 20) * 1000;
const FETCH_TIMEOUT_MS = Math.max(10, Number.parseInt(process.env.ORDAX_FETCH_TIMEOUT_SECONDS ?? '45', 10) || 45) * 1000;

let stopping = false;
let syncRunning = false;
let timer = null;

function git(args, timeout = FETCH_TIMEOUT_MS) {
  const result = spawnSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    killSignal: 'SIGTERM',
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    error: result.error,
  };
}

function currentSha() {
  const result = git(['rev-parse', 'HEAD']);
  return result.ok ? result.stdout : null;
}

function isDirty() {
  const result = git(['status', '--porcelain=v1']);
  if (!result.ok) return null;
  return result.stdout.length > 0;
}

function remoteMainSha() {
  const result = git(['ls-remote', '--heads', 'origin', `refs/heads/${BRANCH}`], REMOTE_TIMEOUT_MS);
  if (!result.ok) return null;
  const [sha] = result.stdout.split(/\s+/);
  return /^[0-9a-f]{40}$/.test(sha ?? '') ? sha : null;
}

function isAncestor(ancestor, descendant) {
  const result = git(['merge-base', '--is-ancestor', ancestor, descendant]);
  return result.ok;
}

function log(message) {
  process.stderr.write(`ordax-emulator: ${message}\n`);
}

function syncMainOnce() {
  if (syncRunning || stopping) return;
  syncRunning = true;
  try {
    const localSha = currentSha();
    if (!localSha) {
      log('cannot resolve local HEAD; keeping current emulator session');
      return;
    }

    const dirty = isDirty();
    if (dirty === null) {
      log('cannot inspect worktree state; keeping current emulator session');
      return;
    }
    if (dirty) {
      log('local development changes detected; automatic main sync paused while Vite hot reload remains active');
      return;
    }

    const remoteSha = remoteMainSha();
    if (!remoteSha) {
      log('remote main check failed or timed out; keeping current emulator session');
      return;
    }
    if (remoteSha === localSha) return;

    const fetched = git(['fetch', '--no-tags', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`], FETCH_TIMEOUT_MS);
    if (!fetched.ok) {
      log('main fetch failed or timed out; keeping current emulator session');
      return;
    }

    const fetchedShaResult = git(['rev-parse', `refs/remotes/origin/${BRANCH}`]);
    const fetchedSha = fetchedShaResult.ok ? fetchedShaResult.stdout : null;
    if (!fetchedSha || fetchedSha !== remoteSha) {
      log('remote main moved during fetch; deferring update to the next cycle');
      return;
    }

    if (!isAncestor(localSha, fetchedSha)) {
      log(`local HEAD ${localSha.slice(0, 12)} is not a fast-forward ancestor of origin/${BRANCH}; automatic sync paused`);
      return;
    }

    const ff = git(['merge', '--ff-only', fetchedSha], FETCH_TIMEOUT_MS);
    if (!ff.ok) {
      log('fast-forward apply failed; keeping current emulator session');
      return;
    }

    log(`updated ${localSha.slice(0, 12)} -> ${fetchedSha.slice(0, 12)} from origin/${BRANCH}`);
  } finally {
    syncRunning = false;
  }
}

const viteEntry = resolve(REPO_ROOT, 'node_modules/vite/bin/vite.js');
const vite = spawn(process.execPath, [
  viteEntry,
  '--config',
  'tools/windows-emulator/vite.config.mjs',
  ...(process.env.ORDAX_EMULATOR_NO_BROWSER === '1' ? [] : [
    '--open', '/tools/windows-emulator/index.html',
  ]),
], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  windowsHide: false,
});

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  if (!vite.killed) vite.kill(signal);
}

vite.once('error', (error) => {
  log(`Vite failed to start: ${error.message}`);
  process.exitCode = 1;
  stop();
});

vite.once('exit', (code, signal) => {
  if (timer) clearInterval(timer);
  if (!stopping && code !== 0) {
    log(`Vite exited unexpectedly (${signal ?? code ?? 'unknown'}); development supervisor is stopping`);
    process.exitCode = code ?? 1;
  }
  stopping = true;
});

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

log(`local-first session started; watching origin/${BRANCH} every ${UPDATE_INTERVAL_MS / 1000}s`);
syncMainOnce();
timer = setInterval(syncMainOnce, UPDATE_INTERVAL_MS);
timer.unref();
