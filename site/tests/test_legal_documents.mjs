// Tests the production legal-integrity function without exporting test hooks
// in the shipped browser code or requiring a provider/backend.
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/assets/site.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const trailer = /\n  void start\(\);\s*\}\)\(\);\s*$/;
assert.match(source, trailer, "must instrument the real site entrypoint");
const instrumented = source.replace(trailer,
  "\n  globalThis.__legalGate = verifyPublishedRegistrationDocuments;\n})();");
const origin = "https://ordax.com.br";
const entries = [
  { url: origin + "/privacidade/", html: "<!doctype html><html>Privacy</html>" },
  { url: origin + "/termos/", html: "<!doctype html><html>Terms</html>" },
];
const legalEntry = ({url, html}) => ({
  url, version: "2026.10.09", effectiveDate: "2026-10-09",
  sha256: createHash("sha256").update(html).digest("hex"),
});
const policy = {
  $schema: "prototype-ordax.registration-legal-policy/1",
  active: true, registrationEnabled: true,
  policyId: "123e4567-e89b-42d3-a456-426614174000",
  privacy: legalEntry(entries[0]), terms: legalEntry(entries[1]),
};

function runGate(fetcher, input = policy) {
  const noop = () => {};
  const window = {
    location: { origin, pathname: "/cadastro/", search: "", hash: "" },
    addEventListener: noop,
    OrdaXPublicI18n: {
      schema: "prototype-ordax.public-site-localization-runtime/1", t: x => x,
    },
  };
  const document = {
    body: { classList: { contains: () => false }, dataset: { page: "cadastro" } },
    addEventListener: noop,
  };
  const scope = vm.createContext({ window, document, URL, URLSearchParams,
    TextDecoder, Uint8Array, crypto: webcrypto, fetch: fetcher, console });
  vm.runInContext(instrumented, scope, { filename: "public/assets/site.js" });
  return scope.__legalGate(input);
}

function makeFetcher({mime = "text/html; charset=utf-8", noLength = false,
  badLength = false, redirect = false, tamper = false, huge = false} = {}) {
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push(url);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    const entry = entries.find(x => x.url === url);
    assert.ok(entry, "only pinned first-party pages can be read");
    const bodyBytes = Buffer.from(huge ? "x".repeat(2 * 1024 * 1024 + 1)
      : tamper ? entry.html + "modified" : entry.html);
    const headers = new Headers({"Content-Type": mime});
    if (badLength) headers.set("Content-Length", "invalid");
    else if (!noLength) headers.set("Content-Length", String(bodyBytes.length));
    let done = false;
    return {
      ok: true, status: 200, url: redirect ? origin + "/other/" : url, headers,
      body: { getReader() { return {
        async read() {
          if (done) return {done: true};
          done = true;
          return {done: false, value: bodyBytes};
        },
        async cancel() {}, releaseLock() {},
      }; } },
    };
  };
  return {fetcher, seen};
}

async function check(name, flags, accepted, reads) {
  const {fetcher, seen} = makeFetcher(flags);
  assert.equal(await runGate(fetcher), accepted, name);
  assert.equal(seen.length, reads, name + ": read count");
}

await check("positive with legitimate numeric Content-Length", {}, true, 2);
await check("positive without Content-Length", {noLength: true}, true, 2);
await check("wrong MIME", {mime: "text/plain"}, false, 1);
await check("redirect", {redirect: true}, false, 1);
await check("invalid size header", {badLength: true}, false, 1);
await check("tampered digest", {tamper: true}, false, 1);
await check("oversize stream without header",
  {huge: true, noLength: true}, false, 1);
const denied = structuredClone(policy);
denied.registrationEnabled = false;
const {fetcher, seen} = makeFetcher();
assert.equal(await runGate(fetcher, denied), false);
assert.equal(seen.length, 0);
console.log("SITE_LEGAL_DOCUMENT_CONTRACT=PASS positive=2 negative=6");
