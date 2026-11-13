import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_STORE_CATALOG_SCHEMA, APP_STORE_CATALOG_PORT_SCHEMA, createUnavailableAppStoreCatalogPort, validateAppStoreCatalogSnapshot } from '../system/contracts/app-store.mjs';
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE as candidate } from '../system/services/local-ai/model-candidate.generated.mjs';
import { createStoreSnapshotSource } from '../system/surface/workspace/lib/store/official.ts';

const entry = overrides => ({
  appId: 'verified-app', title: 'Aplicativo verificado', state: 'installed',
  installedVersion: '1.0.0', availableVersion: '2.0.0', installable: false,
  updatable: true, removable: true, blockedReason: null,
  artifactIdentityVerified: true, provenanceVerified: true, ...overrides,
});
const ready = entries => validateAppStoreCatalogSnapshot({
  schema: APP_STORE_CATALOG_SCHEMA, state: 'ready', entries, reason: null, authority: 'none',
});

test('unavailable official Store refuses demo installations and fabricated model entries', () => {
  const port = createUnavailableAppStoreCatalogPort();
  const source = createStoreSnapshotSource(port);
  const snapshot = source.getSnapshot();
  assert.equal(snapshot.state, 'unavailable');
  assert.equal(snapshot.authority, 'none');
  assert.deepEqual(snapshot.entries, [], 'No app or model may appear without the verified host catalog');
  assert.equal(JSON.stringify(snapshot).includes(candidate.id), false);
  assert.equal(candidate.independentInstallAvailable, false, 'Bundled model is not separately installable');
});

test('verified Store source preserves canonical lifecycle without fabricated metadata', () => {
  const rows = [
    entry({}),
    entry({ appId: 'retained-app', state: 'failed-retained', updatable: false }),
    entry({ appId: 'blocked-app', state: 'blocked', updatable: false, blockedReason: 'trust-revoked' }),
    entry({ appId: 'staged-app', state: 'staged', installedVersion: null, removable: false, updatable: false }),
  ];
  const snapshot = ready(rows);
  const port = {
    schema: APP_STORE_CATALOG_PORT_SCHEMA, authority: 'none',
    getSnapshot: () => snapshot, subscribe: () => () => {},
  };
  const observed = createStoreSnapshotSource(port).getSnapshot();
  assert.deepEqual(observed.entries.map(item => item.state), ['installed', 'failed-retained', 'blocked', 'staged']);
  assert.deepEqual(observed.entries.map(item => item.installedVersion), ['1.0.0', '1.0.0', '1.0.0', null]);
  assert.equal(observed.entries[0].availableVersion, '2.0.0');
  assert.equal(observed.entries[0].updatable, true);
  assert.equal(observed.entries[2].blockedReason, 'trust-revoked');
  for (const item of observed.entries) {
    assert.equal('permissions' in item, false, 'The catalog does not invent permission grants');
    assert.equal('changelog' in item, false, 'The catalog does not invent release notes');
  }
  assert.throws(() => createStoreSnapshotSource({ ...port, execute() {} }));
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

test('one Web Store renderer mounts shared Native presentation without demo or server-rendered authority', async () => {
  const { createServer } = await import('vite');
  const { createElement } = await import('react');
  const server = await createServer({
    configFile: new URL('../tools/surface-web/vite.config.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const load = path => server.ssrLoadModule('/@fs/' + new URL('../' + path, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const { StoreCatalogProvider } = await load('system/surface/workspace/components/store/catalog-context.tsx');
    const { WebAccountProvider } = await load('system/surface/workspace/components/central/account-context.tsx');
    const { createWebAccountSession } = await import('../system/composition/web/account-session.mjs');
    const { WebPreferencesProvider } = await load('system/surface/workspace/components/central/preferences-context.tsx');
    const { createPreferenceRuntime } = await import('../system/services/preferences/runtime.mjs');
    const { DesktopContent } = await load('system/surface/workspace/components/central/desktop.tsx');
    const { renderToReadableStream } = await import('react-dom/server');
    const snapshot = ready([entry({ title: 'APP DO HOST' })]);
    const port = {
      schema: APP_STORE_CATALOG_PORT_SCHEMA, authority: 'none',
      getSnapshot: () => snapshot, subscribe: () => () => {},
    };
    assert.equal(createStoreSnapshotSource(port).getSnapshot().entries[0].title, 'APP DO HOST');
    const preferences = createPreferenceRuntime({ schema:'ordax.preference-store/1', load:()=>({}), save:()=>{} });
    const windowRef = Object.assign(new EventTarget(), {
      navigator: { onLine: true },
      document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
      fetch: async path => {
        if (path === '/auth/session') return new Response(JSON.stringify({
          $schema: 'prototype-ordax.public-identity-session/1', provider: 'configured',
          authenticated: true, status: 'authenticated', subject: 'account-store',
          email: 'account-store@example.invalid',
        }));
        if (path === '/account/spaces') return new Response(JSON.stringify({
          $schema: 'prototype-ordax.account-spaces/1', spaces: [],
        }));
        throw Error('Unexpected account request: ' + path);
      },
    });
    const accountSession = createWebAccountSession(windowRef);
    await accountSession.refresh();
    let opens = 0;
    const stream = await renderToReadableStream(createElement(WebPreferencesProvider, {port:preferences},
      createElement(WebAccountProvider, {session:accountSession},
        createElement(StoreCatalogProvider, { port },
          createElement(DesktopContent, { title: 'Loja', open: () => { opens++; }, onCentral: () => {} })) )));
    await stream.allReady;
    const html = await new Response(stream).text();
    assert.match(html, /data-store-shared="true"/);
    assert.doesNotMatch(html, /OrdaX Studio|Llama 3\.1/, 'Demo fixtures must not leak into the canonical Store');
    assert.ok(!html.includes('Este aplicativo ainda não está conectado.'), 'Central mounts the actual Store');
    assert.equal(opens, 0, 'Rendering Store never executes or opens an app');
    accountSession.dispose();
    // The shared Native mount owns DOM lifecycle; SSR deliberately does not
    // claim a verified installation until the host-backed catalog is consumed.
  } finally { await server.close(); }
});


test('shared Store styles remain owned by the Native presentation and respect container width', async () => {
  const { readFile } = await import('node:fs/promises');
  const [shared, store, css] = await Promise.all([
    readFile(new URL('../system/surface/workspace/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../system/surface/workspace/components/store/meridian-store.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../system/surface/workspace/components/store/presentation/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.ok(!shared.includes('.st-root{'), 'The old shell cannot duplicate Store layout rules');
  assert.match(store, /import '\.\.\/\.\.\/\.\.\/ui\/store\.css'/);
  assert.match(store, /mountStoreExperience\(host\.current/);
  assert.match(store, /createStoreViewLifecycle\(localization\)/);
  assert.match(css, /@container store-presentation \(max-width: 800px\)/);
  assert.ok(!css.includes(':root{--st-'), 'The Store cannot own a second global palette');
});
