// One public-trust authority shared by Desktop signed-slot and Store readers.
// The immutable Electron installer supplies the Go verifier and trust anchor;
// ordax-pull may change policies but cannot introduce a different signing root.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

const SHA256 = /^[0-9a-f]{64}$/;
function regular(path, maxBytes) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink()
      && stat.size > 0 && stat.size <= maxBytes;
  } catch { return false; }
}
export function withinPinnedRoot(root, path) {
  if (!isAbsolute(path)) return false;
  const rest = relative(root, path);
  return rest.length > 0 && rest !== ".." && !rest.startsWith(".." + sep)
    && !isAbsolute(rest);
}
export function readDesktopPinnedComponentTrust(systemRoot, verifierRoot) {
  if (typeof systemRoot !== "string" || !isAbsolute(systemRoot)
    || typeof verifierRoot !== "string" || !isAbsolute(verifierRoot)) return null;
  const policyPath = join(systemRoot, "docs", "contracts", "runtime-component-trust-policy.json");
  const packagePolicyPath = join(systemRoot, "docs", "contracts", "runtime-component-package.json");
  const trust = join(verifierRoot, "system", "trust", "runtime-components-ed25519.json");
  const activeTrust = join(systemRoot, "system", "trust", "runtime-components-ed25519.json");
  const helper = join(verifierRoot, "tools", "runtime-component-channel", "ordax-runtime-component-channel.exe");
  if (!regular(policyPath, 64 * 1024) || !regular(packagePolicyPath, 64 * 1024)
    || !regular(trust, 16 * 1024) || !regular(activeTrust, 16 * 1024)
    || !regular(helper, 32 * 1024 * 1024)) return null;
  try {
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    const packagePolicy = JSON.parse(readFileSync(packagePolicyPath, "utf8"));
    if (policy["$schema"] !== "prototype-ordax.runtime-component-trust-policy/1"
      || policy.status !== "canonical-public-trust-pinned"
      || policy.trust_domain !== "runtime-components"
      || policy.key_id !== "ordax-runtime-components-v1"
      || policy.public_anchor?.repository_path !== "system/trust/runtime-components-ed25519.json"
      || policy.public_anchor?.pinned !== true
      || policy.current_gates?.canonical_component_trust_anchor_pinned !== true
      || packagePolicy["$schema"] !== "prototype-ordax.runtime-component-package-policy/1"
      || packagePolicy.canonical_component_trust_anchor_pinned !== true
      || !SHA256.test(policy.public_anchor?.sha256)) return null;
    const bytes = readFileSync(trust);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== policy.public_anchor.sha256
      || !readFileSync(activeTrust).equals(bytes)) return null;
    const anchor = JSON.parse(bytes.toString("utf8"));
    if (anchor["$schema"] !== "prototype-ordax.runtime-component-trust/1"
      || anchor.key_id !== policy.key_id
      || typeof anchor.public_key_base64 !== "string"
      || !/^[A-Za-z0-9+/]{43}=$/.test(anchor.public_key_base64)
      || Buffer.from(anchor.public_key_base64, "base64").length !== 32) return null;
    if (lstatSync(verifierRoot).isSymbolicLink()
      || !withinPinnedRoot(realpathSync(verifierRoot), realpathSync(helper))
      || !withinPinnedRoot(realpathSync(verifierRoot), realpathSync(trust))
      || !withinPinnedRoot(realpathSync(systemRoot), realpathSync(activeTrust))) return null;
    return Object.freeze({
      helper, trust, trustSha256: digest,
      publicationAuthorized: policy.current_gates?.component_publish_allowed === true,
    });
  } catch { return null; }
}
