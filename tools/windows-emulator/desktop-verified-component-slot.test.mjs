import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesktopVerifiedComponentSlotMiddleware } from "../../system/adapters/desktop/verified-component-slot-host.mjs";
import { createDesktopVerifiedStoreCatalogMiddleware, desktopStoreCatalogEnvelopeUrl } from "../../system/adapters/desktop/verified-store-catalog-host.mjs";
import { nativeEmulatorPlugin } from "./native-host.mjs";

const SHA = "a".repeat(40);
const SOURCE = "578d38256fc906e7208764ef0b2616c8d64b784f";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "ordax-signed-current-win-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const osRoot = join(root, "verified-os");
  const verifierRoot = join(root, "installed-electron-template");
  const userData = join(root, "user-data");
  const policies = join(osRoot, "docs", "contracts");
  const anchorDir = join(osRoot, "system", "trust");
  const installedTrustDir = join(verifierRoot, "system", "trust");
  const binaryDir = join(verifierRoot, "tools", "runtime-component-channel");
  const componentRoot = join(userData, "Components");
  for (const dir of [policies, anchorDir, installedTrustDir, binaryDir, componentRoot]) {
    mkdirSync(dir, { recursive: true });
  }
  const helper = join(binaryDir, "ordax-runtime-component-channel.exe");
  writeFileSync(helper, Buffer.from("fake-test-verifier-only"));
  const anchor = Buffer.from(JSON.stringify({
    "$schema": "prototype-ordax.runtime-component-trust/1",
    key_id: "ordax-runtime-components-v1",
    public_key_base64: Buffer.alloc(32, 42).toString("base64"),
  }));
  const anchorPath = join(anchorDir, "runtime-components-ed25519.json");
  writeFileSync(anchorPath, anchor);
  const installedAnchorPath = join(installedTrustDir, "runtime-components-ed25519.json");
  writeFileSync(installedAnchorPath, anchor);
  const policyPath = join(policies, "runtime-component-trust-policy.json");
  const policy = {
    "$schema": "prototype-ordax.runtime-component-trust-policy/1",
    status: "canonical-public-trust-pinned", trust_domain: "runtime-components",
    key_id: "ordax-runtime-components-v1",
    public_anchor: {
      repository_path: "system/trust/runtime-components-ed25519.json",
      sha256: createHash("sha256").update(anchor).digest("hex"),
      pinned: true,
    },
    current_gates: { canonical_component_trust_anchor_pinned: true },
  };
  writeFileSync(policyPath, JSON.stringify(policy));
  writeFileSync(join(policies, "runtime-component-package.json"), JSON.stringify({
    "$schema": "prototype-ordax.runtime-component-package-policy/1",
    canonical_component_trust_anchor_pinned: true,
  }));
  return { root, osRoot, verifierRoot, userData, componentRoot, helper,
    anchorPath, installedAnchorPath, policyPath, policy };
}

async function serve(t, fixture, execFileImpl) {
  const middleware = createDesktopVerifiedComponentSlotMiddleware({
    systemRoot: fixture.osRoot, verifierRoot: fixture.verifierRoot,
    userData: fixture.userData,
    // A Linux CI host can exercise the Windows transport without granting
    // Windows availability on the actual installed Electron application.
    platform: "win32", execFileImpl,
  });
  const server = createServer((req, res) => middleware(req, res, () => {
    res.writeHead(418); res.end();
  }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return "http://127.0.0.1:" + server.address().port;
}

test("Windows signed current reader denies unsigned/unpinned and never launches the helper", async t => {
  const f = setup(t);
  const executed = [];
  const base = await serve(t, f, (bin, args, opt, cb) => {
    executed.push(args); cb(null, Buffer.from("unexpected"));
  });
  const url = base + "/__ordax/native/component-runtime?component=assistant&state=current";
  let response = await fetch(url);
  assert.equal(response.status, 409, "a pinned test fixture needs a verified CLI response");
  f.policy.current_gates.canonical_component_trust_anchor_pinned = false;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  response = await fetch(url);
  assert.equal(response.status, 404);
  assert.equal(executed.length, 1);
  f.policy.current_gates.canonical_component_trust_anchor_pinned = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  unlinkSync(f.anchorPath);
  response = await fetch(url);
  assert.equal(response.status, 404);
  assert.equal(executed.length, 1);
});

test("Windows current-slot metadata and exact module bytes delegate to Go without exposing activation", async t => {
  const f = setup(t);
  const calls = [];
  const base = await serve(t, f, (binary, args, options, cb) => {
    calls.push({ binary, args, options });
    assert.equal(binary, f.helper);
    assert.notEqual(binary, join(f.osRoot, "tools", "runtime-component-channel",
      "ordax-runtime-component-channel.exe"));
    assert.equal(options.timeout, 3000);
    assert.equal(options.encoding, "buffer");
    assert.equal(options.windowsHide, true);
    assert.equal(args.at(-2), "--root");
    assert.equal(args.at(-1), f.componentRoot);
    if (args[0] === "resolve-current") {
      return cb(null, Buffer.from(
        "RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\n"
        + "COMPONENT_ID=assistant\n"
        + "REVISION=4\n"
        + "SOURCE=SLOT\n"
        + "CURRENT_VERSION=0.1.2\n"
        + "CURRENT_SOURCE_COMMIT=" + SOURCE + "\n"
        + "SLOT=" + join(f.componentRoot, "assistant", "slot") + "\n"
        + "ENTRYPOINT=system/apps/assistant/src/runtime.mjs\n"
        + "RUNTIME_SERVED_FROM_SLOT=NO\n",
      ));
    }
    if (args[0] === "read-runtime-file") {
      assert.ok(args.includes("--trust"));
      assert.ok(args.includes("--source-commit"));
      assert.ok(args.includes(SOURCE));
      assert.ok(args.includes("system/apps/assistant/src/runtime.mjs"));
      return cb(null, Buffer.from("export const componentRuntime = {};\n"));
    }
    throw Error("Unexpected command");
  });
  const metadata = await fetch(base + "/__ordax/native/component-runtime?component=assistant&state=current");
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), {
    componentId: "assistant", state: "current", source: "slot", revision: 4,
    version: "0.1.2", sourceCommit: SOURCE,
    entrypoint: "system/apps/assistant/src/runtime.mjs", pendingHealth: null,
  });
  const runtime = await fetch(base + "/__ordax/native/component-module/assistant/current/0.1.2/"
    + SOURCE + "/system/apps/assistant/src/runtime.mjs");
  assert.equal(runtime.status, 200);
  assert.match(runtime.headers.get("content-type"), /text\/javascript/);
  assert.equal(runtime.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await runtime.text(), "export const componentRuntime = {};\n");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ args }) => args[0]), ["resolve-current", "read-runtime-file"]);
});

test("Windows Native slot reader rejects traversal, pending, stale identity and forged CLI responses", async t => {
  const f = setup(t);
  let invocations = 0;
  const base = await serve(t, f, (_bin, _args, _options, cb) => {
    invocations++;
    cb(null, Buffer.from("RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\n"
      + "COMPONENT_ID=studio\nREVISION=2\nSOURCE=ABSENT\nRUNTIME_SERVED_FROM_SLOT=NO\n"));
  });
  const invalid = [
    "/__ordax/native/component-runtime?component=clock&state=current",
    "/__ordax/native/component-runtime?component=assistant&state=pending",
    "/__ordax/native/component-runtime?component=assistant&component=studio&state=current",
    "/__ordax/native/component-module/assistant/pending/0.1.2/" + SOURCE
      + "/system/apps/assistant/src/runtime.mjs",
    "/__ordax/native/component-module/assistant/current/0.1.2/" + SOURCE
      + "/system/apps/assistant/src/bad%5cpath.mjs",
    "/__ordax/native/component-module/assistant/current/0.1.2/" + SOURCE
      + "/system/apps/assistant/../runtime.mjs",
  ];
  for (const path of invalid) {
    const response = await fetch(base + path, { redirect: "manual" });
    assert.notEqual(response.status, 200, path);
  }
  assert.equal(invocations, 0);
  assert.equal((await fetch(base + "/__ordax/native/component-runtime?component=assistant&state=current")).status, 409);
  assert.equal(invocations, 1);
  const nonGet = await fetch(base + "/__ordax/native/component-runtime?component=assistant&state=current", { method: "POST" });
  assert.equal(nonGet.status, 405);
  assert.equal(invocations, 1);
});

test("Windows signed slot bridge rejects symlinked verifier even when test trust is pinned", async t => {
  const f = setup(t);
  unlinkSync(f.helper);
  symlinkSync(join(f.root, "fake-elsewhere.exe"), f.helper);
  let called = false;
  const base = await serve(t, f, (_bin, _args, _options, cb) => {
    called = true; cb(null, Buffer.from("unexpected"));
  });
  assert.equal((await fetch(base + "/__ordax/native/component-runtime?component=assistant&state=current")).status, 404);
  assert.equal(called, false);
});

test("Windows ordax-pull checkout cannot replace installed canonical verifier executable", async t => {
  const f = setup(t);
  const checkoutBinary = join(f.osRoot, "tools", "runtime-component-channel",
    "ordax-runtime-component-channel.exe");
  mkdirSync(join(f.osRoot, "tools", "runtime-component-channel"), { recursive: true });
  writeFileSync(checkoutBinary, "UNTRUSTED_CHECKOUT_HELPER");
  const calls = [];
  const base = await serve(t, f, (binary, args, options, cb) => {
    calls.push(binary);
    assert.equal(binary, f.helper);
    assert.notEqual(binary, checkoutBinary);
    cb(null, Buffer.from([
      "RUNTIME_COMPONENT_CURRENT_RESOLVED=YES",
      "COMPONENT_ID=assistant",
      "REVISION=0",
      "SOURCE=ABSENT",
      "RUNTIME_SERVED_FROM_SLOT=NO",
      "",
    ].join("\n")));
  });
  const response = await fetch(base + "/__ordax/native/component-runtime?component=assistant&state=current");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, "absent");
  assert.deepEqual(calls, [f.helper]);
});

test("Windows component reader cannot adopt modified checkout trust or missing installer anchor", async t => {
  const f = setup(t);
  let invoked = 0;
  const base = await serve(t, f, (_bin, _args, _options, cb) => {
    invoked++;
    cb(null, Buffer.from("RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\n"
      + "COMPONENT_ID=assistant\nREVISION=0\nSOURCE=ABSENT\n"
      + "RUNTIME_SERVED_FROM_SLOT=NO\n"));
  });
  const url = base + "/__ordax/native/component-runtime?component=assistant&state=current";
  assert.equal((await fetch(url)).status, 200);
  writeFileSync(f.anchorPath, "FORGED_CHECKOUT_PUBLIC_KEY");
  assert.equal((await fetch(url)).status, 404);
  assert.equal(invoked, 1);
  // Rebuild the checkout's valid public key by copying only the installed
  // fixture bytes. The installer remains the sole source of trust.
  const valid = readFileSync(f.installedAnchorPath);
  writeFileSync(f.anchorPath, valid);
  unlinkSync(f.installedAnchorPath);
  assert.equal((await fetch(url)).status, 404);
  assert.equal(invoked, 1);
});


test("Windows exposes release/2 compatibility only through exact current revision and pinned Go trust", async t => {
  const f = setup(t);
  const calls = [];
  const trustSha = createHash("sha256").update(readFileSync(f.installedAnchorPath)).digest("hex");
  const descriptor = Object.freeze({
    schema: "ordax.component-compatibility/1", componentId: "assistant",
    componentVersion: "0.1.2",
    provides: [{ id: "ordax.component-runtime", major: 1 }],
    requires: [{ id: "ordax.identity-session", minMajor: 1, maxMajor: 1, optional: false }],
    state: null, authority: "none",
  });
  const report = {
    schema: "ordax.activation-slot-compatibility-snapshot/1",
    authority: "none", componentId: "assistant", target: "current", revision: 7,
    trustScope: "caller-supplied-public-anchor", trustSHA256: trustSha,
    pendingHealth: "none",
    verifiedSlot: {
      schema: "ordax.verified-slot-compatibility/1", authority: "none",
      trustScope: "caller-supplied-public-anchor", trustSHA256: trustSha,
      activationStatus: "not-evaluated", componentId: "assistant",
      version: "0.1.2", sourceCommit: SOURCE, descriptor,
    },
  };
  let responseReport = report;
  const base = await serve(t, f, (binary, args, opts, cb) => {
    calls.push(args);
    assert.equal(binary, f.helper);
    assert.deepEqual(args, [
      "inspect-activation-compatibility-v2", "--component", "assistant",
      "--target", "current", "--expected-revision", "7",
      "--trust", f.installedAnchorPath, "--root", f.componentRoot,
    ]);
    assert.equal(opts.timeout, 3000);
    cb(null, Buffer.from(JSON.stringify(responseReport)));
  });
  const url = base + "/__ordax/native/component-compatibility?component=assistant&state=current&revision=7";
  const ok = await fetch(url);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {
    schema: "ordax.native-verified-current-compatibility/1",
    componentId: "assistant", state: "current", revision: 7,
    version: "0.1.2", sourceCommit: SOURCE, descriptor,
  });
  assert.equal(calls.length, 1);
  const invalid = [
    "component=assistant&state=pending&revision=7",
    "component=assistant&state=current&revision=0",
    "component=assistant&state=current&revision=07",
    "component=assistant&state=current&revision=7&revision=7",
    "component=calendar&state=current&revision=7",
  ];
  for (const query of invalid) {
    assert.notEqual((await fetch(base + "/__ordax/native/component-compatibility?" + query)).status, 200);
  }
  assert.equal(calls.length, 1);
  for (const forged of [
    { ...report, revision: 8 },
    { ...report, trustSHA256: "0".repeat(64) },
    { ...report, verifiedSlot: { ...report.verifiedSlot, sourceCommit: "bad" } },
    { ...report, verifiedSlot: { ...report.verifiedSlot, descriptor: { ...descriptor, componentId: "studio" } } },
  ]) {
    responseReport = forged;
    assert.equal((await fetch(url)).status, 409);
  }
  assert.equal(calls.length, 5);
});


async function serveVerifiedStore(t, fixture, execFileImpl, options = {}) {
  const middleware = createDesktopVerifiedStoreCatalogMiddleware({
    systemRoot: fixture.osRoot, verifierRoot: fixture.verifierRoot,
    userData: fixture.userData, platform: "win32", execFileImpl, ...options,
  });
  const server = createServer((req, res) => middleware(req, res, () => {
    res.writeHead(418); res.end();
  }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return "http://127.0.0.1:" + server.address().port;
}

function signedCatalogFixture(sequence = 4, digest = "f".repeat(64)) {
  const COMMIT = "a".repeat(40);
  const identity = (name, hash) => ({ name, sha256: hash.repeat(64), size: 123 });
  return {
    schema: "ordax.verified-app-store-catalog/1", state: "ready",
    sequence, catalogSha256: digest,
    source: { repository: "ordaxsystems/ordax-apps", commit: COMMIT },
    trust: { domain: "runtime-components", keyId: "ordax-runtime-components-v1" },
    entries: [{
      appId: "notes", title: "Notas", version: "0.4.3",
      releaseMode: "component-slot", sourceCommit: COMMIT,
      artifacts: {
        package: identity("notes.zip", "b"),
        release: identity("notes.release.json", "c"),
        compatibility: identity("notes.compatibility.json", "d"),
        componentEnvelope: identity("notes.runtime-component-envelope.json", "e"),
      },
    }],
    reason: null, authority: "none",
  };
}

test("Desktop Store route is truthful and cannot run an unsigned or unpublished verifier", async t => {
  const f = setup(t);
  let invocations = 0;
  const base = await serveVerifiedStore(t, f, () => { invocations++; throw Error("must not run"); });
  const url = base + "/__ordax/native/store-catalog";
  let res = await fetch(url);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.state, "unavailable");
  assert.equal(body.authority, "none");
  assert.deepEqual(body.entries, []);
  f.policy.current_gates.component_publish_allowed = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  res = await fetch(url);
  assert.equal((await res.json()).reason, "catalog-envelope-unavailable");
  assert.equal(invocations, 0);
  for (const [method, suffix, expected] of [
    ["POST", "", 405], ["GET", "?anything=1", 400],
  ]) assert.equal((await fetch(url + suffix, { method })).status, expected);
  assert.equal(invocations, 0);
});

test("Desktop Store reuses pinned Go verifier and rejects signed catalog replay/equivocation", async t => {
  const f = setup(t);
  f.policy.current_gates.component_publish_allowed = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  const store = join(f.userData, "Store");
  mkdirSync(store);
  writeFileSync(join(store, "catalog-envelope.json"), "SIGNED_ENVELOPE_TEST_FIXTURE");
  let answer = signedCatalogFixture(), calls = 0;
  const base = await serveVerifiedStore(t, f, (binary, args, options, cb) => {
    calls++;
    assert.equal(binary, f.helper, "The helper comes from the installed template");
    assert.equal(args[0], "verify-store-catalog");
    assert.equal(args[args.indexOf("--trust") + 1], f.installedAnchorPath);
    assert.equal(options.timeout, 3000);
    const output = args[args.indexOf("--out") + 1];
    writeFileSync(output, JSON.stringify(answer));
    cb(null, Buffer.alloc(0));
  });
  const url = base + "/__ordax/native/store-catalog";
  let r = await fetch(url); assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), answer);
  const watermark = JSON.parse(readFileSync(join(store, "catalog-watermark.json"), "utf8"));
  assert.equal(watermark.sequence, 4);
  answer = signedCatalogFixture(3, "d".repeat(64));
  r = await fetch(url);
  assert.equal((await r.json()).state, "unavailable", "Downgrade fails closed");
  answer = signedCatalogFixture(4, "0".repeat(64));
  r = await fetch(url);
  assert.equal((await r.json()).state, "unavailable", "Same sequence with changed digest fails closed");
  answer = signedCatalogFixture(5, "5".repeat(64));
  r = await fetch(url);
  assert.equal((await r.json()).state, "ready");
  assert.equal(JSON.parse(readFileSync(join(store, "catalog-watermark.json"), "utf8")).sequence, 5);
  f.policy.current_gates.component_publish_allowed = false;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  r = await fetch(url);
  assert.equal((await r.json()).reason, "catalog-publication-disabled", "Revocation is immediate");
  assert.equal(calls, 4);
});

test("Desktop Store refuses forged verifier output, symlinked envelopes and tampered watermark", async t => {
  const f = setup(t);
  f.policy.current_gates.component_publish_allowed = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  const store = join(f.userData, "Store");
  mkdirSync(store);
  const envelope = join(store, "catalog-envelope.json");
  writeFileSync(envelope, "signed-test-placeholder");
  let forged = { ...signedCatalogFixture(), authority: "install" }, calls = 0;
  const base = await serveVerifiedStore(t, f, (_binary, args, _options, cb) => {
    calls++;
    writeFileSync(args[args.indexOf("--out") + 1], JSON.stringify(forged));
    cb(null, Buffer.alloc(0));
  });
  const url = base + "/__ordax/native/store-catalog";
  assert.equal((await (await fetch(url)).json()).reason, "catalog-verification-failed");
  assert.equal(calls, 1);
  writeFileSync(join(store, "catalog-watermark.json"), "CORRUPTED");
  forged = signedCatalogFixture();
  assert.equal((await (await fetch(url)).json()).state, "unavailable");
  assert.equal(calls, 2);
  unlinkSync(envelope);
  symlinkSync(f.helper, envelope);
  assert.equal((await (await fetch(url)).json()).reason, "catalog-envelope-unavailable");
  assert.equal(calls, 2);
});


test("Windows Store watermark is an exclusive cross-host gate, with no stale-lock reclamation", async t => {
  const f = setup(t);
  f.policy.current_gates.component_publish_allowed = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  const store = join(f.userData, "Store");
  mkdirSync(store);
  writeFileSync(join(store, "catalog-envelope.json"), "SIGNED_TEST_ONLY");

  let signed = signedCatalogFixture(6, "6".repeat(64));
  const verify = (_binary, args, _options, cb) => {
    writeFileSync(args[args.indexOf("--out") + 1], JSON.stringify(signed));
    cb(null, Buffer.alloc(0));
  };
  // Separate middleware instances model independently launched Native hosts.
  const first = await serveVerifiedStore(t, f, verify);
  const second = await serveVerifiedStore(t, f, verify);
  const endpoint = "/__ordax/native/store-catalog";
  const watermarkPath = join(store, "catalog-watermark.json");
  const lockPath = watermarkPath + ".lock";

  // An orphaned or owned lock must not be removed by an HTTP request, and
  // neither host may fabricate a ready catalog or rewrite the watermark.
  mkdirSync(lockPath);
  for (const base of [first, second]) {
    const reply = await (await fetch(base + endpoint)).json();
    assert.equal(reply.state, "unavailable");
    assert.equal(reply.reason, "catalog-verification-failed");
  }
  assert.equal(existsSync(watermarkPath), false);
  assert.equal(existsSync(lockPath), true);
  rmSync(lockPath, { recursive: true });

  let reply = await (await fetch(first + endpoint)).json();
  assert.equal(reply.state, "ready");
  assert.equal(reply.sequence, 6);
  assert.equal(existsSync(lockPath), false, "Writer releases only its own lock");
  reply = await (await fetch(second + endpoint)).json();
  assert.equal(reply.state, "ready", "Second host reads the same durable watermark");
  assert.equal(JSON.parse(readFileSync(watermarkPath, "utf8")).sequence, 6);

  signed = signedCatalogFixture(5, "5".repeat(64));
  reply = await (await fetch(second + endpoint)).json();
  assert.equal(reply.state, "unavailable", "Second process cannot replay an earlier catalog");
  assert.equal(JSON.parse(readFileSync(watermarkPath, "utf8")).sequence, 6);
  assert.equal(existsSync(lockPath), false);
});


function remoteCatalogResponse(url, bytes, headers = {}) {
  return {
    status: 200, redirected: false, url,
    headers: new Headers(headers),
    body: new Response(Buffer.from(bytes)).body,
  };
}

test("Windows Store HTTPS origin policy rejects ambiguous, credentialed and non-TLS transports", () => {
  assert.equal(desktopStoreCatalogEnvelopeUrl(""), null, "No production URL is shipped");
  assert.equal(desktopStoreCatalogEnvelopeUrl("https://catalog.test"), "https://catalog.test/catalog-envelope.json");
  assert.equal(desktopStoreCatalogEnvelopeUrl("https://catalog.test/releases/v1/"),
    "https://catalog.test/releases/v1/catalog-envelope.json");
  for (const invalid of [
    null, 123, "http://catalog.test/", "https://user@catalog.test/",
    "https://catalog.test:0/", "https://catalog.test/%2e%2e/",
    "https://catalog.test/a/../b/", "https://catalog.test/?q=1",
    "https://catalog.test/#hash", "https://catalog.test\\bad",
    " https://catalog.test/", "https://catalog.test/with space/",
  ]) {
    assert.throws(() => desktopStoreCatalogEnvelopeUrl(invalid), TypeError);
  }
});

test("Malformed operator Store origin only disables the catalog, not other Native routes", async t => {
  const f = setup(t);
  f.policy.current_gates.component_publish_allowed = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  let network = 0, signing = 0;
  const base = await serveVerifiedStore(t, f, (_bin, _args, _opts, cb) => {
    signing++; cb(Error("Verifier must not run"));
  }, {
    catalogBaseOrigin: "https://catalog.test/%2e%2e/",
    fetchImpl: async () => { network++; throw Error("No network on malformed origin"); },
  });
  const catalog = await fetch(base + "/__ordax/native/store-catalog");
  assert.equal(catalog.status, 200);
  const snapshot = await catalog.json();
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.reason, "catalog-transport-invalid-origin");
  assert.equal(snapshot.authority, "none");
  assert.deepEqual(snapshot.entries, []);
  assert.equal(network, 0);
  assert.equal(signing, 0);
  const unrelated = await fetch(base + "/__ordax/native/another-route");
  assert.equal(unrelated.status, 418, "Middleware preserves unrelated Native routes");
});

test("Windows HTTPS Store fetch uses installed Go verifier and retains its signed LKG when offline", async t => {
  const f = setup(t);
  f.policy.current_gates.component_publish_allowed = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  const url = "https://catalog.test/releases/catalog-envelope.json";
  const payload = Buffer.from("TEST_SIGNED_REMOTE_ENVELOPE");
  const calls = [], verified = [];
  let online = true;
  const base = await serveVerifiedStore(t, f, (binary, args, options, cb) => {
    verified.push(args[args.indexOf("--envelope") + 1]);
    assert.equal(binary, f.helper, "Only the installer-pinned verifier may validate downloaded bytes");
    assert.equal(args[args.indexOf("--trust") + 1], f.installedAnchorPath);
    assert.deepEqual(readFileSync(args[args.indexOf("--envelope") + 1]), payload);
    writeFileSync(args[args.indexOf("--out") + 1],
      JSON.stringify(signedCatalogFixture(12, "1".repeat(64))));
    cb(null, Buffer.alloc(0));
  }, {
    catalogBaseOrigin: "https://catalog.test/releases/",
    fetchImpl: async (target, options) => {
      calls.push({ target, options });
      if (!online) throw Error("Network unavailable");
      return remoteCatalogResponse(url, payload, { "content-length": String(payload.length) });
    },
  });
  const endpoint = base + "/__ordax/native/store-catalog";
  let catalog = await (await fetch(endpoint)).json();
  assert.equal(catalog.state, "ready");
  assert.equal(catalog.sequence, 12);
  const store = join(f.userData, "Store");
  assert.deepEqual(readFileSync(join(store, "catalog-envelope.json")), payload);
  assert.equal(JSON.parse(readFileSync(join(store, "catalog-watermark.json"), "utf8")).sequence, 12);
  assert.equal(calls[0].target, url);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.headers["Accept-Encoding"], "identity");
  online = false;
  catalog = await (await fetch(endpoint)).json();
  assert.equal(catalog.state, "ready", "Offline must reverify the persisted signed LKG");
  assert.equal(verified.length, 2);
  f.policy.current_gates.component_publish_allowed = false;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  catalog = await (await fetch(endpoint)).json();
  assert.equal(catalog.reason, "catalog-publication-disabled");
  assert.equal(calls.length, 2, "Trust revocation must block remote requests before network access");
});

test("Windows signed Store remote acquisition refuses failed signatures without replacing accepted catalog", async t => {
  const f = setup(t);
  f.policy.current_gates.component_publish_allowed = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  const good = Buffer.from("SIGNED_LKG_TEST");
  const bad = Buffer.from("FORGED_REMOTE_CANDIDATE");
  let served = good, checked = 0;
  const base = await serveVerifiedStore(t, f, (_bin, args, _options, cb) => {
    checked++;
    const bytes = readFileSync(args[args.indexOf("--envelope") + 1]);
    if (!bytes.equals(good)) return cb(Error("Go signature verification failed"), Buffer.alloc(0));
    writeFileSync(args[args.indexOf("--out") + 1],
      JSON.stringify(signedCatalogFixture(6, "a".repeat(64))));
    cb(null, Buffer.alloc(0));
  }, {
    catalogBaseOrigin: "https://catalog.test/",
    fetchImpl: async url => remoteCatalogResponse(url, served),
  });
  const endpoint = base + "/__ordax/native/store-catalog";
  assert.equal((await (await fetch(endpoint)).json()).state, "ready");
  const envelope = join(f.userData, "Store", "catalog-envelope.json");
  const watermarkPath = join(f.userData, "Store", "catalog-watermark.json");
  served = bad;
  assert.equal((await (await fetch(endpoint)).json()).state, "ready",
    "Invalid remote signature must fall back to reverified LKG");
  assert.deepEqual(readFileSync(envelope), good);
  assert.equal(JSON.parse(readFileSync(watermarkPath, "utf8")).sequence, 6);
  assert.equal(checked, 3, "Remote signature failure does not skip local verification");
});

test("Windows Store HTTPS rejects redirects, compressed and oversized bodies before Go verification", async t => {
  const f = setup(t);
  f.policy.current_gates.component_publish_allowed = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  let verified = 0, scenario = 0;
  const failures = [
    url => ({ ...remoteCatalogResponse(url, "moved"), status: 302 }),
    url => ({ ...remoteCatalogResponse(url, "moved"), redirected: true }),
    url => remoteCatalogResponse(url + "other", "wrong destination"),
    url => remoteCatalogResponse(url, "compressed", { "content-encoding": "gzip" }),
    url => remoteCatalogResponse(url, "short", { "content-length": "1000" }),
    url => remoteCatalogResponse(url, Buffer.alloc(4 * 1024 * 1024 + 1)),
  ];
  const base = await serveVerifiedStore(t, f, (_bin, _args, _opt, cb) => {
    verified++; cb(null, Buffer.alloc(0));
  }, {
    catalogBaseOrigin: "https://catalog.test/",
    fetchImpl: async url => failures[scenario++](url),
  });
  const endpoint = base + "/__ordax/native/store-catalog";
  for (let n = 0; n < failures.length; n++) {
    const snapshot = await (await fetch(endpoint)).json();
    assert.equal(snapshot.state, "unavailable");
    assert.equal(snapshot.reason, "catalog-envelope-unavailable");
  }
  assert.equal(verified, 0, "Unacceptable HTTP bytes never reach the signing verifier");
  assert.equal(existsSync(join(f.userData, "Store", "catalog-envelope.json")), false);
});

test("Windows Store remote replay and equivocation preserve the last-known-good envelope", async t => {
  const f = setup(t);
  f.policy.current_gates.component_publish_allowed = true;
  writeFileSync(f.policyPath, JSON.stringify(f.policy));
  let remoteBytes = "SIGNED_SEQUENCE_7";
  const base = await serveVerifiedStore(t, f, (_bin, args, _options, cb) => {
    const bytes = readFileSync(args[args.indexOf("--envelope") + 1], "utf8");
    const identity = /^SIGNED_SEQUENCE_(6|7)(?:_DIFFERENT)?$/.exec(bytes);
    if (!identity) return cb(Error("Unverified bytes"));
    const sequence = Number(identity[1]);
    const digest = bytes.endsWith("_DIFFERENT") ? "8".repeat(64) : String(sequence).repeat(64);
    writeFileSync(args[args.indexOf("--out") + 1],
      JSON.stringify(signedCatalogFixture(sequence, digest)));
    cb(null, Buffer.alloc(0));
  }, {
    catalogBaseOrigin: "https://catalog.test/",
    fetchImpl: async url => remoteCatalogResponse(url, remoteBytes),
  });
  const endpoint = base + "/__ordax/native/store-catalog";
  assert.equal((await (await fetch(endpoint)).json()).sequence, 7);
  const envelope = join(f.userData, "Store", "catalog-envelope.json");
  const watermarkPath = join(f.userData, "Store", "catalog-watermark.json");
  assert.equal(readFileSync(envelope, "utf8"), "SIGNED_SEQUENCE_7");
  remoteBytes = "SIGNED_SEQUENCE_6";
  const rollback = await (await fetch(endpoint)).json();
  assert.equal(rollback.state, "ready", "Remote downgrade must not replace signed LKG");
  assert.equal(rollback.sequence, 7);
  assert.equal(readFileSync(envelope, "utf8"), "SIGNED_SEQUENCE_7");
  remoteBytes = "SIGNED_SEQUENCE_7_DIFFERENT";
  const equivocation = await (await fetch(endpoint)).json();
  assert.equal(equivocation.state, "ready", "Same sequence with another digest cannot replace LKG");
  assert.equal(equivocation.catalogSha256, "7".repeat(64));
  assert.equal(readFileSync(envelope, "utf8"), "SIGNED_SEQUENCE_7");
  assert.deepEqual(JSON.parse(readFileSync(watermarkPath, "utf8")), {
    schema: "ordax.store-catalog-watermark/1", sequence: 7, catalogSha256: "7".repeat(64),
  });
});


test("the shared Windows development preview registers a truthful Store route without a signer", async t => {
  const f = setup(t);
  const handlers = [];
  const plugin = nativeEmulatorPlugin(join(f.root, "preview-state"), { desktopHost: false });
  plugin.configureServer({ middlewares: { use(handler) { handlers.push(handler); } } });
  const server = createServer((req, res) => {
    let index = 0;
    const next = () => {
      const handler = handlers[index++];
      if (!handler) { res.writeHead(404); res.end(); return; }
      Promise.resolve(handler(req, res, next)).catch(() => {
        if (!res.headersSent) { res.writeHead(503); res.end(); }
      });
    };
    next();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const url = origin + "/__ordax/native/store-catalog";
  const response = await fetch(url);
  assert.equal(response.status, 200, "The preview must not silently fall through to emulator 503");
  const snapshot = await response.json();
  assert.equal(snapshot.schema, "ordax.verified-app-store-catalog/1");
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.authority, "none");
  assert.deepEqual(snapshot.entries, []);
  assert.equal(snapshot.reason, "catalog-trust-unavailable");
  assert.equal((await fetch(url + "?unsafe=1")).status, 400);
  assert.equal((await fetch(url, {method: "POST"})).status, 405);
  const existing = await fetch(origin + "/__ordax/native/first-run");
  assert.equal(existing.status, 200, "Existing Native routes stay owned by the emulator host");
});
