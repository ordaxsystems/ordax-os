import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync("sites/public/assets/site.js", "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));

function element() {
  const attributes = new Map();
  const title = { textContent: "" };
  const detail = { textContent: "" };
  return {
    hidden: true, disabled: true, dataset: {}, textContent: "", title, detail,
    querySelector(selector) { return selector === "strong" ? title : selector === "p" ? detail : null; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); if (name === "href") delete this.href; },
  };
}

function fixture({ page = "web", authenticated = true, entry = "/ordax/", enabled = true, invalidSession = false, failure = false } = {}) {
  const selectors = page === "web"
    ? ["[data-web-state]", "[data-web-launch]", "[data-web-login]", "[data-web-retry]"]
    : ["[data-account-state]", "[data-account-authenticated]", "[data-account-anonymous]", "[data-account-unavailable]", "[data-account-email]", "[data-account-hero-email]", "[data-account-profile-email]", "[data-account-profile-identity]", "[data-account-logout]", '[data-account-logout] button[type="submit"]'];
  const nodes = new Map(selectors.map(selector => [selector, element()]));
  const events = {};
  const requests = [];
  let holdConfig = false;
  let heldConfig;
  let signedIn = authenticated;
  const config = { $schema: "prototype-ordax.public-site-runtime/1", product: { web: { enabled, entry_url: entry } } };
  const context = {
    URL, URLSearchParams, console,
    window: {
      location: { pathname: page === "web" ? "/web/" : "/conta/", search: "", hash: "" },
      OrdaXPublicI18n: { schema: "prototype-ordax.public-site-localization-runtime/1", t: id => id },
      addEventListener(type, callback) { events[type] = callback; },
    },
    document: {
      body: { dataset: { page } },
      querySelector(selector) { return nodes.get(selector) ?? null; },
      addEventListener(type, callback) { events[type] = callback; },
    },
    async fetch(path, options) {
      requests.push({ path, options });
      if (path === "/auth/session" && failure) throw new Error("offline");
      return { ok: true, async json() {
        if (path !== "/auth/session") {
          if (holdConfig) return new Promise(resolve => { heldConfig = () => resolve(config); });
          return config;
        }
        return {
          $schema: "prototype-ordax.public-identity-session/1", provider: "supabase",
          authenticated: signedIn, status: invalidSession ? "unknown" : signedIn ? "authenticated" : "anonymous",
          ...(signedIn ? { subject: "proof-subject", email: "<img src=x onerror=alert(1)>@example.invalid" } : {}),
        };
      } };
    },
  };
  vm.runInNewContext(source, context);
  return { nodes, events, requests, delayConfig() { holdConfig = true; }, releaseConfig() { heldConfig?.(); }, signOut() { signedIn = false; } };
}

test("valid session exposes only the configured same-origin product link", async () => {
  const f = fixture(); await flush();
  assert.equal(f.nodes.get("[data-web-launch]").href, "/ordax/");
  assert.equal(f.nodes.get("[data-web-launch]").hidden, false);
  assert.equal(f.nodes.get("[data-web-state]").dataset.status, "ready");
  assert.equal(f.requests.filter(r => r.path === "/auth/session").length, 1);
  assert.ok(f.requests.every(r => r.options.credentials === "same-origin" && r.options.cache === "no-store"));
});

test("no personal workspace link is exposed to anonymous, invalid or unavailable sessions", async () => {
  for (const options of [{ authenticated: false }, { invalidSession: true }, { failure: true }]) {
    const f = fixture(options); await flush();
    assert.equal(f.nodes.get("[data-web-launch]").hidden, true);
    assert.equal(f.nodes.get("[data-web-launch]").href, undefined);
    assert.notEqual(f.nodes.get("[data-web-state]").dataset.status, "ready");
  }
});

test("disabled, missing, off-origin or non-product destinations fail closed", async () => {
  for (const options of [
    { enabled: false }, { entry: null }, { entry: "https://example.invalid/" },
    { entry: "//example.invalid/" }, { entry: "/web/" }, { entry: "/auth/logout/" },
    { entry: "/ordax/../login/" }, { entry: "/ordax/%2f/" }, { entry: "/ordax/?token=secret" },
    { entry: "/ordax/\\evil/" }, { entry: "/ordax//evil/" },
  ]) {
    const f = fixture(options); await flush();
    assert.equal(f.nodes.get("[data-web-launch]").hidden, true, JSON.stringify(options));
    assert.equal(f.nodes.get("[data-web-launch]").href, undefined);
    assert.equal(f.nodes.get("[data-web-state]").dataset.status, "unavailable");
  }
});

test("back navigation removes the old Web link before delayed configuration or session validation", async () => {
  const f = fixture(); await flush();
  f.delayConfig(); f.signOut(); f.events.pageshow({ persisted: true });
  assert.equal(f.nodes.get("[data-web-launch]").hidden, true);
  assert.equal(f.nodes.get("[data-web-launch]").href, undefined);
  await flush(); f.releaseConfig(); await flush();
  assert.equal(f.nodes.get("[data-web-state]").dataset.status, "anonymous");
});

test("account data is text only and cleared immediately on back navigation after sign-out", async () => {
  const f = fixture({ page: "conta" }); await flush();
  const email = f.nodes.get("[data-account-email]");
  assert.ok(email.textContent.startsWith("<img"));
  assert.equal(email.innerHTML, undefined);
  const hero = f.nodes.get("[data-account-hero-email]");
  assert.equal(hero.textContent, email.textContent);
  assert.equal(hero.hidden, false);
  assert.equal(hero.innerHTML, undefined);
  const profileEmail = f.nodes.get("[data-account-profile-email]");
  const profileIdentity = f.nodes.get("[data-account-profile-identity]");
  assert.equal(profileEmail.textContent, email.textContent);
  assert.equal(profileIdentity.hidden, false);
  assert.equal(profileEmail.innerHTML, undefined);
  assert.equal(f.nodes.get("[data-account-authenticated]").hidden, false);
  assert.equal(f.nodes.get("[data-account-logout]").hidden, false);
  assert.equal(f.nodes.get('[data-account-logout] button[type="submit"]').disabled, false);
  f.delayConfig(); f.signOut(); f.events.pageshow({ persisted: true });
  assert.equal(email.textContent, "");
  assert.equal(hero.textContent, "");
  assert.equal(hero.hidden, true);
  assert.equal(profileEmail.textContent, "");
  assert.equal(profileIdentity.hidden, true);
  assert.equal(f.nodes.get("[data-account-authenticated]").hidden, true);
  assert.equal(f.nodes.get("[data-account-logout]").hidden, true);
  assert.equal(f.nodes.get('[data-account-logout] button[type="submit"]').disabled, true);
  await flush(); f.releaseConfig(); await flush();
  assert.equal(f.nodes.get("[data-account-anonymous]").hidden, false);
});

test("personal profile never exposes unverified identity for anonymous or unavailable account sessions", async () => {
  for (const options of [{ authenticated: false }, { failure: true }, { invalidSession: true }]) {
    const f = fixture({ page: "conta", ...options }); await flush();
    const profile = f.nodes.get("[data-account-profile-identity]");
    assert.equal(profile.hidden, true, JSON.stringify(options));
    assert.equal(f.nodes.get("[data-account-profile-email]").textContent, "");
    assert.notEqual(f.nodes.get("[data-account-state]").dataset.status, "ready");
  }
});
