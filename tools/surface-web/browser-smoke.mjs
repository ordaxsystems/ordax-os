#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const STATIC_IMPORT_RE = /\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const ASSET_HREF_RE = /\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)\.href/g;
const SURFACE_ROOT_MODULE = 'system/surface/ui/surface.mjs';
const WEB_COMPOSITION_ROOT_MODULE = 'system/composition/web/main.mjs';
const ROOT_MODULES = [SURFACE_ROOT_MODULE, WEB_COMPOSITION_ROOT_MODULE];
const CSS_FILES = [
  'system/surface/ui/tokens.css',
  'system/surface/ui/surface.css',
  'system/surface/ui/boot-screen.css',
  'system/surface/ui/workspace-areas.css',
  'system/surface/ui/files.css',
  'system/surface/ui/system.css',
  'system/surface/ui/account.css',
  'system/surface/ui/space-switcher.css',
  'system/surface/ui/settings.css',
  'system/surface/ui/store.css',
  'system/surface/ui/identity.css',
];
const COMPONENT_ASSET_FILES = Object.freeze({
  'system/apps/assistant/assistant.css': 'text/css',
  'system/apps/internet/internet.css': 'text/css',
  'system/apps/network/network.css': 'text/css',
  'system/apps/projects/projects.css': 'text/css',
  'system/apps/studio/studio.css': 'text/css',
});

function parseArgs(argv) {
  let bundleDir = 'out/web-client';
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--bundle-dir') {
      bundleDir = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${value}`);
  }
  return { bundleDir: resolve(bundleDir) };
}

function assertInside(root, candidate) {
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`bundle dependency escapes bundle root: ${candidate}`);
  }
}

function resolveModule(bundleDir, sourcePath, specifier) {
  if (!specifier.startsWith('.')) {
    throw new Error(`browser smoke only accepts relative local ESM dependencies: ${sourcePath} -> ${specifier}`);
  }
  const candidate = normalize(join(dirname(sourcePath), specifier)).replaceAll('\\', '/');
  const absolute = resolve(bundleDir, candidate);
  assertInside(bundleDir, absolute);
  if (!existsSync(absolute)) {
    throw new Error(`missing browser smoke dependency: ${candidate}`);
  }
  return candidate;
}

function moduleSpecifiers(source) {
  const values = new Set();
  for (const match of source.matchAll(STATIC_IMPORT_RE)) values.add(match[1]);
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) values.add(match[1]);
  return [...values];
}

function moduleKey(path, namespace = 'shell') {
  return `ordax-module/${namespace}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function rewriteModule(source, sourcePath, bundleDir, namespace = 'shell', assetUrls = {}) {
  const rewrite = (full, specifier) => {
    const dependency = resolveModule(bundleDir, sourcePath, specifier);
    return full.replace(specifier, moduleKey(dependency, namespace));
  };
  const rewriteAssetHref = (_full, specifier) => {
    const dependency = resolveModule(bundleDir, sourcePath, specifier);
    const assetUrl = assetUrls[dependency];
    if (!assetUrl) {
      throw new Error(`browser smoke asset is not registered: ${sourcePath} -> ${dependency}`);
    }
    return JSON.stringify(assetUrl);
  };
  return source
    .replace(STATIC_IMPORT_RE, rewrite)
    .replace(DYNAMIC_IMPORT_RE, rewrite)
    .replace(ASSET_HREF_RE, rewriteAssetHref);
}

async function collectModules(bundleDir) {
  const pending = [...ROOT_MODULES];
  const sources = new Map();
  while (pending.length > 0) {
    const path = pending.pop();
    if (sources.has(path)) continue;
    const source = await readFile(join(bundleDir, path), 'utf8');
    sources.set(path, source);
    for (const specifier of moduleSpecifiers(source)) {
      pending.push(resolveModule(bundleDir, path, specifier));
    }
  }
  return sources;
}

async function loadComponentAssetUrls(bundleDir) {
  const entries = await Promise.all(
    Object.entries(COMPONENT_ASSET_FILES).map(async ([path, mediaType]) => {
      const bytes = await readFile(join(bundleDir, path));
      return [path, `data:${mediaType};base64,${bytes.toString('base64')}`];
    }),
  );
  return Object.freeze(Object.fromEntries(entries));
}

// The proof injects CSS into about:blank. Resolve bundled assets locally so
// masks and fonts exercise the same offline resources as the compositions.
async function loadStyles(bundleDir) {
  return (await Promise.all(CSS_FILES.map(async (path) => {
    let css = await readFile(join(bundleDir, path), 'utf8');
    const urls = [...css.matchAll(/url\(\s*["']?([^"'\s)]+)["']?\s*\)/g)];
    for (const match of urls) {
      const asset = resolveModule(bundleDir, path, match[1]);
      const mediaType = asset.endsWith('.svg') ? 'image/svg+xml'
        : asset.endsWith('.woff2') ? 'font/woff2'
        : asset.endsWith('.png') ? 'image/png' : null;
      if (!mediaType) throw new Error(`unsupported local CSS asset: ${asset}`);
      const bytes = await readFile(join(bundleDir, asset));
      css = css.replace(match[0], `url("data:${mediaType};base64,${bytes.toString('base64')}")`);
    }
    return css;
  }))).join('\n');
}

function which(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(command)}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findBrowser() {
  const candidates = [
    process.env.ORDAX_CHROME_BIN,
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
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result ?? {});
        return;
      }
      this.events.push(message);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

// Keep raster URLs short in the about:blank fixture, while decoding the exact
// offline bundle bytes. CSS variable substitution need not carry megabytes of
// base64 inside a declaration. The private proof page owns the Blob lifetime.
function injectedStylesExpression(styles) {
  return `(${JSON.stringify(styles)}).replace(/url\\("data:image\\/png;base64,([^\"]+)"\\)/g, (_, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return 'url("' + URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) + '")';
  })`;
}

function buildProofExpression(moduleSources, styles, assetUrls) {
  const namespace = 'shell';
  const rewritten = Object.fromEntries(
    [...moduleSources.entries()].map(([path, source]) => [
      path,
      rewriteModule(source, path, bundleDirGlobal, namespace, assetUrls),
    ]),
  );
  const moduleKeys = Object.fromEntries(
    [...moduleSources.keys()].map((path) => [path, moduleKey(path, namespace)]),
  );
  return `(async () => {
    const sources = ${JSON.stringify(rewritten)};
    const keys = ${JSON.stringify(moduleKeys)};
    document.open();
    document.write('<!doctype html><html><head></head><body><div id="ordax-proof-root"></div></body></html>');
    document.close();
    const style = document.createElement('style');
    style.textContent = ${injectedStylesExpression(styles)};
    document.head.append(style);

    const urls = Object.create(null);
    for (const [path, source] of Object.entries(sources)) {
      urls[path] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    }
    const imports = Object.create(null);
    for (const [path, key] of Object.entries(keys)) imports[key] = urls[path];
    const importMap = document.createElement('script');
    importMap.type = 'importmap';
    importMap.textContent = JSON.stringify({ imports });
    document.head.append(importMap);

    const { mountSurface } = await import(urls[${JSON.stringify('system/surface/ui/surface.mjs')}]);
    let snapshot = { capabilityIds: [], connectivity: 'offline' };
    const listeners = new Set();
    const host = {
      schema: 'ordax.surface-host/1',
      getSnapshot() { return snapshot; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      emit(next) { snapshot = next; for (const listener of [...listeners]) listener(snapshot); },
    };
    const savedWorkspaces = [];
    const workspaceStore = {
      schema: 'ordax.workspace-store/2',
      load() { return null; },
      save(value) { savedWorkspaces.push(value); },
    };
    const root = document.querySelector('#ordax-proof-root');
    const surface = mountSurface(root, host, null, workspaceStore);
    const result = {};
    result.shellMounted = Boolean(root.querySelector('[data-workspace]'));
    result.launcherApps = root.querySelectorAll('[data-launch-app]').length;

    root.querySelector('[data-launcher-toggle]').click();
    const settingsLaunch = root.querySelector('[data-launch-app="settings"]');
    result.settingsLaunchPresent = Boolean(settingsLaunch);
    settingsLaunch.click();

    const windowBefore = root.querySelector('[data-window-id="settings"]');
    const slotBefore = windowBefore?.querySelector('[data-app-extension="settings-overview"]');
    const bodyBefore = windowBefore?.querySelector('.ordax-window-body');
    result.settingsWindowCreated = Boolean(windowBefore && slotBefore && bodyBefore);

    bodyBefore.style.height = '120px';
    bodyBefore.style.maxHeight = '120px';
    const input = document.createElement('input');
    input.dataset.proofDraft = '';
    input.value = 'rascunho-nao-persistido';
    const spacer = document.createElement('div');
    spacer.style.height = '1200px';
    spacer.textContent = 'proof spacer';
    slotBefore.append(input, spacer);
    bodyBefore.scrollTop = 90;
    input.focus({ preventScroll: true });
    const scrollBefore = bodyBefore.scrollTop;
    result.focusBeforeSnapshot = document.activeElement === input;
    result.scrollBeforeSnapshot = scrollBefore;

    host.emit({ capabilityIds: [], connectivity: 'online' });
    const windowAfterSnapshot = root.querySelector('[data-window-id="settings"]');
    const slotAfterSnapshot = windowAfterSnapshot?.querySelector('[data-app-extension="settings-overview"]');
    const bodyAfterSnapshot = windowAfterSnapshot?.querySelector('.ordax-window-body');
    result.sameWindowAfterSnapshot = windowAfterSnapshot === windowBefore;
    result.sameSlotAfterSnapshot = slotAfterSnapshot === slotBefore;
    result.sameInputAfterSnapshot = slotAfterSnapshot?.querySelector('[data-proof-draft]') === input;
    result.focusAfterSnapshot = document.activeElement === input;
    result.scrollPreservedAfterSnapshot = bodyAfterSnapshot?.scrollTop === scrollBefore;
    result.draftPreservedAfterSnapshot = input.value === 'rascunho-nao-persistido';

    surface.preferences.set('appearance.theme', 'dark');
    const windowAfterPreference = root.querySelector('[data-window-id="settings"]');
    result.sameWindowAfterPreference = windowAfterPreference === windowBefore;
    result.sameInputAfterPreference = windowAfterPreference?.querySelector('[data-proof-draft]') === input;
    result.focusAfterPreference = document.activeElement === input;
    result.scrollPreservedAfterPreference = windowAfterPreference?.querySelector('.ordax-window-body')?.scrollTop === scrollBefore;

    const minimize = windowBefore.querySelector('[data-window-action="minimize"]');
    minimize.click();
    result.savedAfterMinimize = savedWorkspaces.at(-1)?.areas?.[0]?.windows?.find((item) => item.id === 'settings')?.minimized === true;
    result.sameWindowWhileMinimized = root.querySelector('[data-window-id="settings"]') === windowBefore;
    result.windowHiddenWhenMinimized = windowBefore.hidden === true;
    result.minimizedDatasetAfterClick = windowBefore.dataset.minimized === 'true';
    result.dockOffersRestore = root.querySelector('[data-open-window="settings"]')?.getAttribute('aria-label') === 'Restaurar Ajustes';
    result.draftPreservedWhileMinimized = input.value === 'rascunho-nao-persistido';
    result.focusMovedToWorkspaceOnMinimize = document.activeElement === root.querySelector('[data-workspace]');

    root.querySelector('[data-open-window="settings"]').click();
    result.sameWindowAfterRestore = root.querySelector('[data-window-id="settings"]') === windowBefore;
    result.windowVisibleAfterRestore = windowBefore.hidden === false;
    result.sameInputAfterRestore = windowBefore.querySelector('[data-proof-draft]') === input;
    result.draftPreservedAfterRestore = input.value === 'rascunho-nao-persistido';
    result.scrollPreservedAfterRestore = bodyBefore.scrollTop === scrollBefore;
    result.maximizedDatasetAfterRestore = windowBefore.dataset.maximized === 'true';

    const maximize = windowBefore.querySelector('[data-window-action="maximize"]');
    maximize.click();
    result.sameWindowAfterUnmaximize = root.querySelector('[data-window-id="settings"]') === windowBefore;
    result.maximizedDatasetAfterUnmaximize = windowBefore.dataset.maximized === 'false';
    maximize.click();
    result.sameWindowAfterRemaximize = root.querySelector('[data-window-id="settings"]') === windowBefore;
    result.maximizedDatasetAfterRemaximize = windowBefore.dataset.maximized === 'true';

    root.querySelector('[data-launcher-toggle]').click();
    const systemLaunchBefore = root.querySelector('[data-launcher] [data-launch-app="system"]');
    systemLaunchBefore.focus({ preventScroll: true });
    result.launcherFocusBeforeSnapshot = document.activeElement === systemLaunchBefore;
    host.emit({ capabilityIds: [], connectivity: 'offline' });
    const systemLaunchAfter = root.querySelector('[data-launcher] [data-launch-app="system"]');
    result.sameLauncherNodeAfterSnapshot = systemLaunchAfter === systemLaunchBefore;
    result.launcherFocusPreserved = document.activeElement === systemLaunchBefore;

    windowBefore.querySelector('[data-window-action="close"]').click();
    result.windowRemovedAfterClose = root.querySelector('[data-window-id="settings"]') === null;
    result.dockRemovedAfterClose = root.querySelector('[data-open-window="settings"]') === null;
    result.focusMovedToWorkspaceOnClose = document.activeElement === root.querySelector('[data-workspace]');

    const required = [
      'shellMounted', 'settingsLaunchPresent', 'settingsWindowCreated', 'focusBeforeSnapshot',
      'sameWindowAfterSnapshot', 'sameSlotAfterSnapshot', 'sameInputAfterSnapshot',
      'focusAfterSnapshot', 'scrollPreservedAfterSnapshot', 'draftPreservedAfterSnapshot',
      'sameWindowAfterPreference', 'sameInputAfterPreference', 'focusAfterPreference',
      'scrollPreservedAfterPreference', 'savedAfterMinimize', 'sameWindowWhileMinimized',
      'windowHiddenWhenMinimized', 'minimizedDatasetAfterClick', 'dockOffersRestore',
      'draftPreservedWhileMinimized', 'focusMovedToWorkspaceOnMinimize', 'sameWindowAfterRestore',
      'windowVisibleAfterRestore', 'sameInputAfterRestore', 'draftPreservedAfterRestore',
      'scrollPreservedAfterRestore', 'maximizedDatasetAfterRestore', 'sameWindowAfterUnmaximize',
      'maximizedDatasetAfterUnmaximize', 'sameWindowAfterRemaximize', 'maximizedDatasetAfterRemaximize',
      'launcherFocusBeforeSnapshot', 'sameLauncherNodeAfterSnapshot', 'launcherFocusPreserved', 'windowRemovedAfterClose',
      'dockRemovedAfterClose', 'focusMovedToWorkspaceOnClose',
    ];
    result.requiredAssertions = Object.fromEntries(required.map((name) => [name, Boolean(result[name])]));
    result.allCoreAssertions = result.launcherApps >= 4 && Object.values(result.requiredAssertions).every(Boolean);

    surface.destroy();
    for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    return result;
  })()`;
}

function buildCompositionProofExpression(moduleSources, styles, assetUrls) {
  const namespaces = ['composition-first', 'composition-remount'];
  const namespaceSources = Object.fromEntries(
    namespaces.map((namespace) => [
      namespace,
      Object.fromEntries(
        [...moduleSources.entries()].map(([path, source]) => [
          path,
          rewriteModule(source, path, bundleDirGlobal, namespace, assetUrls),
        ]),
      ),
    ]),
  );
  const namespaceKeys = Object.fromEntries(
    namespaces.map((namespace) => [
      namespace,
      Object.fromEntries(
        [...moduleSources.keys()].map((path) => [path, moduleKey(path, namespace)]),
      ),
    ]),
  );

  return `(async () => {
    const namespaceSources = ${JSON.stringify(namespaceSources)};
    const namespaceKeys = ${JSON.stringify(namespaceKeys)};
    const rootModule = ${JSON.stringify(WEB_COMPOSITION_ROOT_MODULE)};
    const storageRecords = new Map();
    const storage = {
      get length() { return storageRecords.size; },
      clear() { storageRecords.clear(); },
      getItem(key) { return storageRecords.has(String(key)) ? storageRecords.get(String(key)) : null; },
      key(index) { return [...storageRecords.keys()][index] ?? null; },
      removeItem(key) { storageRecords.delete(String(key)); },
      setItem(key, value) { storageRecords.set(String(key), String(value)); },
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: storage,
    });

    document.open();
    document.write('<!doctype html><html><head></head><body><div id="ordax-boot-screen" class="ordax-boot-screen" data-state="loading"><span data-ordax-boot-status>Preparando OrdaX…</span></div><div id="ordax-root"></div></body></html>');
    document.close();
    const style = document.createElement('style');
    style.textContent = ${injectedStylesExpression(styles)};
    document.head.append(style);

    const namespaceUrls = Object.create(null);
    const imports = Object.create(null);
    for (const [namespace, sources] of Object.entries(namespaceSources)) {
      const urls = Object.create(null);
      namespaceUrls[namespace] = urls;
      for (const [path, source] of Object.entries(sources)) {
        urls[path] = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      }
      for (const [path, key] of Object.entries(namespaceKeys[namespace])) {
        imports[key] = urls[path];
      }
    }
    const importMap = document.createElement('script');
    importMap.type = 'importmap';
    importMap.textContent = JSON.stringify({ imports });
    document.head.append(importMap);

    const result = {};

    const parsedStorage = (key) => {
      const raw = storage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    };
    const launch = async (appId) => {
      const root = document.querySelector('#ordax-root');
      const launcher = root.querySelector('[data-launcher]');
      if (launcher?.hidden !== false) root.querySelector('[data-launcher-toggle]').click();
      const button = root.querySelector('[data-launch-app="' + appId + '"]');
      if (!button) throw new Error('composition smoke could not find launcher app: ' + appId);
      button.click();
      await Promise.resolve();
    };

    await import(namespaceUrls['composition-first'][rootModule]);
    await Promise.resolve();
    let root = document.querySelector('#ordax-root');
    result.compositionMounted = Boolean(root?.querySelector('[data-workspace]'));
    root.querySelector('.ordax-rail [data-launch-app="studio"]')?.click();
    await Promise.resolve();
    const studioWorkspace = root.querySelector('[data-studio-workspace="true"]');
    result.studioNavigationOpensSharedApp = Boolean(studioWorkspace);
    result.studioWebAvailabilityIsHonest = /ainda não está integrado|not yet integrated/.test(studioWorkspace?.textContent || '');
    result.studioUnavailableDoesNotDisplayZeroMetrics = studioWorkspace?.querySelector('.ordax-studio-metrics') === null;
    const studioChatLink = studioWorkspace?.querySelector('a');
    result.studioChatUsesExternalPublicSite = studioChatLink?.href === 'https://chatgpt.com/' && studioChatLink?.rel === 'noopener noreferrer';
    const studioAbout = studioWorkspace?.querySelector('[data-studio-disclosure="about"]');
    if (studioAbout) studioAbout.open = true;
    result.studioHasSingleContentHeading = [...root.querySelectorAll('[data-app-extension="studio-workspace"] h3')].filter((heading) => getComputedStyle(heading).display !== 'none').length === 1;
    studioWorkspace?.querySelector('[data-launch-app="projects"]')?.click();
    await Promise.resolve();
    result.studioProjectsUsesExistingOwner = Boolean(root.querySelector('[data-window-id="projects"]'));
    result.studioDisclosureSurvivesNavigation = root.querySelector('[data-studio-workspace="true"] [data-studio-disclosure="about"]')?.open === true;
    const homeSettings = root.querySelector('.ordax-home-actions [data-launch-app="settings"]');
    homeSettings?.click();
    await Promise.resolve();
    result.homeShortcutOpensRealOwner = root.querySelector('[data-window-id="settings"] [data-app-extension="settings-overview"]')?.dataset.ordaxSettingsOverviewView !== undefined;
    root.querySelector('[data-show-desktop]')?.click();
    await Promise.resolve();
    result.homeRestoresDesktopWithoutDeletingWindows = parsedStorage('ordax.workspace.v2')?.areas?.[0]?.windows?.some((item) => item.appId === 'settings' && item.minimized === true) === true;
    result.homeNavigationReflectsWorkspace = root.querySelector('[data-show-desktop]')?.getAttribute('aria-current') === 'page';
    root.querySelector('.ordax-dock-shortcuts [data-launch-app="files"]')?.click();
    await Promise.resolve();
    result.dockShortcutOpensRealOwner = Boolean(root.querySelector('[data-window-id="files"]'));
    result.homeNavigationClearsWhenAppIsActive = root.querySelector('[data-show-desktop]')?.hasAttribute('aria-current') === false;

    result.sharedShortcutLabels = [...root.querySelectorAll('.ordax-home-action, .ordax-dock-shortcut')].every((button) => button.getAttribute('aria-label') === root.querySelector('.ordax-rail [data-sidebar-app="' + button.dataset.sidebarApp + '"]')?.getAttribute('aria-label'));
    const wallpaper = getComputedStyle(root.querySelector('[data-workspace]'), '::before').backgroundImage;
    const wallpaperUrl = wallpaper.match(/url\\("?(blob:[^"\\)]+)"?\\)/)?.[1];
    result.localWallpaperBundled = Boolean(wallpaperUrl);
    result.localWallpaperDecoded = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth >= 1000 && image.naturalHeight >= 500);
      image.onerror = () => resolve(false);
      image.src = wallpaperUrl ?? '';
    });
    const spaceTrigger = root.querySelector('[data-space-switcher-toggle]');
    result.spaceSwitcherMounted = Boolean(spaceTrigger);
    spaceTrigger?.click();
    result.spaceSwitcherOpens = spaceTrigger?.getAttribute('aria-expanded') === 'true'
      && root.querySelector('#ordax-space-switcher-menu')?.hidden === false;
    result.spaceSwitcherWebFailsClosed = root.querySelectorAll('[data-space-switcher-select]').length === 0;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    result.spaceSwitcherEscapeCloses = spaceTrigger?.getAttribute('aria-expanded') === 'false';
    spaceTrigger?.focus();
    spaceTrigger?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', bubbles: true, cancelable: true,
    }));
    const manageSpaces = root.querySelector('[data-space-switcher-manage]');
    result.spaceSwitcherKeyboardOpens = spaceTrigger?.getAttribute('aria-expanded') === 'true';
    result.spaceSwitcherKeyboardFocusesAction = Boolean(manageSpaces)
      && document.activeElement === manageSpaces;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    result.spaceSwitcherKeyboardRestoresFocus = spaceTrigger?.getAttribute('aria-expanded') === 'false'
      && document.activeElement === spaceTrigger;

    // Exercise a real interactive Native-style port in Chromium, with a
    // transient selection failure. This fixture never touches product storage.
    const pickerModule = await import(namespaceUrls['composition-first']['system/surface/ui/space-switcher-controls.mjs']);
    const pickerHost = document.createElement('div');
    pickerHost.innerHTML = '<div data-space-switcher-slot></div>';
    document.body.append(pickerHost);
    const pickerSpace = {
      id: 'picker-space', name: 'Pizzaria teste', kind: 'professional',
      state: 'active', ownerId: 'picker-subject', profilePack: null,
    };
    const pickerSession = { state: 'signed-in', subjectId: 'picker-subject', displayName: 'Teste' };
    const pickerCatalog = { schema: 'ordax.spaces-snapshot/1', state: 'ready', spaces: [pickerSpace] };
    let pickerSelection = {
      schema: 'ordax.space-selection/1', state: 'unselected',
      subjectId: 'picker-subject', selectedSpace: null,
    };
    let pickerFailures = 1;
    const pickerPort = {
      schema: 'ordax.space-selection/1',
      getSnapshot() { return pickerSelection; },
      subscribe(listener) { listener(pickerSelection); return () => {}; },
      select(spaceId) {
        if (pickerFailures-- > 0) throw new Error('selection temporarily unavailable');
        if (spaceId !== pickerSpace.id) throw new Error('invalid selection');
        pickerSelection = { ...pickerSelection, state: 'selected', selectedSpace: pickerSpace };
        return pickerSelection;
      },
      clear() {},
    };
    const pickerControls = pickerModule.mountSpaceSwitcherControls(
      pickerHost,
      {
        schema: 'ordax.identity-session/1',
        getSnapshot() { return pickerSession; },
        subscribe(listener) { listener(pickerSession); return () => {}; },
      },
      {
        schema: 'ordax.spaces/1',
        getSnapshot() { return pickerCatalog; },
        subscribe(listener) { listener(pickerCatalog); return () => {}; },
        async refresh() { return pickerCatalog; },
        reset() {},
      },
      pickerPort,
      { schema: 'ordax.app-activation/1', publish() {}, subscribe() { return () => {}; } },
      {
        schema: 'ordax.surface-render-lifecycle/5',
        getAppTarget() { return null; },
        setAppTarget() {},
        subscribeRender() { return () => {}; },
        localization: {
          schema: 'ordax.localization/2',
          getLocale() { return 'pt-BR'; },
          getProfile() {
            return { schema: 'ordax.locale-profile/1', locale: 'pt-BR',
              language: 'pt', script: 'Latn', region: 'BR', direction: 'ltr' };
          },
          translate(key) { return key; },
          subscribe() { return () => {}; },
        },
      },
    );
    pickerHost.querySelector('[data-space-switcher-toggle]').click();
    pickerHost.querySelector('[data-space-switcher-select="picker-space"]').click();
    result.spaceSwitcherFailedOptionEnabled =
      pickerHost.querySelector('[data-space-switcher-select="picker-space"]')?.disabled === false;
    result.spaceSwitcherFailedFeedback = Boolean(pickerHost.querySelector('[role="alert"]'));
    result.spaceSwitcherFailureMenuOpen =
      pickerHost.querySelector('#ordax-space-switcher-menu')?.hidden === false;
    result.spaceSwitcherFailureKeepsOptions =
      result.spaceSwitcherFailedOptionEnabled
      && result.spaceSwitcherFailedFeedback
      && result.spaceSwitcherFailureMenuOpen;
    pickerHost.querySelector('[data-space-switcher-select="picker-space"]').click();
    result.spaceSwitcherRetrySucceeds = pickerSelection.state === 'selected'
      && pickerHost.querySelector('[data-space-switcher-toggle]')?.getAttribute('aria-expanded') === 'false';
    // Simulate a new authenticated subject arriving before the old Space
    // catalog has been invalidated; no foreign names or actions may appear.
    pickerSession.subjectId = 'second-picker-subject';
    pickerHost.querySelector('[data-space-switcher-toggle]').click();
    result.spaceSwitcherSubjectMismatchFailsClosed =
      pickerHost.querySelectorAll('[data-space-switcher-select]').length === 0
      && !pickerHost.querySelector('.ordax-space-switcher-trigger-label')
        ?.textContent?.includes('Pizzaria teste')
      && pickerHost.querySelector('#ordax-space-switcher-menu')?.hidden === false;
    pickerControls.destroy();
    result.spaceSwitcherFixtureCleaned = pickerHost.querySelector('[data-space-switcher-toggle]') === null;
    pickerHost.remove();

    const bootScreen = document.querySelector('#ordax-boot-screen');
    result.bootScreenCompleted = bootScreen?.hidden === true
      && bootScreen?.dataset.state === 'ready';
    const firstInternetStyle = document.querySelector(
      'link[data-ordax-component-style="internet"]',
    );
    result.internetComponentStyleMounted = Boolean(
      firstInternetStyle?.href?.startsWith('data:text/css;base64,'),
    );
    const firstProjectsStyle = document.querySelector(
      'link[data-ordax-component-style="projects"]',
    );
    result.projectsComponentStyleMounted = Boolean(
      firstProjectsStyle?.href?.startsWith('data:text/css;base64,'),
    );
    const firstNetworkStyle = document.querySelector(
      'link[data-ordax-component-style="network"]',
    );
    result.networkComponentStyleMounted = Boolean(
      firstNetworkStyle?.href?.startsWith('data:text/css;base64,'),
    );

    await launch('network');
    const networkWindow = root.querySelector('[data-window-id="network"]');
    const networkSlot = networkWindow?.querySelector('[data-app-extension="network-workspace"]');
    const networkBackend = networkSlot?.querySelector('[data-network-backend]');
    result.networkOwnerMounted = networkSlot?.dataset.ordaxNetworkMounted === 'true';
    result.networkWebUnavailableHonest = networkBackend?.dataset.networkBackend === 'unavailable';

    await launch('projects');
    const projectsWindow = root.querySelector('[data-window-id="projects"]');
    const projectsSlot = projectsWindow?.querySelector('[data-app-extension="projects-workspace"]');
    const projectsView = projectsSlot?.querySelector('[data-ordax-projects-view]');
    result.projectsOwnerMounted = projectsSlot?.dataset.ordaxProjectsMounted === 'true';
    result.projectsWebUnavailableHonest = projectsView?.dataset.projectsAvailable === 'false';

    await launch('settings');
    let settingsWindow = root.querySelector('[data-window-id="settings"]');
    let settingsSlot = settingsWindow?.querySelector('[data-app-extension="settings-overview"]');
    result.settingsWindowMounted = Boolean(settingsWindow);
    result.settingsOwnerMounted = Boolean(settingsSlot?.dataset.ordaxSettingsOverviewView !== undefined);
    result.settingsStartsAppearance = settingsSlot?.dataset.settingsActiveSection === 'appearance';
    result.globalHeaderClearOfWindows = settingsWindow?.getBoundingClientRect().top
      >= root.querySelector('.ordax-brandbar').getBoundingClientRect().bottom;
    const previewMatchesRoot = (theme) => {
      const preview = settingsSlot?.querySelector('[data-theme-preview="' + theme + '"]');
      if (!preview) return false;
      return ['--ordax-accent', '--ordax-text', '--ordax-app-bg'].every((token) =>
        getComputedStyle(preview).getPropertyValue(token).trim()
        === getComputedStyle(root).getPropertyValue(token).trim());
    };
    result.lightPreviewFollowsTokens = previewMatchesRoot('light');
    const brand = root.querySelector('.ordax-brand-symbol');
    result.localBrandMaskLoaded = Boolean(brand &&
      getComputedStyle(brand).maskImage.includes('data:image/svg+xml;base64,'));
    await document.fonts.ready;
    result.localFontLoaded = [...document.fonts].some((font) => font.family === 'Inter' && font.status === 'loaded');

    const darkButton = settingsSlot?.querySelector(
      '[data-settings-preference-id="appearance.theme"][data-settings-preference-value="dark"]',
    );
    result.darkActionPresent = Boolean(darkButton);
    darkButton?.click();
    await Promise.resolve();
    result.darkThemeApplied = root.dataset.ordaxTheme === 'dark';
    result.darkThemePersisted = parsedStorage('ordax.preferences.v1')?.['appearance.theme'] === 'dark';
    result.darkPreviewFollowsTokens = previewMatchesRoot('dark');

    const accessibilityButton = settingsSlot?.querySelector('[data-settings-section="accessibility"]');
    result.accessibilityNavigationPresent = Boolean(accessibilityButton);
    accessibilityButton?.click();
    await Promise.resolve();
    settingsWindow = root.querySelector('[data-window-id="settings"]');
    settingsSlot = settingsWindow?.querySelector('[data-app-extension="settings-overview"]');
    result.accessibilityTargetApplied = settingsSlot?.dataset.settingsActiveSection === 'accessibility';

    const extraLargeButton = settingsSlot?.querySelector(
      '[data-settings-preference-id="accessibility.text-scale"][data-settings-preference-value="extra-large"]',
    );
    result.extraLargeActionPresent = Boolean(extraLargeButton);
    extraLargeButton?.click();
    await Promise.resolve();
    result.textScaleApplied = document.documentElement.dataset.ordaxTextScale === 'extra-large';
    const preferences = parsedStorage('ordax.preferences.v1');
    result.textScalePersisted = preferences?.['accessibility.text-scale'] === 'extra-large';

    const workspace = parsedStorage('ordax.workspace.v2');
    const firstArea = workspace?.areas?.find((area) => area.id === workspace.activeAreaId) ?? workspace?.areas?.[0];
    const storedSettings = firstArea?.windows?.find((item) => item.appId === 'settings');
    result.workspaceTargetPersisted = storedSettings?.target === 'accessibility';

    result.notesAbsentFromLauncher = root.querySelector('[data-launch-app="notes"]') === null;
    result.notesLocalWindowAbsent = root.querySelector('[data-window-id="notes"]') === null;

    await launch('store');
    const storeSlot = root.querySelector(
      '[data-window-id="store"] [data-app-extension="store-overview"]',
    );
    result.storeOwnerMounted = storeSlot?.dataset.ordaxStoreOverviewView === 'true';
    result.storeFailsClosedWithoutVerifiedCatalog = storeSlot?.dataset.storeState === 'unavailable'
      && storeSlot?.querySelector('[data-store-operation]') === null
      && storeSlot?.querySelector('[data-store-authority="none"]') !== null;


    // Exercise the Store in Chromium against a verified contract fixture.
    // This fixture is isolated from the real composition and cannot authorize installs.
    const { mountStoreOverviewControls } = await import(
      namespaceUrls['composition-first']['system/surface/ui/store-overview-controls.mjs']
    );
    const { createLocaleProfile } = await import(
      namespaceUrls['composition-first']['system/contracts/locale-profile.mjs']
    );
    const storeProofRoot = document.createElement('div');
    storeProofRoot.style.width = '1100px';
    storeProofRoot.innerHTML = '<section data-window-id="store"><div class="ordax-app-extension" data-app-extension="store-overview"></div></section>';
    document.body.append(storeProofRoot);
    const verifiedStoreEntries = [
      {
        appId: 'audio', title: 'Áudio', state: 'available',
        installedVersion: null, availableVersion: '1.0.0',
        installable: true, updatable: false, removable: false, blockedReason: null,
        artifactIdentityVerified: true, provenanceVerified: true,
      },
      {
        appId: 'files', title: 'Arquivos', state: 'installed',
        installedVersion: '1.0.0', availableVersion: null,
        installable: false, updatable: false, removable: true, blockedReason: null,
        artifactIdentityVerified: false, provenanceVerified: false,
      },
      {
        appId: 'studio', title: 'OrdaX Studio', state: 'installed',
        installedVersion: '1.0.0', availableVersion: '1.0.1',
        installable: false, updatable: true, removable: true, blockedReason: null,
        artifactIdentityVerified: true, provenanceVerified: true,
      },
    ];
    // Deliberately unsorted incoming SSOT: presentation must order it without mutation.
    verifiedStoreEntries.reverse();
    const verifiedStoreSnapshot = {
      schema: 'ordax.app-store-catalog/2', state: 'ready', entries: verifiedStoreEntries,
      reason: null, authority: 'none',
    };
    let notifyStore = null;
    const proofCatalog = {
      schema: 'ordax.app-store-catalog-port/2', authority: 'none',
      getSnapshot() { return verifiedStoreSnapshot; },
      subscribe(listener) { notifyStore = listener; return () => { notifyStore = null; }; },
    };
    const localeProfile = createLocaleProfile('pt-BR');
    const proofLifecycle = {
      schema: 'ordax.surface-render-lifecycle/5',
      getAppTarget() { return null; },
      setAppTarget() {},
      subscribeRender() { return () => {}; },
      localization: {
        schema: 'ordax.localization/2',
        getLocale() { return 'pt-BR'; },
        getProfile() { return localeProfile; },
        translate(messageId, parameters) {
          if (typeof parameters?.reason === 'string') return messageId + ': ' + parameters.reason;
          return messageId;
        },
        subscribe() { return () => {}; },
      },
    };
    const proofRequests = [];
    let deferStoreInstall = false;
    let resolveStoreInstall = null;
    const proofRequestsPort = {
      schema: 'ordax.app-lifecycle-request-port/1', authority: 'none',
      requestLifecycle(request) {
        proofRequests.push(request);
        if (request.operation === 'install') {
          if (deferStoreInstall) return new Promise((resolve) => { resolveStoreInstall = resolve; });
          return {
            schema: 'ordax.app-lifecycle-request-result/1',
            requestId: request.requestId, appId: request.appId,
            operation: request.operation, source: request.source,
            state: 'rejected', reason: 'incompatible-host-policy', authority: 'none',
          };
        }
        throw new Error('intentional synchronous Store proof failure');
      },
    };
    const storeProof = mountStoreOverviewControls(
      storeProofRoot, proofCatalog, proofLifecycle, proofRequestsPort,
    );
    const proofStoreSlot = storeProofRoot.querySelector('[data-app-extension="store-overview"]');
    result.storeVerifiedCatalogRendered = proofStoreSlot?.dataset.storeState === 'ready'
      && proofStoreSlot.querySelectorAll('[data-store-app-card]').length === 3;
    result.storeAlphabeticallySorted = Array.from(proofStoreSlot.querySelectorAll('[data-store-app-card]'))
      .map((card) => card.dataset.storeAppId).join(',') === 'files,audio,studio';
    storeProofRoot.style.width = '430px';
    result.storeResizesWithWindow = getComputedStyle(
      proofStoreSlot.querySelector('.ordax-store-layout'),
    ).gridTemplateColumns.split(' ').length === 1;
    storeProofRoot.style.width = '1100px';
    const proofSearch = proofStoreSlot.querySelector('[data-store-search]');
    proofSearch.value = 'audio';
    proofSearch.dispatchEvent(new Event('input', { bubbles: true }));
    result.storeAccentInsensitiveSearch = proofStoreSlot.querySelector('[data-store-app-card][data-store-app-id="audio"]')?.hidden === false
      && proofStoreSlot.querySelector('[data-store-app-card][data-store-app-id="files"]')?.hidden === true;
    proofSearch.focus();
    notifyStore(verifiedStoreSnapshot);
    result.storePreservesSearchFocus = document.activeElement
      === proofStoreSlot.querySelector('[data-store-search]');
    const installedTab = proofStoreSlot.querySelector('[data-store-view="installed"]');
    installedTab.click();
    const installedSearch = proofStoreSlot.querySelector('[data-store-search]');
    installedSearch.value = '';
    installedSearch.dispatchEvent(new Event('input', { bubbles: true }));
    result.storeInstalledFilter = proofStoreSlot.querySelector('[data-store-app-card][data-store-app-id="audio"]')?.hidden === true
      && proofStoreSlot.querySelector('[data-store-app-card][data-store-app-id="files"]')?.hidden === false;
    proofStoreSlot.querySelector('[data-store-details="files"]').click();
    const removeAction = () => proofStoreSlot.querySelector('[data-store-operation="remove"]');
    removeAction().click();
    result.storeRemovalRequiresConfirmation = proofRequests.length === 0
      && proofStoreSlot.querySelector('[data-store-confirm-remove]') !== null;
    proofStoreSlot.querySelector('[data-store-cancel-remove]').click();
    result.storeRemovalCanCancel = proofRequests.length === 0
      && proofStoreSlot.querySelector('[data-store-confirm-remove]') === null;
    removeAction().click();
    proofStoreSlot.querySelector('[data-store-confirm-remove]').click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    result.storeSyncFailureRecovered = proofRequests.length === 1
      && proofRequests[0].operation === 'remove'
      && proofRequests[0].authority === 'none'
      && proofStoreSlot.querySelector('[data-store-operation="remove"]')?.disabled === false
      && proofStoreSlot.querySelector('.ordax-store-request-status')?.textContent === 'store.request.remove.failed';
    proofStoreSlot.querySelector('[data-store-back]').click();
    proofStoreSlot.querySelector('[data-store-view="discover"]').click();
    proofStoreSlot.querySelector('[data-store-app-id="audio"] [data-store-operation="install"]').click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    result.storeShowsValidatedRejectionReason = proofRequests.length === 2
      && proofRequests[1].operation === 'install'
      && proofStoreSlot.querySelector('.ordax-store-request-status')?.textContent
        ?.includes('incompatible-host-policy') === true;

    // A delayed platform reply must not mark a request as accepted after a
    // different signed catalog projection has replaced the visible candidate.
    deferStoreInstall = true;
    proofStoreSlot.querySelector('[data-store-app-id="audio"] [data-store-operation="install"]').click();
    await Promise.resolve();
    const delayedStoreRequest = proofRequests.at(-1);
    result.storeDeferredRequestStarted = proofRequests.length === 3
      && delayedStoreRequest?.operation === 'install'
      && typeof resolveStoreInstall === 'function';
    notifyStore(verifiedStoreSnapshot);
    result.storeRetainsRequestOnIdenticalSnapshot =
      proofStoreSlot.querySelector('[data-store-app-id="audio"] [data-store-operation="install"]')?.disabled === true;
    const replacedStoreSnapshot = {
      ...verifiedStoreSnapshot,
      entries: verifiedStoreEntries.map((entry) => entry.appId === 'audio'
        ? { ...entry, availableVersion: '1.0.1' } : entry),
    };
    notifyStore(replacedStoreSnapshot);
    result.storeInvalidatesRequestOnCatalogChange =
      proofStoreSlot.querySelector('[data-store-app-id="audio"] [data-store-operation="install"]')?.disabled === false
      && proofStoreSlot.querySelector('.ordax-store-request-status') === null;
    resolveStoreInstall({
      schema: 'ordax.app-lifecycle-request-result/1',
      requestId: delayedStoreRequest.requestId, appId: delayedStoreRequest.appId,
      operation: delayedStoreRequest.operation, source: delayedStoreRequest.source,
      state: 'accepted', reason: null, authority: 'none',
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    result.storeIgnoresStaleAcceptedResponse =
      proofStoreSlot.querySelector('[data-store-app-id="audio"] [data-store-operation="install"]')?.disabled === false
      && proofStoreSlot.querySelector('.ordax-store-request-status') === null;

    // The microtask that would invoke Native has not run yet. If the signed
    // catalog changes now, no obsolete request may ever cross that boundary.
    const previousStoreRequestCount = proofRequests.length;
    proofStoreSlot.querySelector('[data-store-app-id="audio"] [data-store-operation="install"]').click();
    notifyStore({
      ...replacedStoreSnapshot,
      entries: replacedStoreSnapshot.entries.map((entry) => entry.appId === 'audio'
        ? { ...entry, availableVersion: '1.0.2' } : entry),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    result.storeNeverDelegatesRevokedRequest = proofRequests.length === previousStoreRequestCount
      && proofStoreSlot.querySelector('[data-store-app-id="audio"] [data-store-operation="install"]')?.disabled === false
      && proofStoreSlot.querySelector('.ordax-store-request-status') === null;

    storeProof.destroy();
    storeProofRoot.remove();
    result.storeVerifiedFixtureCleaned = notifyStore === null;

    // Internet coverage must remain independent from Notes. Before the
    // remove-first cutover this target was reached through a Notes reference,
    // which accidentally made the browser smoke depend on the removed app.
    const internetLaunch = root.querySelector('[data-launch-app="internet"]');
    if (!internetLaunch) throw new Error('composition smoke could not find launcher app: internet');
    internetLaunch.dataset.appTarget = 'https://example.com/docs?q=1';
    internetLaunch.click();
    await Promise.resolve();
    delete internetLaunch.dataset.appTarget;

    const internetSlot = root.querySelector(
      '[data-window-id="internet"] [data-app-extension="internet-browser"]',
    );
    const internetWorkspace = parsedStorage('ordax.workspace.v2');
    const internetArea = internetWorkspace?.areas
      ?.find((area) => area.id === internetWorkspace.activeAreaId) ?? internetWorkspace?.areas?.[0];
    const storedInternet = internetArea?.windows?.find((item) => item.appId === 'internet');
    result.internetTargetPersisted = storedInternet?.target === 'https://example.com/docs?q=1';
    result.internetFailsClosedOnWeb = internetSlot
      ?.querySelector('.ordax-internet-unavailable')?.textContent
      ?.includes('Navegação integrada não disponível neste host') === true;
    result.internetDoesNotEmbedWebContent = internetSlot?.querySelector('iframe') === null
      && internetSlot?.querySelector('[data-browser-viewport] iframe') === null;

    await launch('account');
    const accountSlot = root.querySelector(
      '[data-window-id="account"] [data-app-extension="account-overview"]',
    );
    result.accountOwnerMounted = Boolean(accountSlot?.dataset.ordaxAccountOverviewView !== undefined);
    result.accountUnavailable = accountSlot?.querySelector('.ordax-account-status')?.dataset.state === 'unavailable';
    result.accountNoFakeIdentityAction = accountSlot?.querySelector('[data-account-identity-action]') === null;

    await launch('system');
    const systemSlot = root.querySelector(
      '[data-window-id="system"] [data-app-extension="system-overview"]',
    );
    result.systemOwnerMounted = Boolean(systemSlot?.dataset.ordaxSystemOverviewView !== undefined);
    result.systemOverviewDefault = systemSlot?.dataset.systemActiveSection === 'overview';
    result.systemNavigationComplete = systemSlot?.querySelectorAll('[data-system-section]').length === 5;

    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    result.firstMountDestroyed = root.childElementCount === 0;
    result.textScaleClearedOnDestroy = document.documentElement.dataset.ordaxTextScale === undefined;
    result.internetComponentStyleRemovedOnDestroy = document.querySelector(
      'link[data-ordax-component-style="internet"]',
    ) === null;

    document.body.replaceChildren();
    const remountBootScreen = document.createElement('div');
    remountBootScreen.id = 'ordax-boot-screen';
    remountBootScreen.className = 'ordax-boot-screen';
    remountBootScreen.dataset.state = 'loading';
    const remountBootStatus = document.createElement('span');
    remountBootStatus.dataset.ordaxBootStatus = '';
    remountBootStatus.textContent = 'Preparando OrdaX…';
    remountBootScreen.append(remountBootStatus);
    const remountRoot = document.createElement('div');
    remountRoot.id = 'ordax-root';
    document.body.append(remountBootScreen, remountRoot);
    await import(namespaceUrls['composition-remount'][rootModule]);
    await Promise.resolve();
    root = document.querySelector('#ordax-root');
    result.remountCompositionMounted = Boolean(root?.querySelector('[data-workspace]'));
    result.remountBootScreenCompleted = remountBootScreen.hidden === true
      && remountBootScreen.dataset.state === 'ready';
    result.internetComponentStyleRestored = Boolean(
      document.querySelector('link[data-ordax-component-style="internet"]'),
    );
    result.themeRestored = root?.dataset.ordaxTheme === 'dark';
    result.textScaleRestored = document.documentElement.dataset.ordaxTextScale === 'extra-large';

    const restoredSettingsSlot = root?.querySelector(
      '[data-window-id="settings"] [data-app-extension="settings-overview"]',
    );
    result.settingsWindowRestored = Boolean(restoredSettingsSlot);
    result.settingsTargetRestored = restoredSettingsSlot?.dataset.settingsActiveSection === 'accessibility';

    const restoredInternetSlot = root?.querySelector(
      '[data-window-id="internet"] [data-app-extension="internet-browser"]',
    );
    const restoredWorkspace = parsedStorage('ordax.workspace.v2');
    const restoredActiveArea = restoredWorkspace?.areas
      ?.find((area) => area.id === restoredWorkspace.activeAreaId) ?? restoredWorkspace?.areas?.[0];
    const restoredInternetWindow = restoredActiveArea?.windows
      ?.find((item) => item.appId === 'internet');
    result.internetWindowRestored = Boolean(
      restoredInternetSlot?.dataset.ordaxInternetMounted === 'true',
    );
    result.internetTargetRestored = restoredInternetWindow?.target
      === 'https://example.com/docs?q=1';
    result.internetStillFailsClosedOnWeb = restoredInternetSlot
      ?.querySelector('.ordax-internet-unavailable')?.textContent
      ?.includes('Navegação integrada não disponível neste host') === true;

    const restoredAccountSlot = root?.querySelector(
      '[data-window-id="account"] [data-app-extension="account-overview"]',
    );
    result.accountWindowRestored = Boolean(restoredAccountSlot);
    result.accountOwnerRestored = Boolean(restoredAccountSlot?.dataset.ordaxAccountOverviewView !== undefined);
    result.accountStillUnavailable = restoredAccountSlot?.querySelector('.ordax-account-status')?.dataset.state === 'unavailable';
    result.accountStillHasNoFakeIdentityAction = restoredAccountSlot?.querySelector('[data-account-identity-action]') === null;

    const restoredSystemSlot = root?.querySelector(
      '[data-window-id="system"] [data-app-extension="system-overview"]',
    );
    result.systemWindowRestored = Boolean(restoredSystemSlot);
    result.systemOwnerRestored = Boolean(restoredSystemSlot?.dataset.ordaxSystemOverviewView !== undefined);
    result.systemOverviewRestored = restoredSystemSlot?.dataset.systemActiveSection === 'overview';

    const required = [
      'compositionMounted', 'spaceSwitcherMounted', 'spaceSwitcherOpens', 'spaceSwitcherWebFailsClosed', 'spaceSwitcherEscapeCloses', 'spaceSwitcherKeyboardOpens', 'spaceSwitcherKeyboardFocusesAction', 'spaceSwitcherKeyboardRestoresFocus', 'spaceSwitcherFailureKeepsOptions', 'spaceSwitcherRetrySucceeds', 'spaceSwitcherSubjectMismatchFailsClosed', 'spaceSwitcherFixtureCleaned', 'bootScreenCompleted', 'settingsWindowMounted', 'settingsOwnerMounted', 'settingsStartsAppearance',
      'lightPreviewFollowsTokens', 'darkPreviewFollowsTokens', 'localBrandMaskLoaded', 'localFontLoaded',
      'globalHeaderClearOfWindows',
      'studioNavigationOpensSharedApp', 'studioWebAvailabilityIsHonest',
      'studioUnavailableDoesNotDisplayZeroMetrics', 'studioChatUsesExternalPublicSite',
      'studioProjectsUsesExistingOwner',
      'studioHasSingleContentHeading', 'studioDisclosureSurvivesNavigation',
      'homeShortcutOpensRealOwner', 'homeRestoresDesktopWithoutDeletingWindows',
      'homeNavigationReflectsWorkspace', 'homeNavigationClearsWhenAppIsActive',
      'dockShortcutOpensRealOwner', 'sharedShortcutLabels', 'localWallpaperBundled', 'localWallpaperDecoded',
      'darkActionPresent', 'darkThemeApplied', 'darkThemePersisted', 'accessibilityNavigationPresent',
      'accessibilityTargetApplied', 'extraLargeActionPresent', 'textScaleApplied', 'textScalePersisted',
      'workspaceTargetPersisted', 'notesAbsentFromLauncher', 'notesLocalWindowAbsent',
      'storeOwnerMounted', 'storeFailsClosedWithoutVerifiedCatalog',
      'storeVerifiedCatalogRendered', 'storeAlphabeticallySorted',
      'storeResizesWithWindow', 'storeAccentInsensitiveSearch', 'storePreservesSearchFocus',
      'storeInstalledFilter', 'storeRemovalRequiresConfirmation',
      'storeRemovalCanCancel', 'storeSyncFailureRecovered',
      'storeShowsValidatedRejectionReason', 'storeDeferredRequestStarted',
      'storeRetainsRequestOnIdenticalSnapshot',
      'storeInvalidatesRequestOnCatalogChange', 'storeIgnoresStaleAcceptedResponse',
      'storeNeverDelegatesRevokedRequest',
      'storeVerifiedFixtureCleaned', 'internetComponentStyleMounted',
      'networkComponentStyleMounted', 'networkOwnerMounted', 'networkWebUnavailableHonest',
      'projectsComponentStyleMounted', 'projectsOwnerMounted', 'projectsWebUnavailableHonest',
      'internetFailsClosedOnWeb', 'internetDoesNotEmbedWebContent',
      'accountOwnerMounted', 'accountUnavailable', 'accountNoFakeIdentityAction',
      'systemOwnerMounted', 'systemOverviewDefault',
      'systemNavigationComplete', 'firstMountDestroyed', 'textScaleClearedOnDestroy',
      'remountCompositionMounted', 'remountBootScreenCompleted', 'themeRestored', 'textScaleRestored', 'settingsWindowRestored',
      'internetWindowRestored', 'internetTargetRestored',
      'internetStillFailsClosedOnWeb',
      'accountWindowRestored', 'accountOwnerRestored', 'accountStillUnavailable', 'accountStillHasNoFakeIdentityAction', 'systemWindowRestored',
      'systemOwnerRestored', 'systemOverviewRestored',
    ];
    result.requiredAssertions = Object.fromEntries(required.map((name) => [name, Boolean(result[name])]));
    result.allCoreAssertions = Object.values(result.requiredAssertions).every(Boolean);

    window.dispatchEvent(new Event('pagehide'));
    for (const urls of Object.values(namespaceUrls)) {
      for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    }
    return result;
  })()`;
}

async function waitForPageReady(client, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const evaluation = await client.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      if (evaluation.result?.value === 'complete') return;
    } catch (error) {
      lastError = error;
    }
    await sleep(25);
  }
  throw new Error(`timed out waiting for blank browser document: ${lastError?.message ?? 'not ready'}`);
}

async function evaluateProof(client, expression, label) {
  const evaluation = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (evaluation.exceptionDetails) {
    const detail = evaluation.exceptionDetails.exception?.description
      ?? evaluation.exceptionDetails.exception?.value
      ?? evaluation.exceptionDetails.text
      ?? 'unknown exception';
    throw new Error(`${label} browser proof threw: ${detail}`);
  }
  const result = evaluation.result?.value;
  if (!result || result.allCoreAssertions !== true) {
    throw new Error(`${label} browser assertions failed: ${JSON.stringify(result, null, 2)}`);
  }
  return result;
}

let bundleDirGlobal = null;

async function main() {
  const { bundleDir } = parseArgs(process.argv.slice(2));
  bundleDirGlobal = bundleDir;
  if (typeof WebSocket !== 'function') {
    throw new Error(`Node ${process.version} does not provide the global WebSocket required by the CDP smoke gate`);
  }
  if (!existsSync(bundleDir)) throw new Error(`bundle directory does not exist: ${bundleDir}`);
  const modules = await collectModules(bundleDir);
  const assetUrls = await loadComponentAssetUrls(bundleDir);
  const styles = await loadStyles(bundleDir);
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

  const child = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
    const shellResult = await evaluateProof(
      client,
      buildProofExpression(modules, styles, assetUrls),
      'Surface shell',
    );
    await client.send('Page.navigate', { url: 'about:blank' });
    await waitForPageReady(client);
    const compositionResult = await evaluateProof(
      client,
      buildCompositionProofExpression(modules, styles, assetUrls),
      'Web composition',
    );
    const runtimeErrors = client.events.filter((event) => event.method === 'Runtime.exceptionThrown');
    const logErrors = client.events.filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error');
    if (runtimeErrors.length || logErrors.length) {
      throw new Error(`browser emitted runtime errors: ${JSON.stringify([...runtimeErrors, ...logErrors], null, 2)}`);
    }
    passed = true;
    console.log('SURFACE_BROWSER_SMOKE=PASS');
    console.log(`SURFACE_BROWSER_MODULE_COUNT=${modules.size}`);
    console.log(`SURFACE_BROWSER_EXECUTABLE=${browser}`);
    const shellAssertions = Object.keys(shellResult.requiredAssertions).length;
    const compositionAssertions = Object.keys(compositionResult.requiredAssertions).length;
    console.log(`SURFACE_BROWSER_SHELL_ASSERTIONS=${shellAssertions}`);
    console.log(`SURFACE_BROWSER_COMPOSITION_ASSERTIONS=${compositionAssertions}`);
    console.log(`SURFACE_BROWSER_ASSERTIONS=${shellAssertions + compositionAssertions}`);
  } finally {
    client?.close();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolvePromise) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolvePromise(); }, 2_000);
        child.once('exit', () => { clearTimeout(timer); resolvePromise(); });
      });
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (!passed && stderr) {
      process.stderr.write(`CHROMIUM_STDERR_BEGIN\n${stderr}\nCHROMIUM_STDERR_END\n`);
    }
  }
}

main().catch((error) => {
  console.error('SURFACE_BROWSER_SMOKE=FAIL');
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
});
