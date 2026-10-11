import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {windowReducer, initialWindows} from '../../../system/surface/workspace/lib/web/windows.ts';
import {askIntelligence} from '../../../system/surface/workspace/lib/intelligence/ai.functions.ts';
const root = new URL('../../../', import.meta.url);
const sourceRoot = new URL('system/surface/workspace/', root);
const provenance = JSON.parse(await readFile(new URL('docs/evidence/web-layout-reference-2026-10-10.json', root), 'utf8'));
let verified = 0;
for (const entry of provenance.files) {
  if (entry.path === 'src/lib/intelligence/ai.functions.ts' || Object.hasOwn(provenance.excluded_files ?? {}, entry.path)) continue;
  let bytes = await readFile(new URL(entry.path.replace(/^src\//, ''), sourceRoot));
  const sha = value => createHash('sha256').update(value).digest('hex');
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
assert.deepEqual(initialWindows, [], 'Home starts without opening demo app windows');
const before = JSON.stringify(initialWindows);
let windows = windowReducer(initialWindows, {type:'open', appId:'studio'});
assert.equal(windows.length, 1, 'Opening the first app creates one window');
windows = windowReducer(windows, {type:'open', appId:'studio'});
assert.equal(windows.length, 1, 'Opening an existing app must not duplicate it');
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
const result = await askIntelligence({message:'verification'});
assert.equal(result.ok, false);
assert.equal(result.status, 503, 'Visual preview must not execute a model');
console.log('PASS: ' + verified + ' reference files/assets (recorded edits reversed for LF/CRLF); window lifecycle, geometry and disabled AI');

if (process.argv.includes('--preview')) {
  const origin = 'http://127.0.0.1:4201';
  const views = ['home', 'assistant', 'apps', 'projects', 'files', 'spaces', 'internet', 'store'];
  for (const path of ['/web2', '/web2/']) assert.equal((await fetch(origin + path)).status, 404, 'Retired route must not be preserved: ' + path);
  let html = '';
  for (const path of ['/', ...views.map(view => '/?view=' + view)]) {
    const response = await fetch(new URL(path, origin), {signal: AbortSignal.timeout(8000)});
    assert.equal(response.status, 200, 'Direct reload fails: ' + path);
    html = await response.text();
    assert.ok(html.includes('<div id="ordax-root"></div>'), 'Missing app document: ' + path);
  }
  assert.ok(html.includes('<meta name="color-scheme" content="dark"'), 'Native controls must match the dark theme');
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
  console.log('PASS: preview direct reload for 8 views; ' + compiledAssets.length + ' build assets match served bytes; dark native controls declared (HTTP only, not browser rendering)');
}
