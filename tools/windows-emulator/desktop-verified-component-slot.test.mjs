import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesktopVerifiedComponentSlotMiddleware } from "../../system/adapters/desktop/verified-component-slot-host.mjs";

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
    cb(null, Buffer.from("RUNTIME_COMPONENT_CURRENT_RESOLVED=YES\\n"
      + "COMPONENT_ID=assistant\\nREVISION=0\\nSOURCE=ABSENT\\n"
      + "RUNTIME_SERVED_FROM_SLOT=NO\\n".replaceAll("\\n", "\n")));
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
