import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/assets/site.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("    async readSubscription(signal) {");
const end = source.indexOf("\n    },\n    // Read-only account data", start);
assert.ok(start >= 0 && end > start, "canonical Account subscription port missing");
const body = source.slice(start + "    async readSubscription(signal) {".length, end);
function harness(session, loadJson) {
  return new Function("loadJson", "initial", "let sessionView=initial;" +
    "return { read: async function(signal) {" + body +
    "}, change(next) { sessionView=next; } };")(loadJson, session);
}
const absent = {
  schema: "ordax.account-subscription-view/1", source: "server",
  status: "unverified", planId: null, lifecycle: null, currentPeriodEnd: null,
  cancellationScheduled: false, billing: "unavailable", entitlements: "separate-authority",
};
const active = {
  ...absent, status: "verified", planId: "personal", lifecycle: "active",
  currentPeriodEnd: "2026-12-01T00:00:00.000Z", billing: "separate-authority",
};

test("Account reads exact same-origin subscription without sending prices or buyer ids", async () => {
  const calls = [];
  const h = harness({status:"authenticated"}, async (...args) => {
    calls.push(args); return active;
  });
  assert.deepEqual(await h.read(),active);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/subscription");
  assert.deepEqual(calls[0][2],{maxBytes:4096});
});
test("missing subscription is not inferred as Free or zero billing", async () => {
  const v = await harness({status:"authenticated"},async()=>absent).read();
  assert.equal(v.status,"unverified");
  assert.equal(v.planId,null);
  assert.equal(v.billing,"unavailable");
});
test("unauthenticated sessions may not issue subscription reads", async () => {
  let invoked = false;
  const h = harness({status:"anonymous"}, async()=>{invoked=true;return active;});
  await assert.rejects(h.read(),/public-account-session-required/);
  assert.equal(invoked,false);
});
test("invalid or optimistic commercial responses fail closed", async () => {
  for (const bad of [
    {...active,source:"browser"}, {...active,planId:"enterprise"},
    {...active,lifecycle:"paid"}, {...active,currentPeriodEnd:"not-a-date"},
    {...active,extra:"price"}, {...absent,planId:"free"},
    {...absent,billing:"separate-authority"}, {...absent,cancellationScheduled:true},
    {...active,cancellationScheduled:"false"}, {...active,entitlements:"granted"},
  ]) {
    await assert.rejects(harness({status:"authenticated"},async()=>bad).read(),
      /account-subscription-view-invalid/);
  }
});
test("superseded session cannot receive subscription read", async () => {
  let resolve;
  const pending = new Promise(r=>{resolve=r;});
  const h = harness({status:"authenticated"},()=>pending);
  const p = h.read();
  h.change({status:"authenticated"});
  resolve(active);
  await assert.rejects(p,/public-account-session-changed/);
});
test("provider outage never degrades to an inferred Free subscription", async () => {
  const h = harness({status:"authenticated"},async()=>{throw Error("backend unavailable");});
  await assert.rejects(h.read(),/backend unavailable/);
});
