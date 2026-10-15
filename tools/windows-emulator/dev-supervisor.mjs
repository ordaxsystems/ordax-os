#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'vite';
import { windowsEmulatorStateRoot } from './native-host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const BRANCH = process.env.ORDAX_REPO_BRANCH ?? 'main';
const UPDATE_INTERVAL_MS = Math.max(5, Number.parseInt(process.env.ORDAX_UPDATE_INTERVAL_SECONDS ?? '5', 10) || 5) * 1000;
const REMOTE_TIMEOUT_MS = Math.max(5, Number.parseInt(process.env.ORDAX_REMOTE_TIMEOUT_SECONDS ?? '20', 10) || 20) * 1000;
const FETCH_TIMEOUT_MS = Math.max(10, Number.parseInt(process.env.ORDAX_FETCH_TIMEOUT_SECONDS ?? '45', 10) || 45) * 1000;
const PREVIEW_URL = 'http://127.0.0.1:4202/system/composition/native/';
const PREVIEW_READY_TIMEOUT_MS = Math.max(5, Number.parseInt(process.env.ORDAX_PREVIEW_READY_TIMEOUT_SECONDS ?? '20', 10) || 20) * 1000;

let stopping = false;
let syncRunning = false;
let timer = null;
let viteServer = null;
let previewProcess = null;

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

function edgeExecutable() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
    process.env.LOCALAPPDATA,
  ]
    .filter(Boolean)
    .map((base) => join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function waitForPreviewReady() {
  const startedAt = Date.now();
  let lastError = null;
  while (!stopping && Date.now() - startedAt < PREVIEW_READY_TIMEOUT_MS) {
    try {
      const response = await fetch(PREVIEW_URL, { cache: 'no-store' });
      if (response.ok) {
        const html = await response.text();
        if (html.includes('id="ordax-root"') && html.includes('src="./main.mjs"')) return;
        lastError = new Error('native composition marker missing');
      } else {
        lastError = new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`preview did not become ready at ${PREVIEW_URL}: ${lastError?.message ?? 'timeout'}`);
}

async function openPreviewWindow() {
  await waitForPreviewReady();
  if (stopping) return;

  if (process.platform !== 'win32') {
    log(`preview ready at ${PREVIEW_URL}; automatic preview window is Windows-only`);
    return;
  }

  const edge = edgeExecutable();
  if (!edge) {
    throw new Error('Microsoft Edge runtime was not found; cannot create the Windows emulator preview window');
  }

  const profileRoot = join(windowsEmulatorStateRoot(), 'preview-edge-profile');
  mkdirSync(profileRoot, { recursive: true });
  previewProcess = spawn(edge, [
    `--app=${PREVIEW_URL}`,
    '--new-window',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileRoot}`,
  ], {
    stdio: 'ignore',
    windowsHide: false,
  });
  previewProcess.once('error', (error) => {
    log(`preview process failed: ${error.message}`);
  });
  log(`preview window opened at ${PREVIEW_URL}`);
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

function stopPreviewProcess() {
  if (!previewProcess || previewProcess.exitCode !== null) {
    previewProcess = null;
    return;
  }
  if (process.platform === 'win32' && Number.isInteger(previewProcess.pid)) {
    spawnSync('taskkill.exe', ['/PID', String(previewProcess.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5_000,
    });
  } else {
    previewProcess.kill('SIGTERM');
  }
  previewProcess = null;
}

async function stop() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  stopPreviewProcess();
  if (viteServer) {
    const server = viteServer;
    viteServer = null;
    await server.close();
  }
}

async function start() {
  log(`local-first session started; watching origin/${BRANCH} every ${UPDATE_INTERVAL_MS / 1000}s`);
  syncMainOnce();
  timer = setInterval(syncMainOnce, UPDATE_INTERVAL_MS);
  timer.unref();

  viteServer = await createServer({
    configFile: resolve(REPO_ROOT, 'tools/windows-emulator/vite.config.mjs'),
  });
  await viteServer.listen();
  viteServer.printUrls();
  viteServer.httpServer?.once('error', (error) => {
    if (stopping) return;
    log(`Vite server failed: ${error.message}`);
    process.exitCode = 1;
    void stop();
  });
  await openPreviewWindow();
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

try {
  await start();
} catch (error) {
  log(`emulator startup failed: ${error.message}`);
  process.exitCode = 1;
  await stop();
}
