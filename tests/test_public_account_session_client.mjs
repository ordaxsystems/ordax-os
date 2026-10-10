import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync("sites/public/assets/site.js", "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
const authenticated = (email = "person@example.test") => ({
  $schema: "prototype-ordax.public-identity-session/1", provider: "supabase",
  status: "authenticated", authenticated: true, subject: "verified-subject", email,
});
const anonymous = { $schema: "prototype-ordax.public-identity-session/1",
  provider: "supabase", status: "anonymous", authenticated: false };

function fixture() {
  const requests = [];
  const pending = [];
  const events = new Map();
  const window = {
    OrdaXPublicI18n: { schema: "prototype-ordax.public-site-localization-runtime/1",
      t: id => id, fromSource: value => value },
    location: { hash: "", pathname: "/conta-2/", search: "" },
    addEventListener(type, callback) { events.set(type, callback); },
  };
  const documentEvents = new Map();
  const document = { body: { dataset: { page: "conta-2" } }, visibilityState: "visible",
    querySelector() { return null; }, addEventListener(type, callback) { documentEvents.set(type, callback); } };
  const timeoutSignal = { name: "bounded-session-request" };
  vm.runInNewContext(source, { window, document, URL, URLSearchParams,
    console: { error() {} }, AbortSignal: { timeout(ms) { assert.equal(ms, 10000); return timeoutSignal; } },
    fetch(path, options) {
      if (path !== "/auth/session") return Promise.resolve({ ok: true,
        json: async () => ({ $schema: "prototype-ordax.public-site-runtime/1" }) });
      requests.push({ path, options });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  });
  return { api: window.OrdaXPublicAccount, requests, events, timeoutSignal, document, documentEvents,
    resolve(value, index = pending.length - 1) {
      pending[index].resolve({ ok: true, json: async () => value });
    },
    fail(index = pending.length - 1) { pending[index].reject(new Error("network-failure")); },
  };
}

test("canonical port shares one bounded request and exposes only a frozen identity projection", async () => {
  const f = fixture();
  const seen = [];
  f.api.subscribe(value => seen.push(value.status));
  const first = f.api.readSession();
  const second = f.api.readSession();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.credentials, "same-origin");
  assert.equal(f.requests[0].options.cache, "no-store");
  assert.equal(f.requests[0].options.signal, f.timeoutSignal);
  f.resolve({ ...authenticated(), access_token: "must-not-leak", refresh_token: "must-not-leak",
    display_name: "Uncontracted data", avatar_url: "https://unknown.test" });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.deepEqual(Object.keys(a).sort(), ["email", "status"]);
  assert.equal(a.status, "authenticated");
  assert.equal(a.email, "person@example.test");
  assert.equal(Object.isFrozen(a), true);
  assert.deepEqual(seen, ["checking", "authenticated"]);
  await f.api.readSession();
  assert.equal(f.requests.length, 1, "navigation must reuse the authoritative read");
});

test("unverified providers, inconsistent sessions and failures expose no personal data", async () => {
  for (const value of [null, { ...authenticated(), provider: "unconfigured" },
    { ...authenticated(), subject: "" }, { ...authenticated(), status: "anonymous" }]) {
    const f = fixture();
    const read = f.api.readSession();
    f.resolve(value);
    const result = await read;
    assert.equal(result.status, "unavailable");
    assert.equal(result.email, "");
  }
  const f = fixture();
  const read = f.api.readSession();
  f.fail();
  assert.equal((await read).status, "unavailable");
});

test("email projection excludes control characters and excessively long values", async () => {
  for (const email of [null, { value: "malformed" }, "a".repeat(255), "person\n@example.test"]) {
    const f = fixture();
    const read = f.api.readSession();
    f.resolve(authenticated(email));
    assert.equal((await read).email, "");
    assert.equal(f.api.getSnapshot().status, "authenticated", "missing email does not invent a failed session");
  }
});

test("refresh clears identity synchronously and ignores late results from an older generation", async () => {
  const f = fixture();
  const old = f.api.readSession();
  const current = f.api.refreshSession();
  assert.equal(f.api.getSnapshot().status, "checking");
  assert.equal(f.api.getSnapshot().email, "");
  f.resolve(anonymous, 1);
  assert.equal((await current).status, "anonymous");
  f.resolve(authenticated("stale@example.test"), 0);
  assert.equal((await old).status, "anonymous");
  assert.equal(f.api.getSnapshot().email, "");
});

test("a failure can be retried and observer disposal prevents later delivery", async () => {
  const f = fixture();
  const seen = [];
  const dispose = f.api.subscribe(value => seen.push(value.status));
  const initial = f.api.readSession();
  f.fail();
  await initial;
  dispose();
  const retry = f.api.refreshSession();
  f.resolve(authenticated());
  assert.equal((await retry).status, "authenticated");
  assert.deepEqual(seen, ["checking", "unavailable"]);
  assert.equal(f.requests.length, 2);
});

test("pagehide clears personal identity before caching and BFCache restore revalidates revocation", async () => {
  const f = fixture();
  const read = f.api.readSession();
  f.resolve(authenticated());
  await read;
  f.events.get("pagehide")({ persisted: true });
  assert.equal(f.api.getSnapshot().email, "");
  assert.equal(f.api.getSnapshot().status, "checking");
  f.events.get("pageshow")({ persisted: true });
  f.resolve(anonymous);
  await flush();
  assert.equal(f.api.getSnapshot().status, "anonymous");
  assert.equal(f.requests.length, 2);
});

test("returning to the visible account revalidates a session revoked in another tab", async () => {
  const f = fixture();
  const read = f.api.readSession();
  f.resolve(authenticated());
  await read;
  f.document.visibilityState = "hidden";
  f.documentEvents.get("visibilitychange")();
  assert.equal(f.requests.length, 1);
  f.document.visibilityState = "visible";
  f.documentEvents.get("visibilitychange")();
  assert.equal(f.api.getSnapshot().email, "");
  assert.equal(f.requests.length, 2);
  f.resolve(anonymous);
  await flush();
  assert.equal(f.api.getSnapshot().status, "anonymous");
});

test("a broken presentation observer cannot change the identity outcome or block other consumers", async () => {
  const f = fixture();
  f.api.subscribe(() => { throw new Error("broken-presentation"); });
  const seen = [];
  f.api.subscribe(value => seen.push(value.status));
  const read = f.api.readSession();
  f.resolve(authenticated());
  assert.equal((await read).status, "authenticated");
  assert.deepEqual(seen, ["checking", "authenticated"]);
});
