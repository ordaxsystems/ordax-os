// Thin Windows coordinator for the EXISTING installed Go release/2 writer.
// Does not sign, choose versions, record health, promote, rollback or activate.
// Only a durable Go pending-health generation can yield an accepted request.
import { isAbsolute, relative, sep } from "node:path";

function fields(stdout, keys, command) {
  const values = new Map();
  for (const line of stdout.trim().split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) throw Error(command + " returned a malformed Go receipt");
    const key = line.slice(0, at);
    if (!keys.includes(key) || values.has(key))
      throw Error(command + " returned noncanonical Go fields");
    values.set(key, line.slice(at + 1));
  }
  if (values.size !== keys.length) throw Error(command + " Go receipt is incomplete");
  return Object.fromEntries(values);
}

function currentStatus(stdout, plan) {
  const state = JSON.parse(stdout);
  const expected = plan.expectedActivation;
  if (!state || Array.isArray(state)
    || state.$schema !== "prototype-ordax.runtime-component-activation-state/1"
    || state.component_id !== plan.request.appId
    || state.revision !== expected.revision || state.pending !== null
    || (expected.source === "slot"
      ? state.current?.version !== expected.version
        || state.current?.source_commit !== expected.sourceCommit
      : state.current !== null
        || Boolean(state.user_removed) !== (expected.source === "removed"))) {
    throw Error("Go activation generation differs from signed Store plan");
  }
  if (plan.request.operation === "install" && expected.source === "slot"
    || plan.request.operation === "update" && expected.source !== "slot")
    throw Error("Store lifecycle operation does not match Go current state");
}

function exactIdentity(values, plan) {
  const candidate = plan.candidate;
  if (values.COMPONENT_ID !== plan.request.appId
    || values.COMPONENT_VERSION !== candidate.version
    || values.SOURCE_COMMIT !== candidate.sourceCommit) {
    throw Error("Go-verified signed release identity drifted");
  }
}

const VERIFIED_KEYS = Object.freeze([
  "RUNTIME_COMPONENT_RELEASE_V2_VERIFIED", "COMPONENT_ID",
  "COMPONENT_VERSION", "SOURCE_COMMIT", "PENDING_HEALTH_REQUIRED",
  "DIRECT_ACTIVATION_ALLOWED",
]);
const STAGED_KEYS = Object.freeze([
  "RUNTIME_COMPONENT_RELEASE_V2_STAGED", "COMPONENT_ID",
  "COMPONENT_VERSION", "SOURCE_COMMIT", "SLOT", "SLOT_CHANGED",
  "PENDING_HEALTH_REQUIRED", "ACTIVATED",
]);
const SLOT_KEYS = Object.freeze([
  "RUNTIME_COMPONENT_RELEASE_V2_SLOT_VERIFIED", "COMPONENT_ID",
  "COMPONENT_VERSION", "SOURCE_COMMIT", "DIRECT_ACTIVATION_ALLOWED",
]);
const ARMED_KEYS = Object.freeze([
  "RUNTIME_COMPONENT_PENDING_ARMED", "COMPONENT_ID", "REVISION",
  "PENDING_VERSION", "PENDING_SOURCE_COMMIT", "PENDING_HEALTH",
  "RUNTIME_ACTIVATED",
]);

export async function stageDesktopStorePending({ plan, artifacts, slotRoot, trust, runGo }) {
  if (!plan?.candidate || !["install", "update"].includes(plan.request?.operation)
    || typeof runGo !== "function" || typeof trust !== "string"
    || typeof slotRoot !== "string") throw Error("Canonical Store stage inputs missing");
  const appId = plan.request.appId, candidate = plan.candidate;
  const statusArgs = ["status", "--component", appId, "--root", slotRoot];
  currentStatus(await runGo(statusArgs), plan);

  const verified = fields(await runGo([
    "verify-envelope-v2", "--envelope", artifacts.componentEnvelope,
    "--trust", trust, "--compatibility", artifacts.compatibility,
  ]), VERIFIED_KEYS, "verify-envelope-v2");
  exactIdentity(verified, plan);
  if (verified.RUNTIME_COMPONENT_RELEASE_V2_VERIFIED !== "YES"
    || verified.PENDING_HEALTH_REQUIRED !== "YES"
    || verified.DIRECT_ACTIVATION_ALLOWED !== "NO")
    throw Error("Go envelope verification did not require pending health");

  const staged = fields(await runGo([
    "stage-v2", "--envelope", artifacts.componentEnvelope, "--trust", trust,
    "--package", artifacts.package, "--compatibility", artifacts.compatibility,
    "--root", slotRoot,
  ]), STAGED_KEYS, "stage-v2");
  exactIdentity(staged, plan);
  if (staged.RUNTIME_COMPONENT_RELEASE_V2_STAGED !== "YES"
    || staged.PENDING_HEALTH_REQUIRED !== "YES" || staged.ACTIVATED !== "NO"
    || !["true", "false"].includes(staged.SLOT_CHANGED))
    throw Error("Go staging did not preserve pending-health boundary");
  const slot = staged.SLOT;
  if (!isAbsolute(slot)) throw Error("Go returned noncanonical staged slot");
  const rest = relative(slotRoot, slot);
  if (!rest || rest === ".." || rest.startsWith(".." + sep) || isAbsolute(rest))
    throw Error("Go staged slot escapes canonical component root");

  const slotVerified = fields(await runGo([
    "verify-slot-v2", "--slot", slot, "--trust", trust,
  ]), SLOT_KEYS, "verify-slot-v2");
  exactIdentity(slotVerified, plan);
  if (slotVerified.RUNTIME_COMPONENT_RELEASE_V2_SLOT_VERIFIED !== "YES"
    || slotVerified.DIRECT_ACTIVATION_ALLOWED !== "NO")
    throw Error("Go staged slot verification did not prohibit activation");

  const armed = fields(await runGo([
    "arm-pending", "--slot", slot, "--trust", trust, "--root", slotRoot,
    "--expected-revision", String(plan.expectedActivation.revision),
  ]), ARMED_KEYS, "arm-pending");
  const revision = plan.expectedActivation.revision + 1;
  if (armed.RUNTIME_COMPONENT_PENDING_ARMED !== "YES"
    || armed.COMPONENT_ID !== appId || armed.REVISION !== String(revision)
    || armed.PENDING_VERSION !== candidate.version
    || armed.PENDING_SOURCE_COMMIT !== candidate.sourceCommit
    || armed.PENDING_HEALTH !== "unknown" || armed.RUNTIME_ACTIVATED !== "NO")
    throw Error("Go pending generation receipt is invalid");

  // A CLI receipt alone cannot prove a durable activation-state transaction.
  const after = JSON.parse(await runGo(statusArgs));
  if (!after || Array.isArray(after)
    || after.$schema !== "prototype-ordax.runtime-component-activation-state/1"
    || after.component_id !== appId || after.revision !== revision
    || after.pending?.version !== candidate.version
    || after.pending?.source_commit !== candidate.sourceCommit
    || after.pending_health !== "unknown"
    || (plan.expectedActivation.source === "slot"
      ? after.current?.version !== plan.expectedActivation.version
        || after.current?.source_commit !== plan.expectedActivation.sourceCommit
      : after.current !== null)) {
    throw Error("Go pending-health generation was not durably observed");
  }
  return Object.freeze({ revision, state: "pending-health" });
}
