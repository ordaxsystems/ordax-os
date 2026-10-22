/**
 * Pure update-transport routing for the existing OrdaX Supervisor.
 *
 * The canonical policy is docs/contracts/distribution-profiles.json,
 * update_delivery_selection. This function does not download, trust, activate,
 * change preferences or fall back between transports. Activation and rollback
 * remain entirely with the existing Supervisor/Release Agent/Base owner.
 */

const METHODS = new Set([
  "git-main",
  "official-signed-release-channel",
  "signed-exact-git",
]);

function blocked(reason) {
  return Object.freeze({ state: "blocked", reason });
}

function validList(value) {
  return Array.isArray(value)
    && value.every((method) => METHODS.has(method))
    && new Set(value).size === value.length;
}

function validPolicy(policy) {
  if (!policy || typeof policy !== "object"
      || policy.$schema !== "ordax.update-delivery-selection/1"
      || policy.execution_owner !== "system/supervisor"
      || !policy.rules || !policy.methods || !policy.profiles) return false;

  const r = policy.rules;
  if (r.one_transport_per_transaction !== true
      || r.switch_only_when_idle !== true
      || r.no_transport_fallback_on_verification_failure !== true
      || r.signed_release_required_for_all_public_updates !== true
      || r.base_ab_activation_is_separate !== true
      || r.known_good_boot_must_remain_offline !== true
      || r.do_not_change_current_until_health_gate !== true
      || r.user_consent_does_not_override_integrity !== true) return false;

  if (policy.methods["git-main"]?.public_allowed !== false
      || policy.methods["git-main"]?.requires_signed_release !== false
      || policy.methods["official-signed-release-channel"]?.requires_signed_release !== true
      || policy.methods["official-signed-release-channel"]?.public_allowed !== true
      || policy.methods["signed-exact-git"]?.requires_signed_release !== true
      || policy.methods["signed-exact-git"]?.exact_signed_source_commit_required !== true
      || policy.methods["signed-exact-git"]?.public_allowed !== true) return false;

  for (const profile of ["owner-development", "stable-mvp"]) {
    const item = policy.profiles[profile];
    if (!item || !validList(item.enabled) || !validList(item.gated)
        || item.enabled.some((method) => item.gated.includes(method))
        || !item.enabled.includes(item.default)) return false;
  }
  const dev = policy.profiles["owner-development"];
  const stable = policy.profiles["stable-mvp"];
  return dev.default === "git-main"
    && dev.enabled.includes("git-main")
    && !dev.enabled.includes("official-signed-release-channel")
    && dev.gated.includes("official-signed-release-channel")
    && stable.default === "official-signed-release-channel"
    && stable.enabled.length === 1
    && stable.enabled[0] === "official-signed-release-channel"
    && stable.gated.includes("signed-exact-git")
    && !stable.enabled.includes("git-main")
    && policy.runtime_method_switch_implemented === false
    && policy.stable_signed_git_transport_implemented === false
    && policy.owner_signed_release_transport_implemented === false;
}

/**
 * @returns {{state:"ready",method:string,acquisitionOwner:string,
 *   requiresSignedRelease:boolean,exactSignedSourceCommitRequired:boolean}
 *   | {state:"blocked",reason:string}}
 * "ready" means ROUTE ELIGIBLE, never "verified" or "installed".
 */
export function resolveUpdateTransport(policy, {
  profile,
  requestedMethod,
  transactionIdle = false,
} = {}) {
  if (!validPolicy(policy)) return blocked("invalid-policy");
  const current = policy.profiles[profile];
  if (!current) return blocked("unknown-profile");

  const method = requestedMethod ?? current.default;
  if (typeof method !== "string" || !METHODS.has(method)) {
    return blocked("unknown-method");
  }
  if (current.gated.includes(method)) return blocked("method-not-implemented");
  if (!current.enabled.includes(method)) return blocked("method-not-allowed");
  if (transactionIdle !== true) return blocked("update-in-progress");

  const descriptor = policy.methods[method];
  if (!descriptor || typeof descriptor.acquisition_owner !== "string"
      || descriptor.acquisition_owner.length === 0) {
    return blocked("invalid-method-descriptor");
  }
  if (profile === "stable-mvp"
      && (!descriptor.public_allowed || !descriptor.requires_signed_release)) {
    return blocked("unsigned-public-update");
  }
  return Object.freeze({
    state: "ready",
    method,
    acquisitionOwner: descriptor.acquisition_owner,
    requiresSignedRelease: descriptor.requires_signed_release === true,
    exactSignedSourceCommitRequired:
      descriptor.exact_signed_source_commit_required === true,
  });
}
