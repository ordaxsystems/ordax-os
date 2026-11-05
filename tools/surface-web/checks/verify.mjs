import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {verifyPinnedExternalSurface} from './verified-external-source.mjs';

const root = new URL('../../../', import.meta.url);
// Verify the immutable Git-sourced visual tree and its assembly receipt
// *before* executing any external Surface module.
// The canonical prepare-verified-surface action already leaves a verified
// assembly receipt under RUNNER_TEMP. Reuse it without changing the shared
// Owner/Dev producer action or weakening its source-blob validation.
const assemblyReceipt = process.env.ORDAX_VERIFIED_SURFACE_ASSEMBLY_RECEIPT ||
  (process.env.RUNNER_TEMP && join(process.env.RUNNER_TEMP,
    'ordax-verified-surface-ci/system/surface/source-provenance.json'));
const verified = await verifyPinnedExternalSurface(fileURLToPath(root), assemblyReceipt);
const [
  {windowReducer, initialWindows},
  {createUnavailableWebIntelligencePort},
  {createIntelligenceClient},
  {desktopReducer, initialDesktopState},
] = await Promise.all([
  import('../../../system/surface/workspace/lib/web/windows.ts'),
  import('../../../system/adapters/web/intelligence.mjs'),
  import('../../../system/surface/workspace/lib/intelligence/client.mjs'),
  import('../../../system/surface/workspace/components/central/desktop-state.ts'),
]);

const composition = await readFile(new URL('system/composition/web/main.tsx', root), 'utf8');
assert.ok(composition.includes('<Central key='), 'The approved Central is the primary Web page');
assert.ok(!composition.includes('WebShell'), 'Previous Web presentation must not be mounted');
const initialDesktopSnapshot = JSON.stringify(initialDesktopState);
let desktop = desktopReducer(initialDesktopState, {type: 'open', title: 'Projetos'});
desktop = desktopReducer(desktop, {type: 'open', title: 'Projetos'});
assert.equal(desktop.windows.length, 1, 'Opening twice must not duplicate a desktop window');
desktop = desktopReducer(desktop, {type: 'open', title: 'Arquivos'});
desktop = desktopReducer(desktop, {type: 'show-desktop'});
assert.equal(desktop.active, null);
assert.ok(desktop.windows.every(window => window.minimized));
const minimizedSnapshot = desktop;
desktop = desktopReducer(desktop, {type: 'focus', title: 'Projetos'});
assert.equal(desktop, minimizedSnapshot, 'Programmatic focus cannot restore a minimized app');
desktop = desktopReducer(desktop, {type: 'open', title: 'Projetos'});
assert.equal(desktop.active, 'Projetos');
assert.equal(desktop.windows.at(-1).title, 'Projetos');
assert.equal(desktop.windows.at(-1).minimized, false);
assert.equal(desktop.windows.at(-1).mode, 'maximized', 'New apps occupy the available workspace');
desktop = desktopReducer(desktop, {type: 'maximize', title: 'Projetos'});
assert.equal(desktop.windows.at(-1).mode, 'normal');
desktop = desktopReducer(desktop, {type: 'compact', title: 'Projetos'});
desktop = desktopReducer(desktop, {type: 'toggle-compact'});
assert.equal(desktop.compactCollapsed, true);
desktop = desktopReducer(desktop, {type: 'minimize', title: 'Projetos'});
assert.equal(desktop.windows.at(-1).mode, 'compact', 'Minimizing preserves compact mode');
const hiddenCompact = desktop;
desktop = desktopReducer(desktop, {type: 'focus', title: 'Projetos'});
assert.equal(desktop, hiddenCompact, 'Focus restoration after compact-menu dismissal stays minimized');
desktop = desktopReducer(desktop, {type: 'open', title: 'Projetos'});
assert.equal(desktop.compactCollapsed, false);
desktop = desktopReducer(desktop, {type: 'restore', title: 'Projetos'});
assert.equal(desktop.windows.at(-1).mode, 'normal', 'Leaving compact restores the prior size');
const unchanged = desktopReducer(desktop, {type: 'focus', title: 'Unknown'});
assert.equal(unchanged, desktop, 'Unknown focus never creates another app');
desktop = desktopReducer(desktop, {type: 'close', title: 'Projetos'});
assert.ok(!desktop.windows.some(window => window.title === 'Projetos'));
assert.equal(JSON.stringify(initialDesktopState), initialDesktopSnapshot);
const before = JSON.stringify(initialWindows);
let windows = windowReducer(initialWindows, {type:'open', appId:'studio'});
assert.equal(windows.length, initialWindows.length, 'Opening an existing app must not duplicate it');
assert.equal(windows.find(w => w.appId === 'studio').mode, 'maximized', 'Detached app opens across the full workspace');
windows = windowReducer(windows, {type:'minimize', appId:'studio'});
windows = windowReducer(windows, {type:'restore', appId:'studio'});
assert.equal(windows.find(w => w.appId === 'studio').mode, 'maximized', 'Restore preserves maximized state');
windows = windowReducer(windows, {type:'maximize', appId:'studio'});
windows = windowReducer(windows, {type:'geometry', appId:'studio', x:1000, y:-1000, width:50, height:40});
const studio = windows.find(w => w.appId === 'studio');
assert.ok(studio.x >= 0 && studio.y >= 0 && studio.x + studio.width <= 100 && studio.y + studio.height <= 100, 'Window remains inside workspace');
windows = windowReducer(windows, {type:'close', appId:'studio'});
assert.ok(!windows.some(w => w.appId === 'studio'));
windows = windowReducer(windows, {type:'open', appId:'studio'});
assert.equal(windows.filter(w => w.appId === 'studio').length, 1);
assert.equal(JSON.stringify(initialWindows), before, 'Interactions preserve initial state');
let opened=windowReducer([], {type:'open', appId:'notes'});
assert.equal(opened[0].mode,'maximized');
opened=windowReducer(opened,{type:'maximize',appId:'notes'});
opened=windowReducer(opened,{type:'geometry',appId:'notes',x:10,y:10,width:45,height:40});
opened=windowReducer(opened,{type:'open',appId:'notes'});
assert.equal(opened[0].mode,'normal','Reopening preserves the manually restored mode');
assert.equal(opened[0].width,45);
opened=windowReducer(opened,{type:'open',appId:'settings'});
for(let i=0;i<80;i++)opened=windowReducer(opened,{type:'focus',appId:i%2?'notes':'settings'});
assert.ok(opened.find(w=>w.appId==='notes').layer>opened.find(w=>w.appId==='settings').layer,'Repeated focus retains strict stacking order');
const intelligence = createIntelligenceClient(createUnavailableWebIntelligencePort());
assert.equal(intelligence.getSnapshot().state, 'degraded', 'Web fallback must remain explicitly unavailable');
await assert.rejects(intelligence.ask('verification'), /not ready/, 'Visual preview must not execute a model');
console.log('PASS: ' + verified + ' pinned external Surface files verified by immutable assembly receipt; window lifecycle, geometry and canonical fail-closed AI');

if (process.argv.includes('--preview')) {
  const origin = 'http://127.0.0.1:4201';
  for (const path of ['/web2', '/web2/']) assert.equal((await fetch(origin + path)).status, 404, 'Retired route must not be preserved: ' + path);
  let html = '';
  for (const path of ['/']) {
    const response = await fetch(new URL(path, origin), {signal: AbortSignal.timeout(8000)});
    assert.equal(response.status, 200, 'Direct reload fails: ' + path);
    html = await response.text();
    assert.ok(html.includes('<div id="ordax-root"></div>'), 'Missing app document: ' + path);
  }
  assert.ok(html.includes('<meta name="color-scheme" content="light dark"'), 'Both native-control themes must be supported');
  const assets = [...html.matchAll(/(?:src|href)="((?:\.\/|\/)assets\/[^" ]+)"/g)].map(match => match[1]);
  assert.ok(assets.length >= 2, 'Missing compiled JS/CSS references');
  const compiledAssets = await readdir(new URL('out/web-ui/assets/', root));
  for (const path of new Set([...assets, ...compiledAssets.map(name => '/assets/' + name)])) {
    const response = await fetch(new URL(path, origin + '/'), {signal: AbortSignal.timeout(8000)});
    assert.equal(response.status, 200, 'Missing asset: ' + path);
    assert.ok(!response.headers.get('content-type')?.includes('text/html'), 'HTML fallback instead of asset: ' + path);
    const served = Buffer.from(await response.arrayBuffer());
    const built = await readFile(new URL('out/web-ui/' + path.replace(/^\.\//, '').replace(/^\//, ''), root));
    assert.equal(createHash('sha256').update(served).digest('hex'), createHash('sha256').update(built).digest('hex'), 'Stale build served: ' + path);
  }
  console.log('PASS: primary Central reload; ' + compiledAssets.length + ' build assets match served bytes; both native-control themes declared (HTTP only, not browser rendering)');
}
