// OS-owned, read-only Product MCP lifecycle observation for Windows Desktop.
// Discovery is never execution authority: only an attested, supervised agent
// may eventually publish capabilities. No installation or launch occurs here.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCK = "system/services/device-agent/studio-runtime-source-lock.json";
const TRUST = "docs/contracts/runtime-component-trust-policy.json";
const SOURCE = "https://github.com/ordaxsystems/ordax-runtime";
const SHA = /^[0-9a-f]{40}$/;

function boundedDocument(root, relative) {
  const raw = readFileSync(join(root, relative));
  if (raw.length < 2 || raw.length > 65536) throw Error("Invalid OS policy size");
  return JSON.parse(raw.toString("utf8"));
}

export function readDesktopProductRuntimeStatus(root) {
  const snapshot = {
    schema: "ordax.product-runtime-supervision/1",
    platform: "windows",
    componentId: "product-runtime",
    sourcePolicyOnly: true,
    state: "blocked",
    ready: false,
    runtimeStarted: false,
    centralSessionAttested: false,
    capabilityDigest: null,
    blockers: [],
  };
  try {
    if (typeof root !== "string" || !root) throw Error("Invalid OS source root");
    const lock = boundedDocument(root, LOCK);
    const trust = boundedDocument(root, TRUST);
    if (lock.$schema !== "prototype-ordax.studio-runtime-source-lock/1" ||
        lock.source?.repository !== SOURCE || !SHA.test(lock.source?.commit ?? "") ||
        lock.runtime?.native_executable_name !== "ordax-product-agent" ||
        trust.$schema !== "prototype-ordax.runtime-component-trust-policy/1" ||
        trust.trust_domain !== "runtime-components" ||
        trust.key_id !== "ordax-runtime-components-v1") {
      throw Error("Canonical Runtime identity or trust policy is invalid");
    }
    const blockers = snapshot.blockers;
    if (trust.current_gates?.canonical_component_trust_anchor_pinned !== true ||
        trust.public_anchor?.pinned !== true)
      blockers.push("canonical-component-trust-unpinned");
    if (lock.distribution?.signed_runtime_slot_available !== true ||
        lock.distribution?.runtime_artifact_claimed !== true ||
        lock.distribution?.source_binding_only !== false)
      blockers.push("signed-runtime-distribution-unavailable");
    if (lock.activation?.dispatch_enabled !== true)
      blockers.push("runtime-dispatch-disabled");
    if (lock.activation?.attestation_enabled !== true)
      blockers.push("central-session-attestation-disabled");
    // A Linux/musl executable is not a Windows executable. A Windows signed
    // runtime requires its own target-specific provenance from ordax-runtime.
    if (lock.candidate_evidence?.platform !== "windows-amd64")
      blockers.push("windows-runtime-artifact-not-proven");
    // Static repository documents are NEVER a liveness or action receipt.
    // Until the OS host supervises an attested process, it cannot be ready.
    blockers.push("supervised-runtime-health-not-proven");
  } catch {
    snapshot.blockers = ["canonical-runtime-policy-unavailable"];
  }
  return snapshot;
}
