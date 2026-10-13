import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
function which(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(command)}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findBrowser() {
  const candidates = [
    process.env.ORDAX_CHROME_BIN,
    ...(process.platform === 'win32' ? [join(process.env['PROGRAMFILES'] ?? '', 'Google/Chrome/Application/chrome.exe'), join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google/Chrome/Application/chrome.exe'), join(process.env['LOCALAPPDATA'] ?? '', 'Google/Chrome/Application/chrome.exe'), join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'), join(process.env['PROGRAMFILES'] ?? '', 'Microsoft/Edge/Application/msedge.exe')] : []),
    which('google-chrome'),
    which('google-chrome-stable'),
    which('chromium'),
    which('chromium-browser'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome/Chromium not found; set ORDAX_CHROME_BIN to an executable browser');
}

const STARTUP_TIMEOUT_MS = 60_000;
const CDP_PROBE_TIMEOUT_MS = 3_000;
const STDERR_LIMIT = 8_000;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function appendDiagnostic(current, chunk) {
  const combined = current + chunk;
  return combined.length <= STDERR_LIMIT ? combined : combined.slice(-STDERR_LIMIT);
}

function exitSummary(exitState) {
  if (!exitState) return 'still running';
  const fields = [];
  if (exitState.code !== null) fields.push(`code=${exitState.code}`);
  if (exitState.signal !== null) fields.push(`signal=${exitState.signal}`);
  return fields.length > 0 ? fields.join(', ') : 'exited';
}

async function reserveLoopbackPort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('could not allocate a loopback CDP port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(port);
      });
    });
  });
}

async function waitForDevTools(
  port,
  getExitState,
  getSpawnError,
  getStderr,
  timeoutMs = STARTUP_TIMEOUT_MS,
) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    const spawnError = getSpawnError();
    if (spawnError) {
      throw new Error(`failed to spawn Chromium: ${spawnError.message}`);
    }
    const exitState = getExitState();
    if (exitState) {
      throw new Error(
        `Chromium exited before CDP became ready (${exitSummary(exitState)}); stderr=${JSON.stringify(getStderr())}`,
      );
    }

    const controller = new AbortController();
    const requestTimeoutMs = Math.min(CDP_PROBE_TIMEOUT_MS, remainingMs);
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    const pauseMs = Math.min(50, deadline - Date.now());
    if (pauseMs > 0) await sleep(pauseMs);
  }

  throw new Error(
    `timed out waiting for Chromium CDP at ${endpoint}; process=${exitSummary(getExitState())}; last=${lastError?.message ?? 'none'}; stderr=${JSON.stringify(getStderr())}`,
  );
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out opening DevTools WebSocket')), 10_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolvePromise();
      }, { once: true });
      this.socket.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`DevTools WebSocket error: ${event?.message ?? 'unknown error'}`));
      }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result ?? {});
        return;
      }
      this.events.push(message);
    });
    this.socket.addEventListener('close', () => this.rejectPending(new Error('DevTools connection closed before proof completion')));
    this.socket.addEventListener('error', () => this.rejectPending(new Error('DevTools connection failed')));
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools command timed out: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve: resolvePromise, reject, method, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  close() {
    this.rejectPending(new Error('DevTools proof client disposed'));
    this.socket.close();
  }
}

export { sleep };
export async function runBrowser(proof) {
  if (typeof WebSocket !== 'function') throw new Error('Node >=22.18 is required by browser proof');
  const browser = findBrowser();
  const cdpPort = await reserveLoopbackPort();
  const profile = await mkdtemp(join(tmpdir(), 'ordax-browser-smoke-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ];
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');

  const child = spawn(browser, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let exitState = null;
  let spawnError = null;
  let passed = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = appendDiagnostic(stderr, chunk); });
  child.once('exit', (code, signal) => { exitState = { code, signal }; });
  child.once('error', (error) => { spawnError = error; });
  let client = null;
  try {
    const startupStartedAt = Date.now();
    await waitForDevTools(
      cdpPort,
      () => exitState,
      () => spawnError,
      () => stderr,
    );
    const startupMs = Date.now() - startupStartedAt;
    console.log(`SURFACE_BROWSER_STARTUP_MS=${startupMs}`);
    const pagesResponse = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    if (!pagesResponse.ok) {
      throw new Error(`Chromium CDP target list failed with HTTP ${pagesResponse.status}`);
    }
    const pages = await pagesResponse.json();
    const page = pages.find((item) => item.type === 'page');
    if (!page) throw new Error('Chromium did not expose a page target');
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.open();
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('Log.enable');
    const result = await proof(client);
    if (client.events.some(event => event.method === 'Runtime.exceptionThrown'))
      throw new Error('Browser emitted a JavaScript exception');
    passed = true;
    return result;
  } finally {
    // Ask Chromium to release its own profile before terminating the process.
    if (client && child.exitCode === null) {
      await client.send('Browser.close').catch(() => {});
      await new Promise(done => {
        if (child.exitCode !== null) return done();
        const timer = setTimeout(done, 2000);
        child.once('exit', () => { clearTimeout(timer); done(); });
      });
    }
    client?.close();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolvePromise) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolvePromise(); }, 2_000);
        child.once('exit', () => { clearTimeout(timer); resolvePromise(); });
      });
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    if (!passed && stderr) {
      process.stderr.write(`CHROMIUM_STDERR_BEGIN\n${stderr}\nCHROMIUM_STDERR_END\n`);
    }
  }
}
