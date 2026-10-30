export const WEB_LOGIN_PATH = "/login/";

const LOCAL_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOCAL_LAYOUT_PROOF_PATHS = new Set(["/", "/ordax/"]);

export function isLocalWebLayoutPreview(windowRef = globalThis.window) {
  const location = windowRef?.location;
  if (!location || !LOCAL_PREVIEW_HOSTS.has(location.hostname)) return false;
  const explicitPreview = new URLSearchParams(location.search ?? "").get("preview") === "layout";
  // Layout proofs are intentionally loopback-only. The standalone Web candidate
  // is served at /, while the composed public-site proof mounts the same bundle
  // at /ordax/. Remote hosts never gain preview authority, even with the query.
  return explicitPreview || LOCAL_LAYOUT_PROOF_PATHS.has(location.pathname);
}

export function decideWebEntry(snapshot, { allowLocalLayoutPreview = false } = {}) {
  if (allowLocalLayoutPreview) return "workspace";
  if (snapshot?.state === "signed-in") return "workspace";
  if (snapshot?.state === "signed-out") return "login";
  return "unavailable";
}
