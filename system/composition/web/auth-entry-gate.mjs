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

/**
 * One fail-closed entry lifecycle for initial session validation and subsequent
 * reconnects. The authenticated workspace is never retained across an
 * unavailable or signed-out transition. The owning session adapter supplies
 * refresh events; this adds no network reader or retry loop.
 */
export function createWebEntryLifecycle({
  onWorkspace,
  onLogin,
  onUnavailable,
  allowLocalLayoutPreview = false,
} = {}) {
  for (const [name, callback] of Object.entries({ onWorkspace, onLogin, onUnavailable })) {
    if (typeof callback !== "function") {
      throw new TypeError(`Web entry lifecycle requires ${name}()`);
    }
  }
  let started = false;
  let disposed = false;
  let lastDecision = null;

  function transition(snapshot) {
    if (disposed || !started) return null;
    const decision = decideWebEntry(snapshot, { allowLocalLayoutPreview });
    if (decision === lastDecision) return decision;
    if (decision === "workspace") onWorkspace();
    else if (decision === "login") onLogin();
    else onUnavailable();
    lastDecision = decision;
    return decision;
  }

  return Object.freeze({
    start(snapshot) {
      if (disposed || started) throw new Error("Web entry lifecycle already started or disposed");
      started = true;
      return transition(snapshot);
    },
    update: transition,
    dispose() {
      disposed = true;
    },
  });
}
