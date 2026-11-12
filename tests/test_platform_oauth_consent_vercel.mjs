import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { oauthConsentResponse } from "../api/oauth-consent.mjs";

const CANONICAL_ISSUER = "https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1";
const config = {
  PRODUCT_AUTH_ISSUER: CANONICAL_ISSUER,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_Example012345678901234567890",
};
const consentUrl = "https://ordax.com.br/oauth/consent?authorization_id=the_authorization_id-123";
test("canonical first-party consent handles a bounded OAuth request without collecting tokens on the server", async () => {
  const r = oauthConsentResponse(new Request(consentUrl), config);
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(r.headers.get("content-security-policy"), /connect-src https:\/\/jhfphsjptrpmtnzkpwud\.supabase\.co/);
  assert.match(text, /client\.auth\.oauth\.getAuthorizationDetails/);
  assert.match(text, /client\.auth\.oauth\.approveAuthorization/);
  assert.match(text, /client\.auth\.oauth\.denyAuthorization/);
  assert.match(text, /client\.auth\.getUser/);
  assert.match(text, /auth\.signInWithPassword/);
  assert.match(text, /shouldCreateUser:false/);
  assert.match(text, /the_authorization_id-123/);
  assert.match(text, /https:\/\/ordax\.com\.br\/oauth\/consent/);
  assert.doesNotMatch(text, /eobcxuyvhkvdmkbaihwh/);
  assert.doesNotMatch(text, /service_role|SUPABASE_SERVICE_ROLE_KEY|anon\.supabase\.co/);
});

test("desktop OAuth keeps the Supabase redirect recoverable before navigating", async () => {
  const response = oauthConsentResponse(new Request(consentUrl), config);
  const text = await response.text();
  assert.match(text, /id="clientReturn"/);
  assert.match(text, /function returnToClient\(value\)/);
  assert.match(text, /q\('clientReturn'\)\.href=target\.href/);
  assert.match(text, /location\.assign\(target\.href\)/);
  assert.match(text, /Concluir no ORDAX Studio/);
  assert.match(text, /returnToClient\(data\.redirect_url\)/);
  assert.doesNotMatch(text, /fetch\([^\n]*127\.0\.0\.1/);
});

test("expired authorization is fail-closed and tells the user to restart the ChatGPT connection", async () => {
  const response = oauthConsentResponse(new Request(consentUrl), config);
  const text = await response.text();
  assert.match(text, /authorizationExpired/);
  assert.match(text, /error\?\.status===404/);
  assert.match(text, /Este pedido do ChatGPT expirou/);
  assert.match(text, /q\('approve'\)\.disabled=true/);
  assert.match(text, /q\('deny'\)\.disabled=true/);
  assert.match(text, /show\('clientReturn',false\)/);
  assert.match(text, /await load\(\)/);
});

test("authorization_id is required, single, bounded and not interpreted as JavaScript", () => {
  for (const url of [
    "https://ordax.com.br/oauth/consent",
    "https://ordax.com.br/oauth/consent?authorization_id=",
    "https://ordax.com.br/oauth/consent?authorization_id=ab&authorization_id=cd",
    "https://ordax.com.br/oauth/consent?authorization_id=%3Cscript%3E",
    "https://ordax.com.br/oauth/consent?authorization_id=" + "a".repeat(257),
  ]) {
    assert.equal(oauthConsentResponse(new Request(url), config).status, 400, url);
  }
});

test("unconfigured canonical Product OAuth never renders login/approve", async () => {
  for (const env of [{}, {PRODUCT_AUTH_ISSUER: CANONICAL_ISSUER}, {PRODUCT_AUTH_ISSUER: "http://example.invalid/auth/v1", SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY}]) {
    const response = oauthConsentResponse(new Request(consentUrl), env);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /<input|approveAuthorization/);
  }
  assert.equal(oauthConsentResponse(new Request(consentUrl,{method:"POST"}),config).status,405);
});

test("Vercel has exactly one first-party OAuth consent rewrite, isolated from account proxy", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  const routes = config.rewrites.filter(x=>x.source==="/oauth/consent");
  assert.deepEqual(routes,[{source:"/oauth/consent",destination:"/api/oauth-consent"}]);
  assert.ok(config.rewrites.some(x=>x.source==="/auth/:path*"));
  assert.ok(config.rewrites.some(x=>x.source==="/account/:path*"));
});
