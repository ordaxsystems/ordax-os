import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_REQUEST_CONTEXT_CONTRACT,
  verifyTrustedPublicRequestContext,
} from "../infra/supabase/functions/ordax-public-account-gateway/public_request_context.mjs";

const ORIGIN = "https://ordax.com.br";
const HOST = "ordax.com.br";

function request(method = "GET", headers = {}) {
  return new Request(`${ORIGIN}/auth/session`, {
    method,
    headers: {
      "x-ordax-public-origin": ORIGIN,
      "x-forwarded-host": HOST,
      "x-forwarded-proto": "https",
      ...headers,
    },
  });
}

test("contract records fail-closed browser mutation requirements", () => {
  assert.equal(PUBLIC_REQUEST_CONTEXT_CONTRACT.schema, "prototype-ordax.public-request-context/1");
  assert.equal(PUBLIC_REQUEST_CONTEXT_CONTRACT.exactOriginRequiredForStateChange, true);
  assert.equal(PUBLIC_REQUEST_CONTEXT_CONTRACT.sameOriginFetchMetadataRequiredForStateChange, true);
  assert.equal(PUBLIC_REQUEST_CONTEXT_CONTRACT.missingOriginFailsClosedForStateChange, true);
  assert.equal(PUBLIC_REQUEST_CONTEXT_CONTRACT.canonicalAuthorityComesFromAuthenticatedProxy, true);
});

test("same-origin POST with exact trusted authority is accepted", () => {
  const result = verifyTrustedPublicRequestContext(request("POST", {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
  }));
  assert.deepEqual(result, { ok: true, origin: ORIGIN, host: HOST });
});

test("state-changing request without Origin fails closed", () => {
  const result = verifyTrustedPublicRequestContext(request("POST", {
    "sec-fetch-site": "same-origin",
  }));
  assert.deepEqual(result, { ok: false, code: "browser-origin-required" });
});

test("state-changing request without same-origin Fetch Metadata fails closed", () => {
  for (const value of ["", "same-site", "cross-site", "none"]) {
    const result = verifyTrustedPublicRequestContext(request("POST", {
      origin: ORIGIN,
      ...(value ? { "sec-fetch-site": value } : {}),
    }));
    assert.deepEqual(result, { ok: false, code: "same-origin-fetch-metadata-required" }, value);
  }
});

test("foreign and sibling origins are rejected", () => {
  for (const origin of [
    "https://evil.example",
    "https://preview.ordax.com.br",
    "https://ordax-os-public-git-branch-jogo-brasils-projects.vercel.app",
  ]) {
    const result = verifyTrustedPublicRequestContext(request("POST", {
      origin,
      "sec-fetch-site": "same-origin",
    }));
    assert.deepEqual(result, { ok: false, code: "browser-origin-mismatch" }, origin);
  }
});

test("forwarded host or proto spoofing is rejected", () => {
  let result = verifyTrustedPublicRequestContext(request("POST", {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "x-forwarded-host": "evil.example",
  }));
  assert.deepEqual(result, { ok: false, code: "trusted-forwarded-authority-mismatch" });

  result = verifyTrustedPublicRequestContext(request("POST", {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "x-forwarded-proto": "http",
  }));
  assert.deepEqual(result, { ok: false, code: "trusted-forwarded-authority-mismatch" });
});

test("trusted public origin is mandatory", () => {
  const result = verifyTrustedPublicRequestContext(request("POST", {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "x-ordax-public-origin": "",
  }));
  assert.deepEqual(result, { ok: false, code: "trusted-public-origin-required" });
});

test("top-level GET may omit Origin but explicit foreign Origin is rejected", () => {
  assert.deepEqual(
    verifyTrustedPublicRequestContext(request("GET")),
    { ok: true, origin: ORIGIN, host: HOST },
  );
  assert.deepEqual(
    verifyTrustedPublicRequestContext(request("GET", { origin: "https://evil.example" })),
    { ok: false, code: "browser-origin-mismatch" },
  );
});
