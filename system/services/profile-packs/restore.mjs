import {
  PROFILE_PACK_ACTIVATION_SCHEMA,
  validateProfilePackCatalog,
} from "../../contracts/profile-pack.mjs";
import {
  assertProfileActivationStatePort,
} from "../../contracts/profile-activation-state.mjs";
import {
  assertProfileProvisioningPort,
} from "../../contracts/profile-provisioning.mjs";

export const PROFILE_PACK_RESTORE_SCHEMA = "ordax.profile-pack-restore/1";

function identity(slug, version) {
  return `${slug}@${version}`;
}

function componentIdentity(component) {
  return [
    component.id,
    component.kind,
    component.version,
    component.sha256,
    component.receiptSha256,
    component.installedAt,
  ].join("@");
}

function componentSet(components) {
  return [...components].map(componentIdentity).sort();
}

function sameComponents(left, right) {
  const a = componentSet(left);
  const b = componentSet(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function disabled(space, current, reason) {
  return Object.freeze({
    spaceId: space.spaceId,
    spaceKind: space.spaceKind,
    state: "disabled-safe",
    reason,
    profile: current?.profile ?? null,
    activation: null,
  });
}

function restoredActivation(pack, space, current) {
  return Object.freeze({
    schema: PROFILE_PACK_ACTIVATION_SCHEMA,
    mode: "internal-proof",
    authority: "native-state-verified",
    persistence: "device-restored",
    cloudMutationApplied: false,
    entitlementRequired: false,
    billingRequired: false,
    cloudRequired: false,
    space: Object.freeze({ id: space.spaceId, kind: space.spaceKind }),
    profile: current.profile,
    components: current.components,
    pack,
  });
}

export function restoreProfilePackState({
  packs = [],
  provisioning,
  activationState,
} = {}) {
  const provisioningPort = assertProfileProvisioningPort(provisioning);
  const statePort = assertProfileActivationStatePort(activationState);
  const validatedPacks = validateProfilePackCatalog(packs);
  const catalog = new Map(
    validatedPacks.map((pack) => [identity(pack.slug, pack.version), pack]),
  );
  const persisted = statePort.getSnapshot();

  const entries = persisted.spaces.map((space) => {
    if (space.current === null) {
      return Object.freeze({
        spaceId: space.spaceId,
        spaceKind: space.spaceKind,
        state: "inactive",
        reason: null,
        profile: null,
        activation: null,
      });
    }

    const current = space.current;
    const pack = catalog.get(identity(current.profile.slug, current.profile.version));
    if (!pack) {
      return disabled(space, current, "profile-manifest-not-found");
    }
    if (pack.state !== "draft") {
      return disabled(space, current, "profile-state-not-internal-proof");
    }
    if (pack.activation?.publiclyAvailable === false) {
      return disabled(space, current, "profile-manifest-blocks-activation");
    }
    if (pack.intelligence.externalProviderRequired) {
      return disabled(space, current, "external-provider-required");
    }
    if (pack.spaceKind !== space.spaceKind) {
      return disabled(space, current, "space-kind-mismatch");
    }

    const plan = provisioningPort.get(pack.slug, pack.version);
    if (plan === null) {
      return disabled(space, current, "provisioning-plan-not-found");
    }
    if (plan.componentsSatisfied !== true || plan.requiredMissing.length !== 0) {
      return disabled(space, current, "required-components-not-installed");
    }
    if (!sameComponents(current.components, plan.alreadyInstalled)) {
      return disabled(space, current, "component-receipts-drifted");
    }

    return Object.freeze({
      spaceId: space.spaceId,
      spaceKind: space.spaceKind,
      state: "restored",
      reason: null,
      profile: current.profile,
      activation: restoredActivation(pack, space, current),
    });
  });

  return Object.freeze({
    schema: PROFILE_PACK_RESTORE_SCHEMA,
    persistence: persisted.persistence,
    sourceRevision: persisted.revision,
    bootCritical: false,
    entries: Object.freeze(entries),
  });
}
