import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Readable } from "node:stream";
import { createEmulatorAccountGateway } from "../tools/windows-emulator/account-gateway.mjs";
import { assertSpaceCreatePort, validateSpaceCreateCommand, validateSpaceCreateReceipt } from "../system/contracts/space-creation.mjs";
import { createNativeSpaceCreatePort } from "../system/adapters/native/space-create.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";

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

test("Space create result rejects coerced, ambiguous Profile Pack versions", () => {
  const row = {
    space_id: SPACE, owner_user_id: SUBJECT, name: "Minha Pizzaria",
    kind: "professional", state: "active", domain: "food", subtype: "pizzeria",
    profile_slug: "pizzaria-br", profile_version: 1, created: true,
  };
  for (const invalid of ["1", true, null, 0, -1, 9007199254740992]) {
    assert.throws(
      () => projectSpaceCreateResult({ ...row, profile_version: invalid }, {
        subjectId: SUBJECT,
        request: request(),
      }),
      /invalid-space-create-result/,
    );
  }
});

const SESSION_SCHEMA = "prototype-ordax.public-identity-session/1";
function spaceReceipt({ subject = SUBJECT, created = true, extra = {} } = {}) {
  return {
    $schema: SPACE_CREATE_SCHEMA,
    created,
    space: {
      id: SPACE,
      ownerId: subject,
      name: "Minha Pizzaria",
      kind: "professional",
      state: "active",
      domain: "food",
      subtype: "pizzeria",
      profilePack: null,
    },
    profileToProvision: { slug: "pizzaria-br", version: 1 },
    nextStep: "validate-profile-provisioning",
    ...extra,
  };
}
function accountBrowserRequest(body, headers = {}, url = "/account/spaces/create") {
  const request = Readable.from([Buffer.from(body)]);
  request.method = "POST";
  request.url = url;
  request.socket = { remoteAddress: "127.0.0.1" };
  request.headers = {
    host: "127.0.0.1:3333",
    origin: "http://127.0.0.1:3333",
    "content-type": "application/json",
    ...headers,
  };
  let status = null;
  let payload = null;
  const response = {
    writeHead(nextStatus) { status = nextStatus; },
    end(content) { payload = content ? JSON.parse(content.toString()) : null; },
  };
  return { request, response, result: () => ({ status, payload }) };
}
async function invokeAccountGateway(middleware, value, headers = {}, url) {
  const req = accountBrowserRequest(typeof value === "string" ? value : JSON.stringify(value), headers, url);
  const handled = await middleware(req.request, req.response);
  assert.equal(handled, true);
  return req.result();
}
function fakeWindowsAccountGateway({ authenticated = true, status = 201, receipt = spaceReceipt() } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    if (url.endsWith("/auth/session")) {
      return new Response(JSON.stringify(authenticated
        ? { $schema: SESSION_SCHEMA, authenticated: true, status: "authenticated", provider: "supabase", subject: SUBJECT, email: "owner@example.test" }
        : { $schema: SESSION_SCHEMA, authenticated: false, status: "anonymous", provider: "supabase" }), { status: 200 });
    }
    if (url.endsWith("/account/spaces/create")) {
      return new Response(JSON.stringify(receipt), { status });
    }
    throw Error("unexpected upstream route");
  };
  const middleware = createEmulatorAccountGateway({
    origin: "https://example.test/functions/v1/ordax-account-gateway",
    fetchImpl,
    cookieVault: {
      async load() { return new Map([["ordax_access", "opaque-native-session"]]); },
      async save() {},
    },
  });
  return { middleware, calls };
}

test("Windows Desktop forwards an authenticated, bounded Space intent and validates 201 receipt", async () => {
  const gateway = fakeWindowsAccountGateway();
  const result = await invokeAccountGateway(gateway.middleware, request());
  assert.equal(result.status, 201);
  assert.equal(result.payload.created, true);
  assert.equal(result.payload.space.ownerId, SUBJECT);
  assert.equal(result.payload.space.profilePack, null);
  assert.deepEqual(result.payload.profileToProvision, { slug: "pizzaria-br", version: 1 });
  assert.deepEqual(gateway.calls.map(call => call.method), ["GET", "POST"]);
  assert.deepEqual(JSON.parse(gateway.calls[1].body), request());
  assert.equal(gateway.calls[1].url.endsWith("/account/spaces/create"), true);
});

test("Windows Desktop denies anonymous create without forwarding and never trusts foreign Origin", async () => {
  const guest = fakeWindowsAccountGateway({ authenticated: false });
  assert.equal((await invokeAccountGateway(guest.middleware, request())).status, 401);
  assert.deepEqual(guest.calls.map(call => call.method), ["GET"]);

  const forged = fakeWindowsAccountGateway();
  assert.equal((await invokeAccountGateway(forged.middleware, request(), { origin: "https://other.example" })).status, 403);
  assert.equal(forged.calls.length, 0);
  assert.equal((await invokeAccountGateway(forged.middleware, request(), {}, "/account/spaces/create?debug=1")).status, 400);
  assert.equal((await invokeAccountGateway(forged.middleware, request(), { "content-type": "text/plain" })).status, 415);
  assert.equal(forged.calls.length, 0);
});

test("Windows Desktop rejects invalid intent, unexpected fields and oversized bodies before network", async () => {
  const gateway = fakeWindowsAccountGateway();
  for (const invalid of [request({ idempotencyKey: "bad" }), request({ ownerId: SUBJECT }), request({ domain: "Food" })]) {
    assert.equal((await invokeAccountGateway(gateway.middleware, invalid)).status, 400);
  }
  assert.equal((await invokeAccountGateway(gateway.middleware, "x".repeat(4097))).status, 413);
  assert.equal(gateway.calls.length, 0);
});

test("Windows Desktop keeps idempotent 200 replay and rejects invented/foreign creation receipt", async () => {
  const replay = fakeWindowsAccountGateway({ status: 200, receipt: spaceReceipt({ created: false }) });
  assert.equal((await invokeAccountGateway(replay.middleware, request())).status, 200);
  const mismatchedStatus = fakeWindowsAccountGateway({ status: 200 });
  assert.equal((await invokeAccountGateway(mismatchedStatus.middleware, request())).status, 503);
  const wrongOwner = fakeWindowsAccountGateway({ receipt: spaceReceipt({ subject: "33333333-3333-4333-8333-333333333333" }) });
  assert.equal((await invokeAccountGateway(wrongOwner.middleware, request())).status, 503);
  const extraField = fakeWindowsAccountGateway({ receipt: spaceReceipt({ extra: { authorization: "invented" } }) });
  assert.equal((await invokeAccountGateway(extraField.middleware, request())).status, 503);
  assert.throws(() => validateSpaceCreateReceipt(spaceReceipt({ extra: { installed: true } }), {
    subjectId: SUBJECT, request: request(),
  }));
  for (const gateway of [mismatchedStatus, wrongOwner, extraField]) {
    assert.equal(gateway.calls.length, 2);
  }
});

test("Packaged Desktop command validation agrees with authoritative Gateway parser", () => {
  const input = request({ name: "  Minha Pizzaria  " });
  const server = parseSpaceCreateRequest(JSON.stringify(input), "application/json");
  assert.deepEqual(validateSpaceCreateCommand(input), server);
  for (const invalid of [
    request({ extra: true }),
    request({ domain: "Food" }),
    request({ subtype: "3d print " }),
    request({ idempotencyKey: "invalid" }),
    request({ name: "\u0001" }),
  ]) {
    assert.throws(() => validateSpaceCreateCommand(invalid));
    assert.throws(() => parseSpaceCreateRequest(JSON.stringify(invalid), "application/json"));
  }
  const windowsModule = readFileSync(new URL("../tools/windows-emulator/account-gateway.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(windowsModule, /from\s+["'][^"']*infra\/supabase\//);
  assert.match(windowsModule, /validateSpaceCreateCommand/);
});

function nativeIdentity(initial = { state: "signed-in", subjectId: SUBJECT, displayName: "Owner" }) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() { return snapshot; },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    update(next) {
      snapshot = next;
      for (const listener of listeners) listener(snapshot);
    },
  };
}

test("Native Desktop port submits user intent on existing same-origin authority, without client-created owner", async () => {
  const identity = nativeIdentity();
  const calls = [];
  const host = { fetch: async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify(spaceReceipt()), { status: 201 });
  } };
  const port = assertSpaceCreatePort(createNativeSpaceCreatePort(host, identity));
  try {
    const result = await port.create(request());
    assert.equal(result.space.ownerId, SUBJECT);
    assert.equal(result.space.profilePack, null);
    assert.equal(result.nextStep, "validate-profile-provisioning");
    assert.deepEqual(result.profileToProvision, { slug: "pizzaria-br", version: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/account/spaces/create");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.credentials, "same-origin");
    assert.equal(calls[0].options.redirect, "manual");
    assert.deepEqual(JSON.parse(calls[0].options.body), request());
  } finally {
    port.dispose();
  }
});

test("Native Space creation port rejects absent session and drops in-flight response after account change", async () => {
  const guest = nativeIdentity({ state: "signed-out" });
  let requests = 0;
  const disabled = createNativeSpaceCreatePort({ fetch: async () => { requests++; throw Error("unexpected"); } }, guest);
  try {
    await assert.rejects(disabled.create(request()), /authenticated/);
    assert.equal(requests, 0);
  } finally {
    disabled.dispose();
  }

  const identity = nativeIdentity();
  let resolveRequest;
  const port = createNativeSpaceCreatePort({
    fetch: () => new Promise(resolve => { resolveRequest = resolve; }),
  }, identity);
  const pending = port.create(request());
  identity.update({ state: "signed-in", subjectId: "33333333-3333-4333-8333-333333333333", displayName: "Other" });
  resolveRequest(new Response(JSON.stringify(spaceReceipt()), { status: 201 }));
  await assert.rejects(pending, /session changed/);
  port.dispose();
  await assert.rejects(port.create(request()), /disposed/);
});

test("Native Space creation port honors replay and denies gateway failures, wrong owner and false receipts", async () => {
  const cases = [
    { status: 200, receipt: spaceReceipt({ created: false }), passes: true },
    { status: 401, receipt: { error: "auth" } },
    { status: 409, receipt: { error: "conflict" } },
    { status: 423, receipt: { error: "locked" } },
    { status: 201, receipt: spaceReceipt({ created: false }) },
    { status: 201, receipt: spaceReceipt({ subject: "33333333-3333-4333-8333-333333333333" }) },
    { status: 201, receipt: spaceReceipt({ extra: { alreadyInstalled: true } }) },
  ];
  for (const item of cases) {
    const identity = nativeIdentity();
    const port = createNativeSpaceCreatePort({
      fetch: async () => new Response(JSON.stringify(item.receipt), { status: item.status }),
    }, identity);
    try {
      if (item.passes) {
        const result = await port.create(request());
        assert.equal(result.created, false);
      } else {
        await assert.rejects(port.create(request()));
      }
    } finally {
      port.dispose();
    }
  }
});

test("Native composition exposes creation only when installed Desktop transport exists", () => {
  const source = readFileSync(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8");
  assert.match(source, /const spaceCreation = windowsDesktopHost/);
  assert.match(source, /createNativeSpaceCreatePort\(window, identitySession\)/);
  assert.match(source, /spaceCreation\?\.dispose\(\)/);
});
