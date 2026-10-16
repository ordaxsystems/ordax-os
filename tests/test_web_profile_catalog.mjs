import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server, reader;
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL('../system/composition/web', import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  reader = (await server.ssrLoadModule('/profile-catalog.ts')).readWebProfileCatalog;
});
after(async () => { await server?.close(); });

function source({missingTaxonomy = false, invalidCategory = false, missingCatalog = false} = {}) {
  return async (asset, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'same-origin');
    options.signal.throwIfAborted();
    const match = String(asset).match(/\/profile-packs\/(.*?)(?:\?|$)/);
    assert.ok(match, 'request must resolve to a bundled Profile asset');
    const relative = match[1];
    assert.match(relative, /^(catalog\.json|taxonomy\.json|[a-z0-9-]+\/v[0-9]+\/manifest\.json)$/);
    if ((missingTaxonomy && relative === 'taxonomy.json') || (missingCatalog && relative === 'catalog.json')) return new Response('', {status: 404});
    const value = JSON.parse(await readFile(new URL('../system/profile-packs/' + relative, import.meta.url), 'utf8'));
    if (invalidCategory && relative === 'taxonomy.json') value.nodes = value.nodes.filter(node => node.id !== 'digital-fabrication');
    return new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});
  };
}

test('Web build assets retain active-only catalog and canonical category ancestry', async () => {
  const result = await reader(new AbortController().signal, source());
  assert.deepEqual(result.entries.map(entry => entry.slug).sort(), ['impressao-3d-br', 'pizzaria-br']);
  assert.equal(result.categories.getCategory('business').profileCount, 2);
  assert.equal(result.categories.getCategory('business-food').profileCount, 1);
  assert.equal(result.categories.getCategory('development').profileCount, 0);
});
test('missing taxonomy preserves the complete validated catalog without invented categories', async () => {
  const result = await reader(new AbortController().signal, source({missingTaxonomy: true}));
  assert.equal(result.entries.length, 2);
  assert.equal(result.categories, null);
});
test('unknown category disables filtering without discarding valid profile details', async () => {
  const result = await reader(new AbortController().signal, source({invalidCategory: true}));
  assert.equal(result.categories, null);
  assert.ok(result.entries.find(entry => entry.slug === 'impressao-3d-br').templates.includes('fila-de-producao'));
});
test('failed catalog or cancelled read never becomes a successful empty catalog', async () => {
  await assert.rejects(reader(new AbortController().signal, source({missingCatalog: true})));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reader(controller.signal, source()));
});
