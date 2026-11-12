import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveUpdateTransport } from "../system/services/update/transport-selection.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../docs/contracts/distribution-profiles.json", import.meta.url),
  "utf8",
));
const policy = contract.update_delivery_selection;

const route = (profile, requestedMethod, transactionIdle = true, source = policy) =>
  resolveUpdateTransport(source, { profile, requestedMethod, transactionIdle });

test("Development retains main Pull as sole enabled default", () => {
  const selected = route("owner-development");
  assert.equal(selected.state, "ready");
  assert.equal(selected.method, "git-main");
  assert.equal(selected.acquisitionOwner, "bootstrap/dev-base/ordax-pull");
  assert.equal(selected.requiresSignedRelease, false);
});

test("MVP retains signed-release default without Git dependency", () => {
  const selected = route("stable-mvp");
  assert.equal(selected.state, "ready");
  assert.equal(selected.method, "official-signed-release-channel");
  assert.equal(selected.acquisitionOwner, "bootstrap/release-acquisition");
  assert.equal(selected.requiresSignedRelease, true);
});

test("planned methods cannot be activated by user choice", () => {
  assert.deepEqual(route("owner-development", "official-signed-release-channel"),
    { state: "blocked", reason: "method-not-implemented" });
  assert.deepEqual(route("stable-mvp", "signed-exact-git"),
    { state: "blocked", reason: "method-not-implemented" });
  assert.deepEqual(route("stable-mvp", "git-main"),
    { state: "blocked", reason: "method-not-allowed" });
});

test("unknown input and active transactions fail closed", () => {
  assert.deepEqual(route("owner-development", "git-main", false),
    { state: "blocked", reason: "update-in-progress" });
  assert.deepEqual(route("other"), { state: "blocked", reason: "unknown-profile" });
  assert.deepEqual(route("stable-mvp", "unsigned"),
    { state: "blocked", reason: "unknown-method" });
});

test("corrupt policy, unsigned public channel or altered gates fail closed", () => {
  const altered = structuredClone(policy);
  altered.methods["official-signed-release-channel"].requires_signed_release = false;
  assert.equal(route("stable-mvp", undefined, true, altered).reason, "invalid-policy");
  altered.methods["official-signed-release-channel"].requires_signed_release = true;
  altered.rules.no_transport_fallback_on_verification_failure = false;
  assert.equal(route("owner-development", undefined, true, altered).reason, "invalid-policy");
  altered.rules.no_transport_fallback_on_verification_failure = true;
  altered.profiles["stable-mvp"].enabled.push("git-main");
  assert.equal(route("stable-mvp", undefined, true, altered).reason, "invalid-policy");

  const devDrift = structuredClone(policy);
  devDrift.profiles["owner-development"].enabled.push("signed-exact-git");
  assert.equal(route("owner-development", "signed-exact-git", true, devDrift).reason, "invalid-policy");
});

test("legacy distribution defaults match the selection SSOT", () => {
  for (const [profile, settings] of Object.entries(policy.profiles)) {
    assert.equal(settings.default, contract.profiles[profile].normal_update_transport);
  }
  assert.equal(policy.execution_owner, "system/supervisor");
  assert.equal(policy.rules.one_transport_per_transaction, true);
  assert.equal(policy.user_experience.implemented, false);
});
