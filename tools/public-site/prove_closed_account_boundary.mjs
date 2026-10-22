#!/usr/bin/env node
/**
 * Read-only production proof for the currently CLOSED OrdaX account release.
 *
 * This does not sign in, register, create users, submit credentials, use
 * service-role keys, set cookies, or change remote state. It is an operational
 * check, not the legal/provider release gate.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PRODUCT_FAMILY_PUBLIC_ENDPOINTS } from "../../system/contracts/product-family.mjs";

const ROOT = new URL("../../", import.meta.url);
export const CLOSED_ACCOUNT_BOUNDARY_PROOF_SCHEMA = "ordax.account-closed-boundary-proof/1";

function requireHttpsBase(raw, path = "") {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" || url.username || url.password
    || url.search || url.hash || (path && !url.pathname.endsWith(path))) {
    throw new Error("Invalid canonical account destination");
  }
  return url.href.replace(/\/$/, "");
}

function requirePolicy(value, channel) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.active !== true
    || value.registrationEnabled !== false
    || value.publicRegistrationEnabled !== false
    || typeof value.policyId !== "string" || !value.policyId
    || typeof value.privacy?.sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.privacy.sha256)
    || typeof value.terms?.sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.terms.sha256)) {
    throw new Error(channel + ": closed registration/policy contract not proven");
  }
  return value;
}

async function getJson(get, url) {
  const response = await get(url, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response || response.status !== 200 || response.ok !== true) {
    throw new Error("Account read-only endpoint did not return HTTP 200");
  }
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Account read-only endpoint returned invalid JSON");
  }
  return value;
}

export async function proveClosedAccountBoundary({
  fetchImpl,
  gatewayBaseUrl,
  publicOrigin = PRODUCT_FAMILY_PUBLIC_ENDPOINTS.site.origin,
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch function required");
  const base = requireHttpsBase(gatewayBaseUrl, "/ordax-account-gateway");
  const site = requireHttpsBase(publicOrigin);
  if (site !== PRODUCT_FAMILY_PUBLIC_ENDPOINTS.site.origin) {
    throw new Error("Noncanonical public site origin");
  }
  // No account identifiers, cookies, passwords or POST requests are used.
  const native = requirePolicy(
    await getJson(fetchImpl, base + "/auth/registration-policy"), "Native",
  );
  const publicPolicy = requirePolicy(
    await getJson(fetchImpl, site + "/auth/registration-policy"), "Public Web",
  );
  if (native.policyId !== publicPolicy.policyId
    || native.privacy.sha256 !== publicPolicy.privacy.sha256
    || native.terms.sha256 !== publicPolicy.terms.sha256) {
    throw new Error("Native and Web legal policy projections diverge");
  }
  const session = await getJson(fetchImpl, site + "/auth/session");
  if (session.authenticated !== false) {
    throw new Error("Anonymous Web session must not be authenticated");
  }
  const health = await getJson(fetchImpl, base + "/health");
  if (health.service !== "ordax-account-gateway"
    || !Number.isSafeInteger(health.version) || health.version < 1) {
    throw new Error("Unexpected Gateway health identity");
  }
  return Object.freeze({
    $schema: CLOSED_ACCOUNT_BOUNDARY_PROOF_SCHEMA,
    status: "pass",
    scope: "read-only-production-closed-account",
    checks: Object.freeze({
      nativeRegistrationClosed: true,
      webRegistrationClosed: true,
      publicCapabilityClosed: true,
      sharedLegalPolicy: true,
      anonymousSession: true,
      gatewayHealthy: true,
    }),
    gatewayVersion: health.version,
    accountIdentifiersRecorded: false,
    credentialsPersisted: false,
    releaseActivationProven: false,
  });
}

async function main() {
  const legal = JSON.parse(await readFile(new URL("docs/contracts/public-legal-readiness.json", ROOT), "utf8"));
  const snapshots = JSON.parse(await readFile(new URL("docs/contracts/public-legal-snapshots.json", ROOT), "utf8"));
  if (legal.registration_binding?.registration_activation_allowed !== false
    || snapshots.status === "approved-versioned-snapshots") {
    throw new Error("Closed-account proof is not the active release gate");
  }
  const gatewayBaseUrl = await readFile(
    new URL("system/services/account/gateway-base-url", ROOT), "utf8",
  );
  console.log(JSON.stringify(await proveClosedAccountBoundary({
    fetchImpl: fetch,
    gatewayBaseUrl,
  }), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL("file://" + process.argv[1]))) {
  main().catch((error) => {
    // Report invariant names, not server payloads or authentication material.
    console.error("ACCOUNT_CLOSED_BOUNDARY=FAILED: " + error.message);
    process.exitCode = 1;
  });
}
