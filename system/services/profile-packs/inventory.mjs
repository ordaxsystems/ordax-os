import {
  PROFILE_COMPONENT_INVENTORY_PORT_SCHEMA,
  createEmptyProfileComponentInventory,
} from "../../contracts/profile-component-inventory.mjs";

export function createSessionProfileComponentInventory() {
  const snapshot = createEmptyProfileComponentInventory();
  return Object.freeze({
    schema: PROFILE_COMPONENT_INVENTORY_PORT_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    async refresh() {
      return snapshot;
    },
    dispose() {},
  });
}
