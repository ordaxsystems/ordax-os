import { assertProductVersionIdentity } from './product-version-governance.mjs';

export const PRODUCT_VERSION_SCHEMA = "ordax.product-version/1";

export const PRODUCT_VERSION = Object.freeze({
  schema: PRODUCT_VERSION_SCHEMA,
  semanticVersion: "0.1.0",
  displayVersion: "v0.1.0",
  displayName: "OrdaX Prototype v0.1.0",
  maturity: "prototype",
  stableRelease: false,
});

// Version identity is checked structurally, not only in agent instructions.
// The existing OS 0.1.0 prototype identity remains unchanged: this is NOT a
// silent release, downgrade or renaming of already materialized OS artifacts.
export const PRODUCT_VERSION_IDENTITY = assertProductVersionIdentity(PRODUCT_VERSION);

export function productVersionLabel() {
  return PRODUCT_VERSION.displayName;
}
