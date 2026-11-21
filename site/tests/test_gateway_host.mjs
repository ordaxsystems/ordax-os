import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  normalizeGatewayUrl,
  normalizeProductPath,
  proxyPublicAccountRequest,
} from "../../lib/account-proxy-core.mjs";
import gatewayFunction from "../api/account-proxy.mjs";

const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const source = JSON.parse(fs.readFileSync(new URL("../../docs/contracts/public-site-source.json", import.meta.url), "utf8"));
const ORIGIN = "https://ordax-site.vercel.app";

test("only the pinned OS entrypoint is exposed, never a copied Site identity implementation", () => {
  assert.equal(typeof gatewayFunction.fetch, "function");
  const adapter = fs.readFileSync(new URL("../api/account-proxy.mjs", import.meta.url), "utf8");
  assert.match(adapter, /\.\.\/\.\.\/api\/account-proxy\.mjs/);
  assert.doesNotMatch(adapter, /authorization|set-cookie|createClient|jwtVerify/);
  assert.equal(source.repository, "ordaxsystems/ordax-os");
  assert.equal(source.module_path, "site");
  assert.equal(source.frontend_path, "site/public");
  assert.equal(source.source_revision, "same-git-commit-as-os");
  assert.equal(source.production_deployment_activated, false);
});

test("same-origin routes use the one canonical proxy and disable caching", () => {
  for (const path of ["auth", "sync", "account"]) {
    assert.deepEqual(config.rewrites.find(item => item.source === `/${path}/:path*`), {
      source: `/${path}/:path*`,
      destination: `/api/account-proxy?ordax_path=/${path}/:path*`,
    });
    assert.ok(config.headers.some(item =>
      item.source === `/${path}/:path*`
      && item.headers.some(h => h.key === "Cache-Control" && h.value === "no-store")
    ));
  }
  assert.ok(config.headers.some(item => item.source === "/(.*)"
    && item.headers.some(h => h.key === "X-Robots-Tag" && h.value.includes("noindex"))));
  assert.ok(config.buildCommand.includes("--dev-lock contracts/dev-artifact-lock.json"));
  assert.equal(config.outputDirectory, "out/site");
});

test("the canonical source route policy rejects arbitrary account paths", () => {
  assert.equal(normalizeProductPath("/auth/session", "GET"), "/auth/session");
  assert.equal(normalizeProductPath("/account/spaces", "GET"), "/account/spaces");
  assert.equal(normalizeProductPath("/account/usage/mcp", "GET"), "/account/usage/mcp");
  assert.equal(normalizeProductPath("/account/close", "POST"), "/account/close");
  assert.equal(normalizeProductPath("/account/close", "GET"), null);
  assert.equal(normalizeProductPath("/account/unexpected", "GET"), null);
  assert.equal(normalizeProductPath("/../evil", "POST"), null);
  assert.equal(normalizeGatewayUrl("https://example.org/functions/v1/ordax-public-account-gateway/"), null);
});

test("missing production origin and upstream remain fail-closed, never anonymous HTML", async () => {
  const req = new Request(`${ORIGIN}/api/account-proxy?ordax_path=/auth/session`, {
    method: "GET",
    headers: { "accept": "application/json", "x-forwarded-for": "192.0.2.1" },
  });
  const unsetOrigin = await proxyPublicAccountRequest(req, {
    gatewayUrl: "", publicOrigin: "", oidcToken: "",
  });
  assert.equal(unsetOrigin.status, 503);
  assert.equal((await unsetOrigin.json()).error, "public-origin-unconfigured");

  const missingGateway = await proxyPublicAccountRequest(req, {
    gatewayUrl: "", publicOrigin: ORIGIN, oidcToken: "",
  });
  assert.equal(missingGateway.status, 503);
  assert.equal((await missingGateway.json()).error, "account-gateway-unconfigured");
  assert.match(missingGateway.headers.get("cache-control"), /no-store/);
});

test("the proxy requires exact trusted origin and an independently supplied OIDC token", async () => {
  const gatewayUrl = "https://example.org/functions/v1/ordax-public-account-gateway";
  const req = new Request(`${ORIGIN}/api/account-proxy?ordax_path=/auth/session`, {
    headers: { "accept": "application/json", "x-forwarded-for": "192.0.2.1" },
  });
  const foreign = await proxyPublicAccountRequest(req, {
    gatewayUrl, publicOrigin: "https://ordax.com.br", oidcToken: "",
  });
  assert.equal(foreign.status, 421);
  assert.equal((await foreign.json()).error, "public-origin-mismatch");

  const missingIdentity = await proxyPublicAccountRequest(req, {
    gatewayUrl, publicOrigin: ORIGIN, oidcToken: "",
  });
  assert.equal(missingIdentity.status, 503);
  assert.equal((await missingIdentity.json()).error, "public-proxy-identity-unavailable");
});

test("non-GET/POST methods are denied by canonical owner", async () => {
  const response = await proxyPublicAccountRequest(
    new Request(`${ORIGIN}/api/account-proxy?ordax_path=/auth/session`, { method: "DELETE" }),
    { publicOrigin: ORIGIN, gatewayUrl: "", oidcToken: "" },
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, POST");
});
