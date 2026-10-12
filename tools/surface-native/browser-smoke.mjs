#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname,isAbsolute,join,normalize,relative,resolve,sep} from 'node:path';
import {runBrowser, sleep} from '../browser-proof/chromium.mjs';
const ROOT_MODULES = ['system/surface/ui/surface.mjs'];
const STATIC_IMPORT_RE = /\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const ASSET_HREF_RE = /\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)\.href/g;
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
  'system/surface/ui/brand/symbol.css',
];
const COMPONENT_ASSET_FILES = Object.freeze({
  'system/apps/assistant/assistant.css': 'text/css',
  'system/apps/studio/studio.css': 'text/css',
});

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

// Keep raster URLs short in the about:blank fixture, while decoding the exact
// offline bundle bytes. CSS variable substitution need not carry megabytes of
// base64 inside a declaration. The private proof page owns the Blob lifetime.
function injectedStylesExpression(styles) {
  return `(() => {
    const localPngUrls = new Map();
    return (${JSON.stringify(styles)}).replace(/url\\("data:image\\/png;base64,([^\"]+)"\\)/g, (_, encoded) => {
      if (!localPngUrls.has(encoded)) {
        const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
        localPngUrls.set(encoded, URL.createObjectURL(new Blob([bytes], { type: 'image/png' })));
      }
      return 'url("' + localPngUrls.get(encoded) + '")';
    });
  })()`;
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


bundleDirGlobal = resolve('.');
const modules = await collectModules(bundleDirGlobal);
const assetUrls = await loadComponentAssetUrls(bundleDirGlobal);
const styles = await loadStyles(bundleDirGlobal);
runBrowser(client => evaluateProof(client, buildProofExpression(modules, styles, assetUrls), 'Native shared shell')).then(() => console.log('NATIVE_SHARED_SHELL_PROOF=PASS')).catch(error => {console.error(error); process.exitCode = 1;});
