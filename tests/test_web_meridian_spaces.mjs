import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createWebAccountSession} from '../system/composition/web/account-session.mjs';

let server, WebAccountProvider, SpacesPanel, SpacesExperience, AccountPanel;
before(async () => {
  server = await createServer({
    configFile: fileURLToPath(new URL('../tools/surface-web/vite.config.ts', import.meta.url)),
    server: {middlewareMode: true, hmr: false, ws: false, watch: null},
    appType: 'custom', optimizeDeps: {noDiscovery: true, include: []},
  });
  const load = file => server.ssrLoadModule('/@fs/' + fileURLToPath(new URL('../system/surface/workspace/components/central/' + file, import.meta.url)));
  [{WebAccountProvider}, {SpacesPanel}, {SpacesExperience}, {AccountPanel}] = await Promise.all([
    load('account-context.tsx'), load('desktop.tsx'), load('spaces-experience.tsx'), load('primitives.tsx'),
  ]);
});
after(async () => { await server?.close(); });

const anonymous = {$schema: 'prototype-ordax.public-identity-session/1', provider: 'configured', authenticated: false, status: 'signed-out'};
const account = {$schema: 'prototype-ordax.public-identity-session/1', provider: 'configured', authenticated: true, status: 'authenticated', subject: 'account-a', email: 'account-a@example.invalid'};
const space = (id = 'studio', overrides = {}) => ({id, name: 'Estúdio <real>', kind: 'work', state: 'active', ownerId: account.subject, ...overrides});
function fixture({identity = account, spaces = [space()], failed = false, policy = null} = {}) {
  const windowRef = Object.assign(new EventTarget(), {
    navigator: {onLine: true}, document: Object.assign(new EventTarget(), {visibilityState: 'visible'}),
  });
  const state = {identity, spaces, failed, policy};
  windowRef.fetch = async path => {
    if (path === '/auth/session') return new Response(JSON.stringify(state.identity));
    if (path === '/auth/registration-policy') return new Response(JSON.stringify(state.policy), {status: state.policy ? 200 : 503});
    if (path === '/account/spaces') {
      if (state.failed) throw Error('catalog unavailable');
      return new Response(JSON.stringify({$schema: 'prototype-ordax.account-spaces/1', spaces: state.spaces}));
    }
    throw Error('Unexpected request: ' + path);
  };
  return {windowRef, state, session: createWebAccountSession(windowRef)};
}
function render(session, withExamples = false) {
  let content = createElement(SpacesPanel);
  if (withExamples) content = createElement(SpacesExperience, {onOpen() {}}, content);
  return renderToStaticMarkup(createElement(WebAccountProvider, {session}, content));
}

test('real account view opens first while complete examples remain reachable', async () => {
  const f = fixture({identity: anonymous});
  try {
    await f.session.refresh();
    const html = render(f.session, true);
    assert.match(html, /Ver exemplos completos/);
    assert.match(html, /Entre na conta para consultar seus Spaces/);
    assert.doesNotMatch(html, /Catálogo confirmado pelo serviço da conta/);
    assert.doesNotMatch(html, /Achegue|Bella Napoli|Consulta autorizada nesta sessão/);
  } finally { f.session.dispose(); }
});

test('verified account catalog renders real names, kinds and profiles without fabricated indicators', async () => {
  const f = fixture({spaces: [space(), space('archived', {name: 'Arquivo', state: 'archived', kind: 'professional', profilePack: 'pizzaria-br'})]});
  try {
    await f.session.refresh();
    const html = render(f.session);
    assert.match(html, /Estúdio &lt;real&gt;/);
    assert.match(html, /Trabalho/);
    assert.match(html, /pizzaria-br/);
    assert.match(html, /Espaço arquivado/);
    assert.match(html, /disabled=""[^>]*>Arquivado/);
    assert.doesNotMatch(html, /Pedidos|Faturamento|12\.480|ESPAÇO EM USO/);
  } finally { f.session.dispose(); }
});

test('selected account Space populates the active banner and sign-out removes private content', async () => {
  const f = fixture();
  try {
    await f.session.refresh();
    f.session.selection.select('studio');
    assert.match(render(f.session), /aria-label="Espaço em uso"/);
    assert.match(render(f.session), /Limpar seleção/);
    f.state.identity = anonymous;
    await f.session.refresh();
    assert.doesNotMatch(render(f.session), /Estúdio|Espaço em uso/);
  } finally { f.session.dispose(); }
});

test('failed catalog remains unavailable rather than becoming a successful empty account', async () => {
  const f = fixture({failed: true});
  try {
    await f.session.refresh();
    const html = render(f.session, true);
    assert.match(html, /Conta conectada · consulta de espaços indisponível/);
    assert.match(html, /Não foi possível carregar seus espaços/);
    assert.match(html, /Não foi possível consultar seus Spaces/);
    assert.match(html, /data-integration="pending"/);
    assert.doesNotMatch(html, /Seus espaços aparecerão aqui|Nenhum Space está disponível para esta conta/);
  } finally { f.session.dispose(); }
});

test('offline invalidation removes the selected banner and account records', async () => {
  const f = fixture();
  try {
    await f.session.refresh();
    f.session.selection.select('studio');
    f.windowRef.navigator.onLine = false;
    f.windowRef.dispatchEvent(new Event('offline'));
    const html = render(f.session);
    assert.match(html, /Sem conexão/);
    assert.doesNotMatch(html, /Estúdio|Espaço em uso/);
  } finally { f.session.dispose(); }
});

test('only a successfully consulted empty account displays the empty catalog message', async () => {
  const f = fixture({spaces: []});
  try {
    await f.session.refresh();
    const html = render(f.session, true);
    assert.match(html, /Catálogo confirmado pelo serviço da conta/);
    assert.match(html, /Nenhum Space está disponível para esta conta/);
    assert.doesNotMatch(html, /Conexão com a conta pendente/);
  } finally { f.session.dispose(); }
});


test('Account preserves disabled signup with an explanation while gateway policy is unavailable', async () => {
  const f = fixture({identity: anonymous});
  try {
    await f.session.refresh();
    const html = renderToStaticMarkup(createElement(WebAccountProvider, {session: f.session}, createElement(AccountPanel)));
    const button = html.match(/<button\b[^>]*>Criar conta<\/button>/)?.[0];
    assert.ok(button?.includes('disabled=""'));
    assert.match(button, /aria-describedby=/);
    assert.match(html, /Cadastro indisponível até confirmação do serviço/);
    assert.match(html, />Entrar<\/button>/);
  } finally { f.session.dispose(); }
});

test('Account enables signup only after receiving the canonical server policy', async () => {
  const policy = {
    $schema: 'prototype-ordax.registration-legal-policy/1', active: true, registrationEnabled: true,
    policyId: '11111111-1111-4111-8111-111111111111',
    privacy: {version: '2026-10-02', effectiveDate: '2026-10-02', sha256: 'a'.repeat(64), url: 'https://ordax.example/privacidade/'},
    terms: {version: '2026-10-02', effectiveDate: '2026-10-02', sha256: 'b'.repeat(64), url: 'https://ordax.example/termos/'},
  };
  const f = fixture({identity: anonymous, policy});
  try {
    await f.session.refresh();
    const html = renderToStaticMarkup(createElement(WebAccountProvider, {session: f.session}, createElement(AccountPanel)));
    const button = html.match(/<button\b[^>]*>Criar conta<\/button>/)?.[0];
    assert.ok(button && !button.includes('disabled='));
    assert.doesNotMatch(html, /Cadastro indisponível até confirmação do serviço/);
  } finally { f.session.dispose(); }
});


test('account management keeps its canonical portal owner on the dedicated Web host', async () => {
  const f = fixture();
  try {
    await f.session.refresh();
    const html = renderToStaticMarkup(createElement(WebAccountProvider, {session: f.session}, createElement(AccountPanel)));
    assert.match(html, /href="https:\/\/ordax\.com\.br\/conta\/"/);
    assert.doesNotMatch(html, /href="\/conta\/"/);
    assert.match(html, /Conta conectada/);
    assert.match(html, /Sair da conta/);
    assert.match(html, /Recursos de conta pendentes/);
  } finally { f.session.dispose(); }
});
