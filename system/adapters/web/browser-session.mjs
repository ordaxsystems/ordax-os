import {
  BROWSER_UNAVAILABLE_REASONS,
  createUnavailableBrowserSession,
} from "../../contracts/browser-session.mjs";

export function createWebBrowserSession() {
  return createUnavailableBrowserSession(
    BROWSER_UNAVAILABLE_REASONS.WEB_EMBEDDING_DISABLED,
  );
}
