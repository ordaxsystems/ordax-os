import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

export function parseDevToolsActivePort(value) {
  const raw = value.split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (!/^[0-9]{1,5}$/.test(raw)) throw new Error('Chrome DevToolsActivePort is malformed');
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error('Chrome DevToolsActivePort is outside TCP range');
  return port;
}

async function waitForDevTools(profile, getExitState, getSpawnError, getStderr, timeoutMs = STARTUP_TIMEOUT_MS) {
  // Windows Chrome may exit the launcher with code 0 while its profile-bound
  // browser remains alive. The browser-owned DevToolsActivePort is authoritative.
  const portFile = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) throw new Error('failed to spawn Chromium: ' + spawnError.message);
    const launchExit = getExitState();
    if (launchExit && launchExit.code !== 0 && launchExit.code !== null) {
      throw new Error('Chrome launcher failed before CDP (' + exitSummary(launchExit) + '); stderr=' + JSON.stringify(getStderr()));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const port = parseDevToolsActivePort(await readFile(portFile, 'utf8'));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(remaining, CDP_PROBE_TIMEOUT_MS));
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/json/version', {signal: controller.signal});
        if (response.ok) return port;
        lastError = new Error('CDP HTTP ' + response.status);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
    }
    const pause = Math.min(100, deadline - Date.now());
    if (pause > 0) await sleep(pause);
  }
  throw new Error('timed out waiting for Chrome-owned DevToolsActivePort/CDP; launcher='
    + exitSummary(getExitState()) + '; last=' + (lastError?.message ?? 'none')
    + '; stderr=' + JSON.stringify(getStderr()));
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

/**
 * On Windows a Chrome launcher can exit while other browser processes remain.
 * Identify only the unique temporary profile created by this harness.
 */
async function stopOwnedWindowsProfile(profile) {
  const p = resolve(profile);
  if (dirname(p) !== resolve(tmpdir()) || !basename(p).startsWith('ordax-browser-smoke-')) {
    throw new Error('Refusing Chromium cleanup outside a disposable proof profile');
  }
  const safe = p.replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference='Stop'",
    "$profile='"+safe+"'",
    "$pattern='(?i)--user-data-dir=\"?'+[regex]::Escape($profile)+'\"?(?=\s|$)'",
    "$owned={ @(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -match $pattern }) }",
    "for($attempt=0;$attempt -lt 3;$attempt++){ $items=@(& $owned); if($items.Count -eq 0){exit 0}; foreach($item in $items){ try{ Stop-Process -Id $item.ProcessId -Force -ErrorAction Stop } catch { if(Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue){throw} } }; Start-Sleep -Milliseconds 350 }",
    "if(@(& $owned).Count -gt 0){throw 'Test-owned Chrome processes still running'}",
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await new Promise((resolvePromise, reject) => {
    const process = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, stdio: ['ignore','ignore','pipe'],
    });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; process.kill(); }, 25_000);
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', chunk => { stderr = appendDiagnostic(stderr, chunk); });
    process.once('error', error => {
      clearTimeout(timer);
      reject(new Error('Unable to inspect test-owned Chromium: ' + error.message));
    });
    process.once('close', code => {
      clearTimeout(timer);
      if (timedOut || code !== 0) {
        reject(new Error('Profile-scoped Chromium cleanup failed: ' + (timedOut ? 'timeout' : code) + ' ' + stderr.slice(-1000)));
      } else resolvePromise();
    });
  });
}

/**
 * Stop only the process tree created by this browser proof.
 *
 * On Windows, child.kill() stops the Chrome parent without necessarily
 * releasing descendants that hold its disposable profile lockfile.
 * taskkill /T targets the owned PID and its children, never all Chrome
 * instances or another user profile. The caller waits before deleting data.
 */
function ownedPidIsAlive(pid) {
  try {
    // Node's child 'exit' callback may lag behind an already-dead Windows
    // launcher. The OS PID, not callback delivery, is authoritative.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error; // EPERM or an unknown failure cannot prove safe cleanup.
  }
}

export async function stopOwnedBrowser(child, getExitState, platform = process.platform, profile = null) {
  if (platform === 'win32' && profile !== null) {
    await stopOwnedWindowsProfile(profile);
    // Profile-scoped processes are gone. Avoid taskkill on a dead/recycled
    // launcher PID just because Node has not emitted its exit callback.
  }
  if (getExitState() || !Number.isSafeInteger(child.pid) || child.pid <= 0) return;
  if (platform === 'win32' && profile !== null && !ownedPidIsAlive(child.pid)) return;
  if (platform === 'win32') {
    await new Promise((resolvePromise, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      let finished = false;
      const settle = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        if (error) reject(error);
        else resolvePromise();
      };
      const watchdog = setTimeout(() => {
        killer.kill();
        settle(new Error('Timed out terminating test-owned Chromium process tree'));
      }, 10_000);
      killer.once('error', settle);
      killer.once('close', (code) => {
        if (code !== 0 && !getExitState()
            && (profile === null || ownedPidIsAlive(child.pid))) {
          settle(new Error('Could not terminate test-owned Chromium process tree'));
        } else settle();
      });
    });
  } else {
    child.kill('SIGTERM');
  }
  const stillRunning = () => !getExitState()
    && (platform !== 'win32' || profile === null || ownedPidIsAlive(child.pid));
  let deadline = Date.now() + 3000;
  while (stillRunning() && Date.now() < deadline) await sleep(30);
  if (stillRunning()) {
    child.kill('SIGKILL');
    deadline = Date.now() + 2000;
    while (stillRunning() && Date.now() < deadline) await sleep(30);
  }
  if (stillRunning()) {
    throw new Error('Test-owned Chromium did not exit; refusing to remove its profile');
  }
}

export async function runBrowser(proof) {
  if (typeof WebSocket !== 'function') throw new Error('Node >=22.18 is required by browser proof');
  const browser = findBrowser();
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
    '--remote-debugging-port=0',
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
    const cdpPort = await waitForDevTools(
      profile,
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
    // Graceful CDP shutdown first; then verify the exact disposable profile
    // owns no surviving process before deleting its on-disk state.
    if (client) {
      await Promise.race([
        client.send('Browser.close').catch(() => {}),
        sleep(1800),
      ]);
    }
    client?.close();
    await stopOwnedBrowser(child, () => exitState, process.platform, profile);
    await rm(profile, { recursive: true, force: true, maxRetries: 25, retryDelay: 250 });
    if (!passed && stderr) {
      process.stderr.write(`CHROMIUM_STDERR_BEGIN\n${stderr}\nCHROMIUM_STDERR_END\n`);
    }
  }
}
