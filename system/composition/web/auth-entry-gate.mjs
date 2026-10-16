export const WEB_LOGIN_PATH = "/login/";

const LOCAL_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLocalWebLayoutPreview(windowRef = globalThis.window) {
  const location = windowRef?.location;
  if (!location || !LOCAL_PREVIEW_HOSTS.has(location.hostname)) return false;
  return new URLSearchParams(location.search ?? "").get("preview") === "layout";
}

export function decideWebEntry(snapshot, { allowLocalLayoutPreview = false } = {}) {
  if (allowLocalLayoutPreview) return "workspace";
  if (snapshot?.state === "signed-in") return "workspace";
  if (snapshot?.state === "signed-out") return "login";
  return "unavailable";
}
