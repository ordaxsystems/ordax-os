import {
  assertProfileComponentInventoryPort,
} from "../../contracts/profile-component-inventory.mjs";
import {
  PROFILE_PROVISIONING_SCHEMA,
  planProfileProvisioning,
  validateProfileDistribution,
} from "../../contracts/profile-provisioning.mjs";

function identity(distribution) {
  return `${distribution.profile.slug}@${distribution.profile.version}`;
}

export function createProfileProvisioningRuntime({
  distributions = [],
  inventory,
  readNetworkAvailable = () => false,
} = {}) {
  if (!Array.isArray(distributions) || distributions.length > 128) {
    throw new TypeError("Profile provisioning runtime requires a bounded distribution catalog");
  }
  const inventoryPort = assertProfileComponentInventoryPort(inventory);
  if (typeof readNetworkAvailable !== "function") {
    throw new TypeError("Profile provisioning runtime requires readNetworkAvailable()");
  }

  const entries = distributions.map((entry, index) =>
    validateProfileDistribution(entry, `Profile distribution[${index}]`));
  const byIdentity = new Map();
  for (const entry of entries) {
    const key = identity(entry);
    if (byIdentity.has(key)) {
      throw new TypeError(`Duplicate Profile distribution ${key}`);
    }
    byIdentity.set(key, entry);
  }

  let disposed = false;

  const requireActive = () => {
    if (disposed) throw new Error("Profile provisioning runtime is disposed");
  };

  const environment = () => {
    const installedInventory = inventoryPort.getSnapshot();
    const networkAvailable = readNetworkAvailable();
    if (typeof networkAvailable !== "boolean") {
      throw new TypeError("Profile network reader must return boolean");
    }
    return { installedInventory, networkAvailable };
  };

  return Object.freeze({
    schema: PROFILE_PROVISIONING_SCHEMA,
    list() {
      requireActive();
      const { installedInventory, networkAvailable } = environment();
      return Object.freeze(entries.map((distribution) =>
        planProfileProvisioning({
          distribution,
          installedInventory,
          networkAvailable,
        })));
    },
    get(slug, version) {
      requireActive();
      if (typeof slug !== "string" || !Number.isSafeInteger(version)) {
        throw new TypeError("Profile provisioning lookup requires exact slug and version");
      }
      const distribution = byIdentity.get(`${slug}@${version}`);
      if (!distribution) return null;
      const { installedInventory, networkAvailable } = environment();
      return planProfileProvisioning({
        distribution,
        installedInventory,
        networkAvailable,
      });
    },
    refresh() {
      requireActive();
      return this.list();
    },
    dispose() {
      disposed = true;
    },
  });
}
