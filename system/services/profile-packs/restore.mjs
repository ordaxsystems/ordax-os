import {
  assertProfileActivationStatePort,
} from "../../contracts/profile-activation-state.mjs";
import {
  validateProfilePackCatalog,
} from "../../contracts/profile-pack.mjs";
import {
  validateProfilePackRestoreSnapshot,
} from "../../contracts/profile-pack-restore.mjs";
import {
  assertProfileProvisioningPort,
} from "../../contracts/profile-provisioning.mjs";

function identity(profile) {
  return `${profile.slug}@${profile.version}`;
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

function exactReceiptSet(left, right) {
  if (left.length !== right.length) return false;
  const a = [...left].map(componentIdentity).sort();
  const b = [...right].map(componentIdentity).sort();
  return a.every((entry, index) => entry === b[index]);
}

function entry(row, state, reason, profile = row.current?.profile ?? null) {
  return {
    schema: "ordax.profile-pack-restore-entry/1",
    spaceId: row.spaceId,
    spaceKind: row.spaceKind,
    state,
    reason,
    profile,
    activatedAt: row.current?.activatedAt ?? null,
  };
}

export function resolveProfilePackRestore({
  packs = [],
  provisioning,
  activationState,
} = {}) {
  const validatedPacks = validateProfilePackCatalog(packs);
  const provisioningPort = assertProfileProvisioningPort(provisioning);
  const activationPort = assertProfileActivationStatePort(activationState);
  const persisted = activationPort.getSnapshot();
  if (persisted.persistence !== "device") {
    throw new Error("Profile Pack restore requires device-persistent activation state");
  }
  const byIdentity = new Map(
    validatedPacks.map((pack) => [identity(pack), pack]),
  );

  const entries = persisted.spaces.map((row) => {
    if (row.current === null) {
      return entry(row, "inactive", null, null);
    }

    const pack = byIdentity.get(identity(row.current.profile));
    if (!pack) return entry(row, "disabled-safe", "manifest-missing");
    if (pack.spaceKind !== row.spaceKind) {
      return entry(row, "disabled-safe", "space-kind-mismatch");
    }
    if (pack.state === "retired") {
      return entry(row, "disabled-safe", "profile-retired");
    }
    if (pack.activation?.publiclyAvailable === false) {
      return entry(row, "disabled-safe", "manifest-blocks-activation");
    }
    if (pack.intelligence.externalProviderRequired === true) {
      return entry(row, "disabled-safe", "external-provider-required");
    }

    const plan = provisioningPort.get(pack.slug, pack.version);
    if (plan === null) {
      return entry(row, "disabled-safe", "provisioning-plan-missing");
    }
    if (plan.componentsSatisfied !== true || plan.requiredMissing.length !== 0) {
      return entry(row, "disabled-safe", "required-components-unavailable");
    }
    if (
      row.current.components.length > 0
      && plan.inventoryPersistence !== "device"
    ) {
      return entry(row, "disabled-safe", "device-inventory-unavailable");
    }
    if (!exactReceiptSet(row.current.components, plan.alreadyInstalled)) {
      return entry(row, "disabled-safe", "component-receipt-drift");
    }
    return entry(row, "resolved", null);
  });

  return validateProfilePackRestoreSnapshot({
    schema: "ordax.profile-pack-restore/1",
    persistence: "device",
    application: "metadata-only",
    bootCritical: false,
    entries,
  });
}
