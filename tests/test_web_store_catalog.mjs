import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_STORE_CATALOG_SCHEMA, APP_STORE_CATALOG_PORT_SCHEMA, createUnavailableAppStoreCatalogPort, validateAppStoreCatalogSnapshot } from '../system/contracts/app-store.mjs';
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE as candidate } from '../system/services/local-ai/model-candidate.generated.mjs';
import { createStoreSnapshotSource, officialEntryStatus, projectOfficialStoreItems } from '../system/surface/workspace/lib/store/official.ts';

const entry = overrides => ({
  appId: 'verified-app', title: 'Aplicativo verificado', state: 'installed',
  installedVersion: '1.0.0', availableVersion: '2.0.0', installable: false,
  updatable: true, removable: true, blockedReason: null,
  artifactIdentityVerified: true, provenanceVerified: true, ...overrides,
});
const ready = entries => validateAppStoreCatalogSnapshot({
  schema: APP_STORE_CATALOG_SCHEMA, state: 'ready', entries, reason: null, authority: 'none',
});

test('unavailable catalog cannot claim demo installations; the model comes from the OS candidate', () => {
  const snapshot = createUnavailableAppStoreCatalogPort().getSnapshot();
  const items = projectOfficialStoreItems(snapshot);
  assert.equal(items.filter(item => item.kind === 'app').length, 0);
  assert.equal(items.length, 1);
  const model = items[0];
  for (const [key, value] of Object.entries({
    name: candidate.title, modelId: candidate.id, engine: candidate.engine,
    format: candidate.modelFormat, quantization: candidate.quantization, license: candidate.license,
    ram: null, vram: null,
  })) assert.equal(model[key], value, key);
  assert.deepEqual(model.tasks, [], 'The candidate does not homologate tasks');
  assert.match(model.description, /precisam de verificação/);
  assert.equal(candidate.independentInstallAvailable, false);
});

test('verified entry lifecycle and installed version survive projection without invented metadata', () => {
  const rows = [
    entry({}),
    entry({ appId: 'retained-app', state: 'failed-retained', updatable: false }),
    entry({ appId: 'blocked-app', state: 'blocked', updatable: false, blockedReason: 'trust-revoked' }),
    entry({ appId: 'staged-app', state: 'staged', installedVersion: null, removable: false, updatable: false }),
  ];
  const snapshot = ready(rows);
  assert.deepEqual(snapshot.entries.map(officialEntryStatus), ['update-available', 'failed-retained', 'blocked', 'staged']);
  const apps = projectOfficialStoreItems(snapshot).filter(item => item.kind === 'app');
  assert.equal(apps.length, 4);
  assert.equal(apps[0].version, '2.0.0');
  assert.deepEqual(apps[0].platforms, []);
  assert.deepEqual(apps[0].permissions, []);
  assert.deepEqual(apps[0].changelog, []);
  assert.equal(snapshot.entries[1].installedVersion, '1.0.0', 'A failed update retains the actual version');
  assert.throws(() => projectOfficialStoreItems({ ...snapshot, authority: 'install' }));
  assert.throws(() => ready([entry({ artifactIdentityVerified: false })]), 'Unverified candidate cannot be updatable');
});

test('external-store snapshots are cached even if the port returns a fresh object on every read', () => {
  let reads = 0, notify;
  const port = {
    schema: APP_STORE_CATALOG_PORT_SCHEMA, authority: 'none',
    getSnapshot: () => { reads++; return structuredClone(ready([entry({})])); },
    subscribe: listener => { notify = listener; return () => {}; },
  };
  const source = createStoreSnapshotSource(port);
  const initial = source.getSnapshot(), count = reads;
  for (let n = 0; n < 20; n++) assert.equal(source.getSnapshot(), initial);
  assert.equal(reads, count, 'React reads the cache, not an unstable host snapshot');
  let changes = 0;
  const release = source.subscribe(() => changes++);
  notify({ state: 'installed', authority: 'execute' });
  assert.equal(source.getSnapshot().authority, 'none', 'Notifications never supply catalog data');
  assert.equal(source.getSnapshot().entries.length, 1);
  const after = changes;
  release(); notify();
  assert.equal(changes, after, 'Late callbacks after disposal are ignored');
});

test('revocation and invalid/read-failed snapshots clear previous installed entries', () => {
  let current = ready([entry({})]), notify, fail = false;
  const port = {
    schema: APP_STORE_CATALOG_PORT_SCHEMA, authority: 'none',
    getSnapshot: () => { if (fail) throw Error('host disconnected'); return current; },
    subscribe: listener => { notify = listener; return () => {}; },
  };
  const source = createStoreSnapshotSource(port);
  const release = source.subscribe(() => {});
  current = createUnavailableAppStoreCatalogPort('trust-revoked').getSnapshot(); notify();
  assert.deepEqual(source.getSnapshot().entries, []);
  current = ready([entry({})]); notify();
  assert.equal(source.getSnapshot().entries.length, 1);
  current = { ...current, authority: 'execute' }; notify();
  assert.equal(source.getSnapshot().state, 'unavailable');
  assert.deepEqual(source.getSnapshot().entries, []);
  current = ready([entry({})]); notify();
  fail = true; notify();
  assert.deepEqual(source.getSnapshot().entries, []);
  release();
  fail = false;
  assert.throws(() => createStoreSnapshotSource({ ...port, execute() {} }), 'Ports cannot gain hidden execution authority');
});

test('one Store renderer displays ready host entries and defaults to official mode', async () => {
  const { createServer } = await import('vite');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({
    configFile: new URL('../tools/surface-web/vite.config.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { StoreCatalogProvider } = await server.ssrLoadModule('/@fs/' + new URL('../system/surface/workspace/components/store/catalog-context.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const { StoreExperience } = await server.ssrLoadModule('/@fs/' + new URL('../system/surface/workspace/components/store/store.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const snapshot = ready([entry({ title: 'APP DO HOST' })]);
    const port = { schema: APP_STORE_CATALOG_PORT_SCHEMA, authority: 'none', getSnapshot: () => snapshot, subscribe: () => () => {} };
    const html = renderToStaticMarkup(createElement(StoreCatalogProvider, { port }, createElement(StoreExperience)));
    assert.match(html, /data-store-mode="official"/);
    assert.match(html, /APP DO HOST/);
    assert.match(html, /Atualização disponível/);
    assert.match(html, /Operação indisponível/);
    assert.ok(!html.includes('Llama 3.1'), 'Demo models cannot leak into the official catalog');
    assert.ok(!html.includes('OrdaX Studio'), 'Demo installed apps cannot leak into the host catalog');
    // Exercise the active Central route, not only the standalone Store renderer.
    const { WebPreferencesProvider } = await server.ssrLoadModule('/@fs/' + new URL('../system/surface/workspace/components/central/preferences-context.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const { createPreferenceRuntime } = await import('../system/services/preferences/runtime.mjs');
    const preferences = createPreferenceRuntime({schema:'ordax.preference-store/1',load:()=>({}),save:()=>{}});
    const { DesktopContent } = await server.ssrLoadModule('/@fs/' + new URL('../system/surface/workspace/components/central/desktop.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const { renderToReadableStream } = await import('react-dom/server');
    let opens = 0;
    const stream = await renderToReadableStream(createElement(WebPreferencesProvider, {port:preferences}, createElement(StoreCatalogProvider, { port },
      createElement(DesktopContent, { title: 'Loja', open: () => { opens++; }, onCentral: () => {} }))));
    await stream.allReady;
    const centralHtml = await new Response(stream).text();
    assert.match(centralHtml, /data-store-shared="true"/);
    assert.ok(!centralHtml.includes('OrdaX Studio'), 'The shared client mount cannot invent SSR catalog fixtures');
    // Actual shared DOM rendering, lifecycle requests and unavailable Web state
    // are exercised in checks/store-shared-browser.mjs, including both ports.
    assert.ok(!centralHtml.includes('Este aplicativo ainda não está conectado.'), 'Central mounts the real Store');
    assert.equal(opens, 0, 'Reading the Store cannot execute or open a simulated app');

  } finally { await server.close(); }
});


test('Store styles have one owner and compact panes use their container width', async () => {
  const { readFile } = await import('node:fs/promises');
  const [shared, store, css] = await Promise.all([
    readFile(new URL('../system/surface/workspace/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../system/surface/workspace/components/store/store.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../system/surface/workspace/components/store/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.ok(!shared.includes('.st-root{'), 'Store rules cannot remain duplicated in the old shell stylesheet');
  assert.match(store, /import '\.\/styles\.css'/);
  assert.match(css, /@container \(max-width:860px\)/);
  assert.ok(!css.includes(':root{--st-'), 'The Store cannot own a global palette');
  assert.match(css, /--web-glass:var\(--card\)/);
});
