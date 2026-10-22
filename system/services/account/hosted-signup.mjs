import { hasNativeHostBridge, postNativeHostMessage } from "../../adapters/native/host-bridge.mjs";
import { PRODUCT_FAMILY_PUBLIC_ENDPOINTS } from "../../contracts/product-family.mjs";

// A Native client may offer the canonical hosted signup when its direct
// registration policy is closed. This is navigation, not Native authorization:
// the public gateway must still enforce legal consent and abuse protection.
export const HOSTED_ACCOUNT_SIGNUP_URL = new URL(
  "/cadastro/",
  PRODUCT_FAMILY_PUBLIC_ENDPOINTS.site.origin,
).href;

// Optional server projection defaults to denied for older gateway versions or
// a failed read. This is only a navigation signal; the registration endpoint
// enforces its own authorization and legal requirements independently.
export function isHostedSignupEnabled(policy) {
  return policy?.publicRegistrationEnabled === true;
}

// The trusted Native Surface explicitly asks its host to open an isolated
// account portal. On Web, an ordinary HTTPS anchor remains the navigation owner.
// Never pass arbitrary URLs or credentials through the privileged bridge.
export function requestNativeHostedSignup(event, windowRef = globalThis.window) {
  if (!hasNativeHostBridge(windowRef)) {
    // Native Surface is loopback-served. Do not let a missing bridge turn an
    // external link into top-level navigation inside its privileged WebView.
    if (windowRef?.location?.protocol === "http:"
      && windowRef?.location?.hostname === "127.0.0.1") {
      event.preventDefault();
    }
    return false;
  }
  // Prevent any fallback that could navigate the privileged Surface if the
  // native host rejects the command or the browser bridge throws.
  event.preventDefault();
  try {
    postNativeHostMessage(windowRef, { type: "account.signup.open" });
    return true;
  } catch {
    return false;
  }
}
