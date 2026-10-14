import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server, session, data, domain, catalog;
before(async () => {
  server = await createServer({
    configFile: fileURLToPath(new URL('../tools/surface-web/vite.store-preview.config.ts', import.meta.url)),
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
  });
  const load = path => server.ssrLoadModule('/@fs/' + fileURLToPath(new URL('../' + path, import.meta.url)));
  [session, data, domain, catalog] = await Promise.all([
    load('system/composition/web/store-preview/session.js'),
    load('system/composition/web/store-preview/preview-data.js'),
    load('system/surface/workspace/lib/store/state.ts'),
    load('system/surface/workspace/lib/store/catalog.ts'),
  ]);
});
after(async () => { await server?.close(); });
const find = id => data.items.find(item => item.id === id);
const fresh = () => structuredClone(domain.initialStore);
const request = (state, id, itemId, op) => domain.storeReducer(state, { type: 'request', id, itemId, op });
function finish(state, steps = new Map()) {
  let result;
  for (let n = 0; n < 40 && domain.activeOps(state).length; n++) {
    result = session.advanceQueue(state, steps, find);
    state = result.state; steps = result.steps;
  }
  assert.equal(domain.activeOps(state).length, 0, 'The demo queue must settle within its bounded visual steps');
  return { state, steps, finished: result?.finished };
}

test('preview search finds descriptions, publishers, categories and capabilities without changing fixtures', () => {
  const before = JSON.stringify(data.items);
  assert.deepEqual(catalog.searchCatalog('bloco de notas', 'app', data.items).map(i => i.id), ['notes']);
  assert.equal(catalog.searchCatalog('ordax systems', 'app', data.items).length, 4);
  assert.ok(catalog.searchCatalog('produtividade', 'app', data.items).some(i => i.id === 'notes'));
  const provider = data.items.find(i => i.kind === 'provider' && i.capabilities.length);
  assert.ok(catalog.searchCatalog(provider.capabilities[0], 'provider', data.items).some(i => i.id === provider.id));
  assert.deepEqual(catalog.searchCatalog('aplicativo', 'app', []).map(i => i.id), [], 'An empty supplied catalog cannot fall back to fixtures');
  assert.equal(JSON.stringify(data.items), before);
});

test('preview search normalizes accents and respects a type-only filter', () => {
  const plain = catalog.searchCatalog('midia', 'app', data.items).map(i => i.id);
  const accented = catalog.searchCatalog('mídia', 'app', data.items).map(i => i.id);
  assert.ok(plain.includes('media'));
  assert.deepEqual(plain, accented, 'Accent normalization must also apply to matching descriptions');
  const models = catalog.searchCatalog('', 'model', data.items);
  assert.ok(models.length > 0);
  assert.ok(models.every(i => i.kind === 'model'));
});

test('idle preview queue preserves reference identity and never invents an operation', () => {
  const state = fresh(), steps = new Map();
  assert.deepEqual(session.advanceQueue(state, steps, find), { state, steps, finished: null });
  assert.equal(session.advanceQueue(state, steps, find).state, state);
  assert.equal(session.advanceQueue(state, steps, find).steps, steps);
});

test('the oldest demo request progresses alone; accepted is not installed', () => {
  let state = request(fresh(), 'first', 'media', 'install');
  state = request(state, 'second', 'lint-tools', 'update');
  let steps = new Map();
  for (let n = 0; n < 2; n++) {
    const next = session.advanceQueue(state, steps, find);
    state = next.state; steps = next.steps;
  }
  assert.equal(state.ops.find(o => o.id === 'first').state, 'running');
  assert.equal(state.ops.find(o => o.id === 'second').state, 'requested');
  assert.equal(domain.statusOf(state, find('media')), 'available');
  state = finish(state, steps).state;
  assert.equal(domain.statusOf(state, find('media')), 'installed');
  assert.equal(state.ops.find(o => o.id === 'second').state, 'succeeded');
});

test('repeated clicks do not create parallel operations for one demo item', () => {
  const state = request(fresh(), 'first', 'media', 'install');
  const repeated = request(state, 'second', 'media', 'install');
  assert.equal(repeated, state);
  assert.equal(repeated.ops.filter(o => o.itemId === 'media').length, 1);
});

test('cancelling a requested or accepted demo operation preserves the installed state', () => {
  for (const accepted of [false, true]) {
    let state = request(fresh(), 'cancel-me', 'files', 'update');
    let steps = new Map();
    if (accepted) ({ state, steps } = session.advanceQueue(state, steps, find));
    const originalSteps = new Map(steps);
    const result = session.cancelRequest(state, steps, 'cancel-me');
    assert.equal(result.cancelled, true);
    assert.equal(result.state.ops.length, 0);
    assert.equal(domain.statusOf(result.state, find('files')), 'update-available');
    assert.deepEqual(steps, originalSteps, 'Cancelling must not mutate an earlier render snapshot');
  }
});

test('an in-flight demo operation cannot be dismissed by the safe-cancel action', () => {
  let state = request(fresh(), 'running', 'files', 'update'), steps = new Map();
  for (let n = 0; n < 2; n++) ({ state, steps } = session.advanceQueue(state, steps, find));
  const next = session.cancelRequest(state, steps, 'running');
  assert.equal(next.cancelled, false);
  assert.equal(next.state, state);
  assert.equal(next.steps, steps);
  assert.equal(session.cancelRequest(state, steps, 'unknown').cancelled, false);
});

test('failed demo update keeps the previous version and does not block the next queued item', () => {
  const fixtureBefore = JSON.stringify(find('notes'));
  let state = request(fresh(), 'notes-fail', 'notes', 'update');
  state = request(state, 'files-next', 'files', 'update');
  state = finish(state).state;
  assert.equal(state.ops.find(o => o.id === 'notes-fail').state, 'failed');
  assert.match(state.ops.find(o => o.id === 'notes-fail').message, /version|versão/i);
  assert.equal(domain.statusOf(state, find('notes')), 'update-available');
  assert.equal(state.ops.find(o => o.id === 'files-next').state, 'succeeded');
  assert.equal(domain.statusOf(state, find('files')), 'installed');
  assert.equal(JSON.stringify(find('notes')), fixtureBefore);
});

test('demo removal completes before an explicit reinstall can claim installed state', () => {
  let state = request(fresh(), 'remove', 'studio', 'remove');
  state = finish(state).state;
  assert.equal(domain.statusOf(state, find('studio')), 'available');
  assert.equal(session.advanceQueue(state, new Map(), find).state, state, 'Idle ticks cannot reinstall a removed app');
  state = request(state, 'reinstall', 'studio', 'install');
  assert.equal(domain.statusOf(state, find('studio')), 'available');
  state = finish(state).state;
  assert.equal(domain.statusOf(state, find('studio')), 'installed');
});

test('a model install stays blocked and cannot become an installed demo app', () => {
  const model = find('llama-8b');
  const state = request(fresh(), 'model', model.id, 'install');
  assert.equal(state.ops[0].state, 'blocked');
  assert.equal(domain.statusOf(state, model), 'informational');
  assert.equal(session.advanceQueue(state, new Map(), find).state, state);
});

test('connector authorization is separate from installation and can be cancelled', () => {
  let state = request(fresh(), 'connect', 'notion', 'connect');
  assert.equal(domain.statusOf(state, find('notion')), 'authorization-required');
  assert.equal(domain.activeOps(state).length, 0);
  state = domain.storeReducer(state, { type: 'authorize', itemId: 'notion', approve: false });
  assert.equal(domain.statusOf(state, find('notion')), 'disconnected');
  state = request(state, 'connect-again', 'notion', 'connect');
  state = domain.storeReducer(state, { type: 'authorize', itemId: 'notion', approve: true });
  state = finish(state).state;
  assert.equal(domain.statusOf(state, find('notion')), 'connected');
  assert.notEqual(domain.statusOf(state, find('notion')), 'installed');
});

test('missing agent dependency is a visible block rather than an enabled state', () => {
  const state = request(fresh(), 'agent', 'projects-agent', 'enable');
  assert.equal(state.ops[0].state, 'blocked');
  assert.match(state.ops[0].message, /dependência/i);
  assert.equal(domain.statusOf(state, find('projects-agent')), 'disabled');
});
