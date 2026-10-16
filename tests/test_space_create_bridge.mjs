import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseSpaceCreateRequest,
  projectSpaceCreateResult,
  SPACE_CREATE_SCHEMA,
  spaceCreateRpcArgs,
} from "../infra/supabase/functions/_shared/space_create_contract.mjs";
import {
  authorizeAccountTransport,
  isPublicBridgeRoute,
} from "../infra/supabase/functions/_shared/account_transport_admission.mjs";

const INDEX = new URL("../infra/supabase/functions/ordax-account-gateway/index.ts", import.meta.url);
const SUBJECT = "11111111-1111-4111-8111-111111111111";
const SPACE = "22222222-2222-4222-8222-222222222222";
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(overrides = {}) {
  return {
    name: "Minha Pizzaria",
    domain: "food",
    subtype: "pizzeria",
    idempotencyKey: KEY,
    ...overrides,
  };
}

test("Space create request is exact, bounded and normalizes only the display name", () => {
  const parsed = parseSpaceCreateRequest(
    JSON.stringify(request({ name: "  Minha Pizzaria  " })),
    "application/json; charset=utf-8",
  );
  assert.deepEqual(parsed, {
    name: "Minha Pizzaria",
    domain: "food",
    subtype: "pizzeria",
    idempotencyKey: KEY,
  });
  assert.deepEqual(spaceCreateRpcArgs(parsed), {
    p_name: "Minha Pizzaria",
    p_domain: "food",
    p_subtype: "pizzeria",
    p_idempotency_key: KEY,
  });

  for (const invalid of [
    request({ extra: true }),
    request({ name: "" }),
    request({ domain: "Food" }),
    request({ subtype: "school space" }),
    request({ idempotencyKey: "not-a-uuid" }),
  ]) {
    assert.throws(() => parseSpaceCreateRequest(JSON.stringify(invalid), "application/json"));
  }
  assert.throws(() => parseSpaceCreateRequest(JSON.stringify(request()), "text/plain"));
});

test("RPC result keeps the Profile as pending provisioning, never active composition", () => {
  const parsed = parseSpaceCreateRequest(JSON.stringify(request()), "application/json");
  const projected = projectSpaceCreateResult({
    space_id: SPACE,
    owner_user_id: SUBJECT,
    name: "Minha Pizzaria",
    kind: "professional",
    state: "active",
    domain: "food",
    subtype: "pizzeria",
    profile_slug: "pizzaria-br",
    profile_version: 1,
    created: true,
  }, { subjectId: SUBJECT, request: parsed });

  assert.equal(projected.$schema, SPACE_CREATE_SCHEMA);
  assert.equal(projected.created, true);
  assert.equal(projected.space.profilePack, null);
  assert.deepEqual(projected.profileToProvision, { slug: "pizzaria-br", version: 1 });
  assert.equal(projected.nextStep, "validate-profile-provisioning");
  assert.throws(() => projectSpaceCreateResult({
    space_id: SPACE,
    owner_user_id: "33333333-3333-4333-8333-333333333333",
    name: "Minha Pizzaria",
    kind: "professional",
    state: "active",
    domain: "food",
    subtype: "pizzeria",
    profile_slug: "pizzaria-br",
    profile_version: 1,
    created: true,
  }, { subjectId: SUBJECT, request: parsed }));
});

test("Space create route is Native-session-only while public Account creation remains closed", async () => {
  const path = "/account/spaces/create";
  assert.equal(isPublicBridgeRoute("POST", path), false);
  const req = new Request("https://example.invalid" + path, { method: "POST" });
  assert.deepEqual(await authorizeAccountTransport(req, path, {
    verifyNativeSession: async () => true,
  }), { ok: true, mode: "native-user" });
  assert.deepEqual(await authorizeAccountTransport(req, path, {
    verifyNativeSession: async () => false,
  }), { ok: false, code: "native-account-session-required" });
});

test("Account gateway delegates authority to the authenticated database RPC", () => {
  const source = readFileSync(INDEX, "utf-8");
  const routeStart = source.indexOf('if (path === "/account/spaces/create" && req.method === "POST")');
  const nextRoute = source.indexOf('if (path === "/account/spaces" && req.method === "GET")', routeStart);
  assert.ok(routeStart > 0 && nextRoute > routeStart);
  const route = source.slice(routeStart, nextRoute);
  assert.match(route, /const session = await authenticated\(req\)/);
  assert.match(route, /parseSpaceCreateRequest/);
  assert.match(route, /const supabase = client\(session\.access\)/);
  assert.match(route, /supabase\.rpc\(\s*"ordax_create_space_v1"/);
  assert.match(route, /spaceCreateRpcArgs\(request\)/);
  assert.match(route, /projectSpaceCreateResult/);
  assert.doesNotMatch(route, /service_role|adminConfig|accountAdminRpc/);
});
