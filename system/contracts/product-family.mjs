import { PRODUCT_VERSION } from "./product-version.mjs";

export const PRODUCT_FAMILY_SCHEMA = "ordax.product-family/1";

// One shared product source and account. These are presentation identities,
// not new capability IDs, boot modes, deployment authorities or repositories.
export const PRODUCT_FAMILY_MODES = Object.freeze([
  Object.freeze({
    modeId: "web",
    productId: "ordax-web",
    displayName: "OrdaX Web",
    versionOwner: "web-deployment",
    executionKind: "browser",
  }),
  Object.freeze({
    modeId: "mobile",
    productId: "ordax-mobile",
    displayName: "OrdaX Mobile",
    versionOwner: "mobile-app-package",
    executionKind: "installed-client",
  }),
  Object.freeze({
    modeId: "desktop",
    productId: "ordax-desktop",
    displayName: "OrdaX Desktop",
    versionOwner: "desktop-app-package",
    executionKind: "installed-client",
  }),
  Object.freeze({
    modeId: "usb",
    productId: "ordax-os",
    displayName: "OrdaX OS — USB",
    versionOwner: "ordax-os",
    executionKind: "bootable-os",
  }),
  Object.freeze({
    modeId: "native-disk",
    productId: "ordax-os",
    displayName: "OrdaX OS — Nativo",
    versionOwner: "ordax-os",
    executionKind: "bootable-os",
  }),
]);

export function productFamilyMode(modeId) {
  const mode = PRODUCT_FAMILY_MODES.find((entry) => entry.modeId === modeId);
  if (!mode) throw new RangeError(`Unknown OrdaX product mode: ${String(modeId)}`);
  return mode;
}

// Only the OS has an assigned shared prototype version in this repository.
// Web, Mobile and Desktop need their *own verified deployment/package* version;
// never silently relabel them with the OS version or invent v1.0.0.
export function productFamilyVersion(modeId) {
  const mode = productFamilyMode(modeId);
  return mode.versionOwner === "ordax-os" ? PRODUCT_VERSION.semanticVersion : null;
}

export function productFamilyDisplay(modeId) {
  const mode = productFamilyMode(modeId);
  const version = productFamilyVersion(modeId);
  return Object.freeze({
    ...mode,
    version,
    versionLabel: version === null ? null : `v${version}`,
  });
}
