#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { nextLocalViteRestart } from './dev-restart-policy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const HAS_GIT = existsSync(resolve(REPO_ROOT, '.git'));
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
// One canonical child, even when the Vite config watcher restarts too quickly.
// Installed/packaged runs do NOT recover automatically: only an explicitly
// launched local Desktop HMR session can retry after a transient compiler exit.
const localDesktopHmr = process.env.ORDAX_DESKTOP_HOST === '1' &&
  process.env.ORDAX_DESKTOP_LOCAL_DEV === '1' &&
  process.env.ORDAX_EMULATOR_NO_BROWSER === '1';
let vite = null;
let restartTimer = null;
let crashStreak = 0;
function launchVite() {
  if (stopping) return;
  const startedAt = Date.now();
  const child = spawn(process.execPath, [
    viteEntry,
    '--config',
    'tools/windows-emulator/vite.config.mjs',
    // Native ESM loader does not bundle config under node_modules/.vite-temp.
    ...(process.env.ORDAX_EMULATOR_NO_BROWSER === '1' ? ['--configLoader', 'native'] : []),
    ...(process.env.ORDAX_EMULATOR_NO_BROWSER === '1' ? [] : [
      '--open', '/tools/windows-emulator/index.html',
    ]),
  ], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    windowsHide: false,
  });
  vite = child;
  let handled = false;
  const onExit = (code, signal) => {
    if (handled) return;
    handled = true;
    if (vite === child) vite = null;
    if (stopping) return;
    if (localDesktopHmr) {
      const next = nextLocalViteRestart(crashStreak,Date.now()-startedAt);
      if (next) {
        crashStreak = next.failures;
        log(`Native Vite exited (${signal ?? code ?? 'unknown'}); local recovery ${crashStreak}/3 in ${next.delayMs}ms`);
        restartTimer = setTimeout(() => {
          restartTimer = null;
          launchVite();
        },next.delayMs);
        return;
      }
    }
    if (timer) clearInterval(timer);
    log(`Vite exited unexpectedly (${signal ?? code ?? 'unknown'}); development supervisor is stopping`);
    process.exitCode = code === 0 ? 1 : (code ?? 1);
    stopping = true;
  };
  child.once('error',(error)=>{
    // A failing child must exit before a replacement is launched.
    log('Vite child error: '+(error?.code || 'SPAWN_FAILURE'));
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGTERM'); } catch {}
    } else onExit(1,null);
  });
  child.once('exit',onExit);
}
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  if (restartTimer !== null) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (vite && !vite.killed) vite.kill(signal);
}
launchVite();

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

if (HAS_GIT && process.env.ORDAX_DESKTOP_HOST !== '1') {
  log(`local-first session started; watching origin/${BRANCH} every ${UPDATE_INTERVAL_MS / 1000}s`);
  syncMainOnce();
  timer = setInterval(syncMainOnce, UPDATE_INTERVAL_MS);
  timer.unref();
} else {
  // Bundled offline fallback has no .git: there is no HEAD to poll or mutate.
  log(process.env.ORDAX_DESKTOP_HOST === '1'
    ? 'Desktop source is immutable while running; Dev updates use staged Windows candidates'
    : 'bundled source has no Git checkout; Pull unavailable until a compatible checkout exists');
}
