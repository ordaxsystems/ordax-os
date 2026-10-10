import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync("sites/public/assets/site.js", "utf8");
const origin = "https://ordax.com.br";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const pause = () => new Promise(resolve => setImmediate(resolve));

function item() {
  return {
    hidden: true, disabled: true, dataset: {}, textContent: "",
    setAttribute() {}, removeAttribute() {},
  };
}

function fixture({ page = "cadastro", altered = null, oversized = false,
                   redirected = false, unavailable = false } = {}) {
  const privacy = Buffer.from("<!doctype html><title>Privacy approved</title>");
  const terms = Buffer.from("<!doctype html><title>Terms approved</title>");
  const documents = { "/privacidade/": privacy, "/termos/": terms };
  const purl = origin + "/privacidade/";
  const turl = origin + "/termos/";
  const policy = {
    $schema: "prototype-ordax.registration-legal-policy/1",
    active: true, registrationEnabled: true,
    policyId: "2b4e5863-26a5-4d0a-b7be-48782e9b9082",
    privacy: { version: "2026.10.09", effectiveDate: "2026-10-09",
               url: purl, sha256: digest(privacy) },
    terms: { version: "2026.10.09", effectiveDate: "2026-10-09",
             url: turl, sha256: digest(terms) },
  };
  const sitekey = "0x" + "A".repeat(24);
  const config = {
    $schema: "prototype-ordax.public-site-runtime/1",
    identity: { register_url: "/auth/register", login_url: "/auth/login",
                turnstile_sitekey: sitekey },
    legal: { account_activation_ready: false, auth_only_source_enabled: true },
  };
  const state = item();
  const title = item();
  const detail = item();
  state.querySelector = selector => selector === "strong" ? title : selector === "p" ? detail : null;
  const fields = {
    "[data-registration-privacy]": item(),
    "[data-registration-privacy-meta]": item(),
    "[data-registration-terms]": item(),
    "[data-registration-terms-meta]": item(),
  };
  const legal = item();
  legal.querySelector = selector => fields[selector] ?? null;
  const submit = item();
  let challenges = 0;
  const form = {
    dataset: { identityForm: page === "cadastro" ? "register" : "login" },
    hidden: true,
    querySelector(selector) {
      return selector === "[data-registration-legal]" ? legal
        : selector === "[data-turnstile]" ? item()
        : selector === 'button[type="submit"]' ? submit : null;
    },
    querySelectorAll() { return [submit]; },
    removeAttribute(name) { if (name === "action") delete this.action; },
  };
  const requests = [];
  const context = {
    URL, Uint8Array, console, crypto: webcrypto,
    window: {
      location: { origin, pathname: page === "cadastro" ? "/cadastro/" : "/login/", search: "", hash: "" },
      OrdaXPublicI18n: { schema: "prototype-ordax.public-site-localization-runtime/1", t: id => id },
      addEventListener() {},
      turnstile: { render(_host, options) { challenges++; options.callback("valid-test-token"); } },
    },
    document: {
      body: { dataset: { page } },
      querySelector(selector) {
        if (selector === "[data-identity-state]") return state;
        if (selector === "[data-identity-form]") return form;
        return null;
      },
      addEventListener() {},
    },
    async fetch(url, options) {
      requests.push({ url, options });
      if (url === "/config/public-site.json" || url === "/auth/session"
          || url === "/auth/registration-policy") {
        const data = url === "/config/public-site.json" ? config
          : url === "/auth/registration-policy" ? policy
          : { $schema: "prototype-ordax.public-identity-session/1", provider: "supabase",
              status: "anonymous", authenticated: false };
        return { ok: true, async json() { return data; } };
      }
      const route = url.startsWith(origin) ? url.slice(origin.length) : url;
      if (!documents[route] || unavailable) throw new Error("document-not-published");
      const bytes = altered === route ? Buffer.concat([documents[route], Buffer.from(" changed")])
        : documents[route];
      let yielded = false;
      return {
        ok: true, status: 200, url: redirected ? origin + "/login/" : url,
        headers: { get(name) {
          if (name === "Content-Type") return "text/html; charset=utf-8";
          if (name === "Content-Length") return oversized ? "2097153" : null;
          return null;
        } },
        body: { getReader() { return {
          async read() {
            if (yielded) return { done: true };
            yielded = true;
            return { done: false, value: bytes };
          },
          releaseLock() {},
          async cancel() {},
        }; } },
      };
    },
  };
  vm.runInNewContext(source, context);
  return {
    state, form, legal, submit, requests,
    get challenges() { return challenges; },
    async settle() {
      // WebCrypto's async digest may finish after 16 event-loop ticks under CI
      // load. Observe the real terminal identity state instead of a timed guess.
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (state.dataset.status === "ready" || state.dataset.status === "unavailable") {
          await pause();
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error("identity-fixture-never-reached-terminal-state");
    },
  };
}

test("matching published bytes allow signup with same-origin policy and Turnstile", async () => {
  const f = fixture(); await f.settle();
  assert.equal(f.state.dataset.status, "ready");
  assert.equal(f.form.hidden, false);
  assert.equal(f.form.action, "/auth/register");
  assert.equal(f.legal.hidden, false);
  assert.equal(f.submit.disabled, false);
  assert.equal(f.challenges, 1);
  const docs = f.requests.filter(r => typeof r.url === "string" && r.url.startsWith(origin));
  assert.deepEqual(docs.map(d => d.url), [origin + "/privacidade/", origin + "/termos/"]);
  for (const doc of docs) {
    assert.equal(doc.options.credentials, "omit");
    assert.equal(doc.options.redirect, "error");
    assert.equal(doc.options.cache, "no-store");
  }
});

test("altered privacy document blocks signup before consent or Turnstile", async () => {
  const f = fixture({ altered: "/privacidade/" }); await f.settle();
  assert.equal(f.state.dataset.status, "unavailable");
  assert.equal(f.form.hidden, true);
  assert.equal(f.legal.hidden, true);
  assert.equal(f.submit.disabled, true);
  assert.equal(f.challenges, 0);
  assert.equal(f.requests.some(r => r.url === origin + "/termos/"), false);
});

test("altered terms document blocks signup after verifying privacy", async () => {
  const f = fixture({ altered: "/termos/" }); await f.settle();
  assert.equal(f.state.dataset.status, "unavailable");
  assert.equal(f.form.hidden, true);
  assert.equal(f.challenges, 0);
});

test("oversized, redirected or missing legal documents fail closed", async () => {
  for (const options of [{ oversized: true }, { redirected: true }, { unavailable: true }]) {
    const f = fixture(options); await f.settle();
    assert.equal(f.state.dataset.status, "unavailable", JSON.stringify(options));
    assert.equal(f.form.hidden, true);
    assert.equal(f.challenges, 0);
  }
});

test("login remains independent of signup's consent-document verification", async () => {
  const f = fixture({ page: "login", unavailable: true }); await f.settle();
  assert.equal(f.state.dataset.status, "ready");
  assert.equal(f.form.hidden, false);
  assert.equal(f.form.action, "/auth/login");
  assert.equal(f.submit.disabled, false);
  assert.equal(f.challenges, 1);
  assert.ok(f.requests.every(r => r.url !== "/auth/registration-policy"
    && !String(r.url).startsWith(origin)));
});
