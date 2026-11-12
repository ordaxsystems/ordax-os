import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_VERSION } from "../system/contracts/product-version.mjs";
import {
  PRODUCT_FAMILY_SCHEMA,
  PRODUCT_FAMILY_MODES,
  PRODUCT_FAMILY_PUBLIC_ENDPOINTS,
  productFamilyDisplay,
  productFamilyMode,
  productFamilyVersion,
} from "../system/contracts/product-family.mjs";

test("family is one product with five stable execution-mode IDs", () => {
  assert.equal(PRODUCT_FAMILY_SCHEMA, "ordax.product-family/1");
  assert.deepEqual(PRODUCT_FAMILY_MODES.map(({ modeId }) => modeId), [
    "web", "mobile", "desktop", "usb", "native-disk",
  ]);
  assert.ok(Object.isFrozen(PRODUCT_FAMILY_MODES));
  assert.ok(PRODUCT_FAMILY_MODES.every(Object.isFrozen));
  assert.equal(new Set(PRODUCT_FAMILY_MODES.map(({ modeId }) => modeId)).size, 5);
});

test("public mode names identify the OS variants without creating a sixth mode", () => {
  assert.equal(productFamilyMode("web").displayName, "OrdaX Web");
  assert.equal(productFamilyMode("mobile").displayName, "OrdaX Mobile");
  assert.equal(productFamilyMode("desktop").displayName, "OrdaX Desktop");
  assert.equal(productFamilyMode("usb").displayName, "OrdaX OS — USB");
  assert.equal(productFamilyMode("native-disk").displayName, "OrdaX OS — Nativo");
  assert.equal(productFamilyMode("usb").productId, productFamilyMode("native-disk").productId);
  assert.notEqual(productFamilyMode("desktop").productId, productFamilyMode("usb").productId);
});

test("public site and Web product origins have distinct canonical roles", () => {
  const endpoints = PRODUCT_FAMILY_PUBLIC_ENDPOINTS;
  assert.ok(Object.isFrozen(endpoints));
  assert.ok(Object.isFrozen(endpoints.site));
  assert.ok(Object.isFrozen(endpoints.web));
  assert.equal(endpoints.site.displayName, "OrdaX");
  assert.equal(endpoints.site.origin, "https://ordax.com.br");
  assert.equal(endpoints.site.role, "public-site");
  assert.equal(endpoints.web.displayName, "OrdaX Web");
  assert.equal(endpoints.web.origin, "https://web.ordax.com.br");
  assert.equal(endpoints.web.presentationUrl, "https://ordax.com.br/web/");
  assert.equal(endpoints.web.role, "product-runtime");
  assert.equal(endpoints.web.availabilityOwner, "web-deployment");
});

test("only bootable OS modes inherit the assigned prototype OS version", () => {
  assert.equal(PRODUCT_VERSION.semanticVersion, "0.1.0");
  for (const id of ["web", "mobile", "desktop"]) {
    assert.equal(productFamilyVersion(id), null, id);
    assert.equal(productFamilyDisplay(id).versionLabel, null, id);
  }
  for (const id of ["usb", "native-disk"]) {
    assert.equal(productFamilyVersion(id), PRODUCT_VERSION.semanticVersion);
    assert.equal(productFamilyDisplay(id).versionLabel, PRODUCT_VERSION.displayVersion);
  }
});

test("presentation cannot imply a published release or expand mode authority", () => {
  for (const id of ["web", "mobile", "desktop", "usb", "native-disk"]) {
    const presentation = productFamilyDisplay(id);
    assert.ok(Object.isFrozen(presentation));
    assert.ok(!Object.hasOwn(presentation, "published"));
    assert.ok(!Object.hasOwn(presentation, "privilegedCapabilities"));
  }
  assert.throws(() => productFamilyMode("tablet"), RangeError);
  assert.throws(() => productFamilyMode("studio"), RangeError);
  assert.throws(() => productFamilyMode("android"), RangeError);
  assert.throws(() => productFamilyVersion("__proto__"), RangeError);
});
