import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWebAccountSession } from '../system/composition/web/account-session.mjs';
import { projectSpaceProfileStoreStatus } from '../system/services/spaces/profile-store-status.mjs';

let server, SpaceProfileAppsStatus, SpaceProfileAppsPanel, WebAccountProvider;
before(async () => {
  server = await createServer({
    configFile: fileURLToPath(new URL('../tools/surface-web/vite.config.ts', import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
  });
  const load = path => server.ssrLoadModule('/@fs/' + fileURLToPath(new URL(path, import.meta.url)));
  [{ SpaceProfileAppsStatus, SpaceProfileAppsPanel }, { WebAccountProvider }] = await Promise.all([
    load('../system/surface/workspace/components/central/space-profile-apps.tsx'),
    load('../system/surface/workspace/components/central/account-context.tsx'),
  ]);
});
after(async () => { await server?.close(); });

const space = profilePack => ({
  id: 'pizzeria', name: 'Pizzaria <Centro>', kind: 'professional',
  state: 'active', ownerId: 'account-a', profilePack,
});
const profile = {
  schema: 'ordax.profile-pack-catalog-entry/1', slug: 'pizzaria-br', version: 1,
  title: 'Pizzaria', category: 'Comércio', spaceKind: 'professional',
  apps: ['orders'], templates: [], intelligence: {preferredPurpose: null, externalProviderRequired: false},
};
const storeEntry = {
  appId: 'orders', title: 'Pedidos', state: 'installed', installedVersion: '1.0.0',
  availableVersion: null, installable: false, updatable: false, removable: true,
  blockedReason: null, artifactIdentityVerified: false, provenanceVerified: false,
};
const snapshot = (state, entries = [], reason = null) => ({
  schema: 'ordax.app-store-catalog/2', state, entries, reason, authority: 'none',
});
const renderStatus = result => renderToStaticMarkup(createElement(SpaceProfileAppsStatus, { projection: result }));

test('read-only installed state comes only from canonical Store snapshot and escapes identifiers', () => {
  const projected = projectSpaceProfileStoreStatus({
    space: space('pizzaria-br@1'), profiles: [profile],
    storeSnapshot: snapshot('ready', [storeEntry]),
  });
  const html = renderStatus(projected);
  assert.match(html, /orders/);
  assert.match(html, /Instalado/);
  assert.match(html, /Instalada: 1\.0\.0/);
  assert.match(html, /pizzaria-br@1/);
  assert.doesNotMatch(html, /<button|<a\b|onClick|Instalar aplicativo/);
});

test('unavailable Store never claims installed, available, or absent', () => {
  const projected = projectSpaceProfileStoreStatus({
    space: space('pizzaria-br@1'), profiles: [profile],
    storeSnapshot: snapshot('unavailable', [], 'web-store-transport-unavailable'),
  });
  const html = renderStatus(projected);
  assert.match(html, /Estado da Loja indisponível/);
  assert.match(html, /Estado indisponível/);
  assert.doesNotMatch(html, />Instalado<|>Disponível na Loja<|>Não listado na Loja</);
});

test('legacy unpinned and missing Profile version stay unresolved in UI', () => {
  for (const [binding, message] of [
    ['pizzaria-br', /não informa uma versão/],
    ['pizzaria-br@2', /não está publicada/],
  ]) {
    const projected = projectSpaceProfileStoreStatus({
      space: space(binding), profiles: [profile], storeSnapshot: snapshot('unavailable', [], 'offline'),
    });
    const html = renderStatus(projected);
    assert.match(html, message);
    assert.doesNotMatch(html, /orders|Instalado|<button/);
  }
});

const signedIn = {$schema: 'prototype-ordax.public-identity-session/1', provider: 'configured',
  authenticated: true, status: 'authenticated', subject: 'account-a', email: 'a@example.invalid'};
const signedOut = {$schema: 'prototype-ordax.public-identity-session/1', provider: 'configured',
  authenticated: false, status: 'signed-out'};
function accountFixture() {
  const windowRef = Object.assign(new EventTarget(), {
    navigator: { onLine: true },
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  });
  const state = { identity: signedIn };
  windowRef.fetch = async path => {
    if (path === '/auth/session') return new Response(JSON.stringify(state.identity));
    if (path === '/auth/registration-policy') return new Response(null, {status: 503});
    if (path === '/account/spaces') return new Response(JSON.stringify({
      $schema: 'prototype-ordax.account-spaces/1', spaces: [space('pizzaria-br@1')],
    }));
    throw Error('Unexpected endpoint: ' + path);
  };
  return { state, windowRef, session: createWebAccountSession(windowRef) };
}
function renderPanel(session) {
  return renderToStaticMarkup(createElement(WebAccountProvider, { session }, createElement(SpaceProfileAppsPanel)));
}
test('panel is restricted to the authorized active Space and hides private data on sign-out', async () => {
  const f = accountFixture();
  try {
    await f.session.refresh();
    assert.equal(renderPanel(f.session), '');
    f.session.selection.select('pizzeria');
    const selected = renderPanel(f.session);
    assert.match(selected, /Aplicativos do Space/);
    assert.match(selected, /Pizzaria &lt;Centro&gt;/);
    assert.match(selected, /Consultando o Profile Pack publicado/);
    assert.doesNotMatch(selected, /Instalado|<li/);
    f.state.identity = signedOut;
    await f.session.refresh();
    assert.equal(renderPanel(f.session), '');
  } finally { f.session.dispose(); }
});
