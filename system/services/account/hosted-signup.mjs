import { PRODUCT_FAMILY_PUBLIC_ENDPOINTS } from "../../contracts/product-family.mjs";

// A Native client may offer the canonical hosted signup when its direct
// registration policy is closed. This is navigation, not Native authorization:
// the public gateway must still enforce legal consent and abuse protection.
export const HOSTED_ACCOUNT_SIGNUP_URL = new URL(
  "/cadastro/",
  PRODUCT_FAMILY_PUBLIC_ENDPOINTS.site.origin,
).href;
