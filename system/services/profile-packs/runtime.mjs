import {
  PROFILE_PACK_ACTIVATION_SCHEMA,
  PROFILE_PACK_RUNTIME_SCHEMA,
  validateProfilePackCatalog,
  validateProfilePackSpace,
} from "../../contracts/profile-pack.mjs";
import {
  assertProfileProvisioningPort,
} from "../../contracts/profile-provisioning.mjs";

function identity(slug, version) {
  return `${slug}@${version}`;
}

function activationSnapshot(pack, space, plan) {
  return Object.freeze({
    schema: PROFILE_PACK_ACTIVATION_SCHEMA,
    mode: "internal-proof",
    authority: "composition-explicit",
    persistence: "session-only",
    cloudMutationApplied: false,
    entitlementRequired: false,
    billingRequired: false,
    cloudRequired: false,
    space: Object.freeze({ id: space.id, kind: space.kind }),
    profile: Object.freeze({ slug: pack.slug, version: pack.version }),
    components: Object.freeze(
      plan.alreadyInstalled.map((component) => Object.freeze({
        id: component.id,
        kind: component.kind,
        version: component.version,
        sha256: component.sha256,
        receiptSha256: component.receiptSha256,
        installedAt: component.installedAt,
      })),
    ),
    pack,
  });
}

function stateSnapshot(spaceId, current, previous) {
  return Object.freeze({
    spaceId,
    current,
    previous,
  });
}

export function createProfilePackRuntime({ packs = [], provisioning } = {}) {
  const provisioningPort = assertProfileProvisioningPort(provisioning);
  const validated = validateProfilePackCatalog(packs);
  const catalog = new Map(validated.map((pack) => [identity(pack.slug, pack.version), pack]));
  const activationStates = new Map();
  const listeners = new Set();
  let disposed = false;

  const getPack = (slug, version) => {
    if (typeof slug !== "string" || !Number.isSafeInteger(version)) {
      throw new TypeError("Profile Pack lookup requires exact slug and version");
    }
    return catalog.get(identity(slug, version)) ?? null;
  };

  const snapshot = () => {
    const states = Object.freeze([...activationStates.values()]);
    return Object.freeze({
      schema: PROFILE_PACK_RUNTIME_SCHEMA,
      packs: Object.freeze([...catalog.values()]),
      activations: Object.freeze(
        states.flatMap((state) => state.current === null ? [] : [state.current]),
      ),
      activationStates: states,
    });
  };

  const publish = () => {
    if (disposed) return;
    const current = snapshot();
    for (const listener of [...listeners]) listener(current);
  };

  const boundedSpaceId = (spaceId) => {
    if (
      typeof spaceId !== "string"
      || spaceId.length < 1
      || spaceId.length > 160
      || spaceId.includes("\0")
    ) {
      throw new TypeError("Profile Pack operation requires a bounded Space id");
    }
    return spaceId;
  };

  return Object.freeze({
    schema: PROFILE_PACK_RUNTIME_SCHEMA,
    getSnapshot() {
      return snapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Profile Pack listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    list() {
      if (disposed) throw new Error("Profile Pack runtime is disposed");
      return Object.freeze([...catalog.values()]);
    },
    get(slug, version) {
      if (disposed) throw new Error("Profile Pack runtime is disposed");
      return getPack(slug, version);
    },
    activate({ slug, version, space, mode } = {}) {
      if (disposed) throw new Error("Profile Pack runtime is disposed");
      if (mode !== "internal-proof") {
        throw new Error("Profile Pack activation is limited to explicit internal proof");
      }
      const pack = getPack(slug, version);
      if (pack === null) throw new Error("Requested Profile Pack is not in the local catalog");
      if (pack.state !== "draft") {
        throw new Error("Internal proof accepts only draft Profile Packs");
      }
      if (pack.activation?.publiclyAvailable === false) {
        throw new Error("Profile Pack explicitly blocks activation in its manifest");
      }
      if (pack.intelligence.externalProviderRequired) {
        throw new Error("Internal Profile Pack proof cannot require external model egress");
      }

      const targetSpace = validateProfilePackSpace(space);
      if (targetSpace.kind !== pack.spaceKind) {
        throw new Error("Profile Pack is incompatible with the selected Space kind");
      }

      const plan = provisioningPort.get(slug, version);
      if (plan === null) {
        throw new Error("Profile Pack has no provisioning plan");
      }
      if (plan.componentsSatisfied !== true || plan.requiredMissing.length !== 0) {
        throw new Error("Profile Pack required components are not installed");
      }

      const activation = activationSnapshot(pack, targetSpace, plan);
      const existing = activationStates.get(targetSpace.id);
      activationStates.set(
        targetSpace.id,
        stateSnapshot(
          targetSpace.id,
          activation,
          existing?.current ?? null,
        ),
      );
      publish();
      return activation;
    },
    deactivate(spaceId) {
      if (disposed) throw new Error("Profile Pack runtime is disposed");
      const id = boundedSpaceId(spaceId);
      const existing = activationStates.get(id);
      if (!existing || existing.current === null) return false;
      activationStates.set(
        id,
        stateSnapshot(id, null, existing.current),
      );
      publish();
      return true;
    },
    rollback(spaceId) {
      if (disposed) throw new Error("Profile Pack runtime is disposed");
      const id = boundedSpaceId(spaceId);
      const existing = activationStates.get(id);
      if (!existing || existing.previous === null) return false;
      activationStates.set(
        id,
        stateSnapshot(id, existing.previous, existing.current),
      );
      publish();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activationStates.clear();
      listeners.clear();
    },
  });
}
