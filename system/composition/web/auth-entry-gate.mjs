export const WEB_LOGIN_PATH = "/login/";

const LOCAL_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOCAL_LAYOUT_PROOF_MOUNT = "/ordax/";

export function isLocalWebLayoutPreview(windowRef = globalThis.window) {
  const location = windowRef?.location;
  if (!location || !LOCAL_PREVIEW_HOSTS.has(location.hostname)) return false;
  const explicitPreview = new URLSearchParams(location.search ?? "").get("preview") === "layout";
  // The browser proof serves the relocatable candidate only on loopback under
  // /ordax/. This keeps CI layout validation independent from identity without
  // creating any bypass on the canonical Web host.
  return explicitPreview || location.pathname === LOCAL_LAYOUT_PROOF_MOUNT;
}

export function decideWebEntry(snapshot, { allowLocalLayoutPreview = false } = {}) {
  if (allowLocalLayoutPreview) return "workspace";
  if (snapshot?.state === "signed-in") return "workspace";
  if (snapshot?.state === "signed-out") return "login";
  return "unavailable";
}
