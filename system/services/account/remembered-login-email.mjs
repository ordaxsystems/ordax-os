// Device/browser-local convenience only. Never store passwords or provider tokens.
// The same-origin profile keeps this value across Surface updates and restarts.
const EMAIL_KEY = "ordax.account.remembered-email.v1";

function validEmail(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 320
    && !/[\r\n\0]/.test(value)
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function readRememberedLoginEmail(windowRef = globalThis.window) {
  try {
    const email = windowRef?.localStorage?.getItem(EMAIL_KEY);
    return validEmail(email) ? email : "";
  } catch {
    return "";
  }
}

export function rememberVerifiedLoginEmail(windowRef, email) {
  if (!validEmail(email)) return false;
  try {
    if (typeof windowRef?.localStorage?.setItem !== "function") return false;
    windowRef.localStorage.setItem(EMAIL_KEY, email);
    return true;
  } catch {
    return false;
  }
}

export function forgetRememberedLoginEmail(windowRef = globalThis.window) {
  try {
    windowRef?.localStorage?.removeItem(EMAIL_KEY);
    return true;
  } catch {
    return false;
  }
}
