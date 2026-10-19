import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {windowReducer, initialWindows} from '../../../system/surface/workspace/lib/web/windows.ts';
import {createUnavailableWebIntelligencePort} from '../../../system/adapters/web/intelligence.mjs';
import {createIntelligenceClient} from '../../../system/surface/workspace/lib/intelligence/client.mjs';
import {desktopReducer, initialDesktopState} from '../../../system/surface/workspace/components/central/desktop-state.ts';
const root = new URL('../../../', import.meta.url);
const sourceRoot = new URL('system/surface/workspace/', root);
const provenance = JSON.parse(await readFile(new URL('docs/evidence/web-layout-reference-2026-10-10.json', root), 'utf8'));
const centralReference = JSON.parse(await readFile(new URL('docs/evidence/web-central-reference-2026-10-11.json', root), 'utf8'));
for (const entry of centralReference.files) {
  const bytes = await readFile(new URL(entry.target, root));
  const sha = value => createHash('sha256').update(value).digest('hex');
  if (entry.adaptedSha256) {
    assert.equal(sha(bytes.toString('utf8').replace(/\r\n/g, '\n')), entry.adaptedSha256, 'Central adaptation drift: ' + entry.target);
    assert.ok(entry.adaptation && /^[a-f0-9]{64}$/.test(entry.sha256), 'Adaptations retain upstream provenance');
    const history = entry.adaptationHistory ?? [];
    assert.ok(Array.isArray(history), 'Adaptation history must be structured: ' + entry.target);
    const recorded = new Set([entry.adaptedSha256]);
    for (const version of history) {
      assert.match(version.sha256, /^[a-f0-9]{64}$/, 'Historical digest must remain verifiable');
      assert.match(version.date, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'Historical revision requires a date');
      assert.ok(typeof version.reason === 'string' && version.reason.trim().length >= 20, 'History requires a meaningful reason');
      assert.ok(!recorded.has(version.sha256), 'Central adaptation SHA-256 must not be repeated');
      recorded.add(version.sha256);
    }
    continue;
  }
  const candidates = [sha(bytes)];
  if (!entry.source.startsWith('src/assets/')) {
    let restored = bytes.toString('utf8').replace(/\r\n/g, '\n');
    for (const edit of [...(centralReference.textChanges[entry.source] ?? [])].reverse()) {
      const from = edit.from.replace(/\r\n/g, '\n');
      const to = edit.to.replace(/\r\n/g, '\n');
      assert.ok(restored.includes(to), 'Missing integration adjustment: ' + entry.target);
      restored = restored.replaceAll(to, from);
    }
    candidates.push(sha(restored), sha(restored.replace(/\n/g, '\r\n')));
  }
  assert.ok(candidates.includes(entry.sha256), 'Central reference drift: ' + entry.target);
}
for (const entry of centralReference.native_files ?? []) {
  const source = (await readFile(new URL(entry.target, root), 'utf8')).replace(/\r\n/g, '\n');
  const currentDigest = createHash('sha256').update(source).digest('hex');
  if (entry.adaptedSha256) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, 'Historical Native Central provenance must be retained');
    assert.match(entry.adaptedSha256, /^[a-f0-9]{64}$/, 'Native adaptation digest must be valid');
    assert.ok(typeof entry.adaptation === 'string' && entry.adaptation.trim(), 'Native adaptation requires an explanation');
    assert.equal(currentDigest, entry.adaptedSha256, 'Native Central adaptation drift: ' + entry.target);
    const history = entry.adaptationHistory ?? [];
    assert.ok(Array.isArray(history), 'Native adaptation history must be structured');
    const digests = new Set([entry.adaptedSha256]);
    for (const revision of history) {
      assert.match(revision.sha256, /^[a-f0-9]{64}$/, 'Native historical digest must be valid');
      if (revision.date !== undefined) assert.match(revision.date, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'Native history date must be ISO');
      assert.ok(typeof revision.reason === 'string' && revision.reason.trim().length >= 20, 'Native provenance requires a meaningful historical reason');
      assert.ok(!digests.has(revision.sha256), 'Native history must not repeat a digest');
      digests.add(revision.sha256);
    }
  } else {
    assert.equal(currentDigest, entry.sha256, 'Native Central source drift: ' + entry.target);
  }
}
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
let verified = 0;
for (const entry of provenance.files) {
  if (entry.path === 'src/lib/intelligence/ai.functions.ts' || Object.hasOwn(provenance.excluded_files ?? {}, entry.path)) continue;
  let bytes = await readFile(new URL(entry.path.replace(/^src\//, ''), sourceRoot));
  const sha = value => createHash('sha256').update(value).digest('hex');
  if (entry.adaptedSha256) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, 'Adaptations retain the upstream digest');
    assert.ok(entry.adaptation, 'Adapted reference requires its migration explanation');
    assert.equal(sha(bytes.toString('utf8').replace(/\r\n/g, '\n')), entry.adaptedSha256, 'Adapted reference drift: ' + entry.path);
    if (entry.runtime) {
      const runtime = await readFile(new URL(entry.runtime.target, root), 'utf8');
      assert.equal(sha(runtime.replace(/\r\n/g, '\n')), entry.runtime.sha256, 'Shared runtime drift: ' + entry.runtime.target);
    }
    verified++;
    continue;
  }
  const candidates = [sha(bytes)];
  if (!entry.path.startsWith('src/assets/')) {
    // Normalize both the source and recorded edits before reversing multiline changes.
    // Windows checkouts use CRLF; the provenance may have been recorded with LF.
    const restore = raw => {
      let source = raw.replace(/\r\n/g, '\n');
      for (const change of [...(provenance.textChanges?.[entry.path] ?? [])].reverse()) {
        const from = change.from.replace(/\r\n/g, '\n');
        const to = change.to.replace(/\r\n/g, '\n');
        assert.ok(to.length > 0 && source.includes(to), 'Recorded adjustment missing: ' + entry.path);
        source = source.replaceAll(to, from);
      }
      return source;
    };
    const text = bytes.toString('utf8');
    const restored = restore(text);
    assert.equal(restore(text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')), restored,
      'Reference restoration must work for Windows and Unix checkouts: ' + entry.path);
    candidates.push(sha(restored), sha(restored.replace(/\n/g, '\r\n')));
  }
  assert.ok(candidates.includes(entry.sha256), 'Reference drift: ' + entry.path);
  verified++;
}
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
console.log('PASS: ' + verified + ' reference files/assets (recorded edits reversed for LF/CRLF); window lifecycle, geometry and canonical fail-closed AI');

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
