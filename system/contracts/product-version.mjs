export const PRODUCT_VERSION_SCHEMA = "ordax.product-version/1";

export const PRODUCT_VERSION = Object.freeze({
  schema: PRODUCT_VERSION_SCHEMA,
  semanticVersion: "0.1.1-alpha.1",
  displayVersion: "v0.1.1-alpha.1",
  displayName: "OrdaX Prototype v0.1.1-alpha.1",
  maturity: "prototype",
  stableRelease: false,
});

export function productVersionLabel() {
  return PRODUCT_VERSION.displayName;
}
