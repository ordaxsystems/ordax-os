import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync("sites/public/assets/site.js", "utf8");

function link(value, href) {
  const label = { textContent: value };
  const attributes = new Map();
  return {
    href, hidden: false, caption: label,
    querySelector(selector) {
      return selector === "[data-auth-nav-label]" ? label : null;
    },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
  };
}

function fixture({ authenticated = false, registerOnly = false, failed = false, page = "termos" } = {}) {
  const login = registerOnly ? null : link("Entrar", "/login/");
  const register = link("Criar conta", "/cadastro/");
  const requests = [];
  const eventHandlers = Object.create(null);
  let sessionState = authenticated;
  let failSession = failed;

  const header = {
    querySelector(selector) {
      return selector === '[data-auth-nav="login"]' ? login
        : selector === '[data-auth-nav="register"]' ? register : null;
    },
  };
  const document = {
    body: { dataset: { page } },
    querySelector(selector) { return selector === ".site-header" ? header : null; },
    addEventListener(type, callback) { eventHandlers[type] = callback; },
  };
  const window = {
    location: { hash: "", pathname: "/login/", search: "" },
    OrdaXPublicI18n: {
      schema: "prototype-ordax.public-site-localization-runtime/1",
      t(id) { return id === "account.navigation.account" ? "Minha conta" : id; },
      fromSource(value) { return value; },
    },
    addEventListener(type, callback) { eventHandlers[type] = callback; },
  };
  const session = () => ({
    $schema: "prototype-ordax.public-identity-session/1",
    provider: "supabase",
    status: sessionState ? "authenticated" : "anonymous",
    authenticated: sessionState,
    ...(sessionState ? { subject: "test-subject", email: "test@example.invalid" } : {}),
  });
  const fetch = async url => {
    requests.push(url);
    if (url === "/auth/session" && failSession) throw new Error("offline");
    return {
      ok: true,
      async json() {
        return url === "/auth/session"
          ? session()
          : { $schema: "prototype-ordax.public-site-runtime/1" };
      },
    };
  };
  vm.runInNewContext(source, { window, document, fetch, URL, URLSearchParams, console });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return {
    login, register, requests, eventHandlers, settle,
    updateSession(value, fail = false) {
      sessionState = value;
      failSession = fail;
    },
  };
}

test("verified session changes Entrar to Minha conta and hides signup CTA", async () => {
  const view = fixture({ authenticated: true });
  await view.settle();
  assert.equal(view.login.href, "/conta/");
  assert.equal(view.login.caption.textContent, "Minha conta");
  assert.equal(view.register.hidden, true);
  assert.equal(view.requests.filter(url => url === "/auth/session").length, 1);
});

test("anonymous session and provider failure preserve public navigation", async () => {
  for (const failed of [false, true]) {
    const view = fixture({ authenticated: false, failed });
    await view.settle();
    assert.equal(view.login.href, "/login/");
    assert.equal(view.login.caption.textContent, "Entrar");
    assert.equal(view.register.href, "/cadastro/");
    assert.equal(view.register.hidden, false);
  }
});

test("login page with only signup CTA reveals Minha conta after authentication", async () => {
  const view = fixture({ authenticated: true, registerOnly: true, page: "login" });
  await view.settle();
  assert.equal(view.register.href, "/conta/");
  assert.equal(view.register.caption.textContent, "Minha conta");
  assert.equal(view.register.hidden, false);
});

test("return from back-forward cache revalidates revoked login and removes account link", async () => {
  const view = fixture({ authenticated: true });
  await view.settle();
  assert.equal(view.login.href, "/conta/");
  view.updateSession(false);
  view.eventHandlers.pageshow({ persisted: true });
  await view.settle();
  assert.equal(view.login.href, "/login/");
  assert.equal(view.login.caption.textContent, "Entrar");
  assert.equal(view.register.hidden, false);
  assert.equal(view.requests.filter(url => url === "/auth/session").length, 2);
});

test("locale changes share the same single session lookup", async () => {
  const view = fixture({ authenticated: true });
  await view.settle();
  view.eventHandlers["ordax:localechange"]();
  await view.settle();
  assert.equal(view.login.href, "/conta/");
  assert.equal(view.requests.filter(url => url === "/auth/session").length, 1);
});
