import { PRODUCT_FAMILY_PUBLIC_ENDPOINTS } from "../../contracts/product-family.mjs";

// A Native client may offer the canonical hosted signup when its direct
// registration policy is closed. This is navigation, not Native authorization:
// the public gateway must still enforce legal consent and abuse protection.
export const HOSTED_ACCOUNT_SIGNUP_URL = new URL(
  "/cadastro/",
  PRODUCT_FAMILY_PUBLIC_ENDPOINTS.site.origin,
).href;

// The trusted Native Surface explicitly asks its host to open an isolated
// account portal. On Web, an ordinary HTTPS anchor remains the navigation owner.
// Never pass arbitrary URLs or credentials through the privileged bridge.
export function requestNativeHostedSignup(event, windowRef = globalThis.window) {
  const bridge = windowRef?.webkit?.messageHandlers?.ordaxBrowser;
  if (!bridge || typeof bridge.postMessage !== "function") return false;
  // Prevent any fallback that could navigate the privileged Surface if the
  // native host rejects the command or the browser bridge throws.
  event.preventDefault();
  try {
    bridge.postMessage(JSON.stringify({ type: "account.signup.open" }));
    return true;
  } catch {
    return false;
  }
}
