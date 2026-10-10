import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync("sites/public/assets/account-portal.js", "utf8");

// The fixture supplies only the contracted presentation port. Identity and
// native menu behavior are exercised separately with the real portal client.
function fixture(hash = "#dados-pessoais") {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { id, innerHTML: "", textContent: "", dataset: {},
      hidden: false, disabled: false, open: false, attributes: new Map(),
      classList: { toggle() {}, remove() {} }, querySelectorAll: () => [],
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
      addEventListener() {}, close() { this.open = false; }, contains: () => false,
      focus() { document.activeElement = this; },
    });
    return nodes.get(id);
  };
  const document = { body: { dataset: { page: "conta" } }, activeElement: { id: "" },
    getElementById: get, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  get("account-app").querySelector = () => get("support-link");
  let snapshot = Object.freeze({ status: "anonymous", email: "" });
  let observer;
  let reads = 0;
  let binds = 0;
  let disposals = 0;
  const location = { hash };
  const window = { location, addEventListener() {}, scrollTo() {},
    matchMedia: () => ({ addEventListener() {} }),
    OrdaXPublicI18n: { schema: "prototype-ordax.public-site-localization-runtime/1",
      fromSource: value => value, t: id => id, getLocale: () => "pt-BR" },
    OrdaXPublicAccount: { schema: "prototype-ordax.public-account-client/1",
      getSnapshot: () => snapshot, readSession() { reads++; return Promise.resolve(snapshot); },
      bindProfileMenu(trigger, options) {
        assert.equal(trigger, get("profile-menu-trigger"));
        assert.equal(options.accountRoute, "/conta/");
        binds++;
        return () => { disposals++; };
      },
      subscribe(callback) { observer = callback; callback(snapshot); return () => {}; },
    },
  };
  vm.runInNewContext(source, { window, document, location });
  return { nodes, get, emit(status, email = "") { snapshot = Object.freeze({ status, email }); observer(snapshot); },
    get reads() { return reads; }, get binds() { return binds; }, get disposals() { return disposals; } };
}

test("canonical account renders only the verified session email, safely escaped, and never enables unsupported profile writes", () => {
  const f = fixture();
  assert.equal(f.reads, 1);
  const email = '\"><img src=x onerror=alert(1)>@example.test';
  f.emit("authenticated", email);
  const html = f.get("account-content").innerHTML;
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("readonly autocomplete=\"off\""));
  assert.ok(/<button[^>]+disabled>Salvar alterações<\/button>/.test(html));
  assert.equal(f.get("profile-menu-label").textContent, "Meu perfil");
  assert.equal(f.binds - f.disposals, 1, "only one menu binding remains after each render");
  f.emit("checking");
  assert.ok(!f.get("account-content").innerHTML.includes("example.test"));
  assert.ok(!f.get("account-session").innerHTML.includes("example.test"));
  assert.equal(f.get("profile-menu-label").textContent, "Sua conta");
});

test("security shows the current verified browser session without inventing 2FA or devices", () => {
  const f = fixture("#seguranca");
  f.emit("authenticated", "person@example.test");
  const html = f.get("account-content").innerHTML;
  assert.ok(html.includes("person@example.test"));
  assert.ok(html.includes("Esta consulta confirma apenas a sessão atual. Não lista outros dispositivos."));
  assert.ok(/<button[^>]+disabled>Alterar senha<\/button>/.test(html));
  assert.ok(/<button[^>]+disabled>Configurar<\/button>/.test(html));
  assert.ok(html.includes("Status não disponível"));
  f.emit("leaving");
  assert.ok(!f.get("account-content").innerHTML.includes("person@example.test"));
  assert.equal(f.get("profile-menu-trigger").disabled, true);
  assert.equal(f.binds - f.disposals, 1, "native logout form must remain connected until navigation");
});

test("anonymous and unavailable states retain real sign-in navigation and actionable retry", () => {
  const f = fixture("#visao-geral");
  f.emit("unavailable");
  assert.ok(f.get("account-session").innerHTML.includes('href="/login/"'));
  assert.ok(f.get("account-session").innerHTML.includes("data-refresh-session"));
  assert.ok(!f.get("account-content").innerHTML.includes("Conta autenticada"));
  f.emit("authenticated", "person@example.test");
  assert.ok(f.get("account-content").innerHTML.includes("person@example.test"));
  f.emit("anonymous");
  assert.ok(!f.get("account-content").innerHTML.includes("person@example.test"));
});


test("integrations retain an honest unavailable state", () => {
  const connections = fixture("#integracoes");
  assert.ok(connections.get("account-content").innerHTML.includes("Integrações não disponíveis"));
});

test("official preferences have no simulated notification settings or extra language persistence", () => {
  const f = fixture("#preferencias");
  const content = f.get("account-content").innerHTML;
  assert.ok(content.includes('id="account-locale"'));
  assert.ok(content.includes("Não disponível"));
  assert.ok(!content.includes('role="switch"'));
  assert.ok(!content.includes("Restaurar prévia"));
  assert.ok(!source.includes("localStorage"));
});


test("subscription states its actual availability and keeps uncontracted purchases disabled", () => {
  const f = fixture("#assinatura");
  f.emit("authenticated", "person@example.test");
  const html = f.get("account-content").innerHTML;
  assert.ok(html.includes("Assinaturas pagas ainda não estão disponíveis."));
  assert.ok(/<button[^>]+disabled>Alterar plano<\/button>/.test(html));
  assert.ok(/<button[^>]+disabled>Cancelar assinatura<\/button>/.test(html));
  assert.ok(!html.includes("<form"));
});
