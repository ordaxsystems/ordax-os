import {
  UPDATE_STATUS_SCHEMA,
  validateUpdateStatusSnapshot,
} from "../../contracts/update-status.mjs";
import { nativeSurfaceSourceSha } from "./surface-heartbeat.mjs";

const UPDATE_STATE_PATH = "/__ordax/native/update";
const UPDATE_CHECK_PATH = "/__ordax/native/update-check";
const UPDATE_HEALTH_PATH = "/__ordax/native/health";
const HEALTH_TOKEN_HEADER = "X-OrdaX-Health-Token";
const DEFAULT_INTERVAL_MS = 750;
const DEFAULT_IDLE_INTERVAL_MS = 3000;
const MAX_RELOAD_ATTEMPTS = 4;

export function buildReloadUrl(href, sourceSha, attempt = 1) {
  if (typeof href !== "string" || href.length === 0) return "";
  if (typeof sourceSha !== "string" || sourceSha.length === 0) return href;
  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  let base = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const encodedSha = encodeURIComponent(sourceSha);
  if (/([?&])source=[^&#]*/.test(base)) {
    base = base.replace(/([?&])source=[^&#]*/, `$1source=${encodedSha}`);
  } else {
    base += `${base.includes("?") ? "&" : "?"}source=${encodedSha}`;
  }
  if (/([?&])ordax_reload=[^&#]*/.test(base)) {
    base = base.replace(/([?&])ordax_reload=[^&#]*/, `$1ordax_reload=${attempt}`);
  } else {
    base += `&ordax_reload=${attempt}`;
  }
  return `${base}${hash}`;
}

export function shouldReloadForUpdate(previousSha, state) {
  if (!previousSha || !state || typeof state !== "object") {
    return false;
  }
  return (
    typeof state.sourceSha === "string" &&
    state.sourceSha.length > 0 &&
    state.sourceSha !== previousSha &&
    state.applyMode === "reload"
  );
}

export function createNativeUpdateWatcher(
  windowRef,
  {
    intervalMs = DEFAULT_INTERVAL_MS,
    idleIntervalMs = DEFAULT_IDLE_INTERVAL_MS,
    onState = () => {},
    onHealthConfirmed = () => {},
  } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new Error("native update watcher requires window.fetch");
  }
  if (!windowRef.location || typeof windowRef.location.reload !== "function") {
    throw new Error("native update watcher requires window.location.reload");
  }
  if (typeof windowRef.setTimeout !== "function" || typeof windowRef.clearTimeout !== "function") {
    throw new Error("native update watcher requires timer APIs");
  }

  if (typeof onHealthConfirmed !== "function") {
    throw new TypeError("Native health acknowledgement observer must be a function");
  }

  const renderedSourceSha = nativeSurfaceSourceSha(windowRef);
  let observedSha = null;
  let snapshot = null;
  let manualCheckToken = "";
  let stopped = false;
  let timer = null;
  let healthRequested = false;
  let healthSubmittedSha = null;
  let pendingReloadSha = null;
  let reloadAttempts = 0;
  let publishedSnapshotKey = null;
  const listeners = new Set();

  const notify = (state) => {
    const nextSnapshot = validateUpdateStatusSnapshot(state);
    // Polling is the host's update transport; listeners are change notifications.
    // Compare the complete validated contract, including health/authorization
    // fields, so no meaningful transition is suppressed.
    const nextKey = JSON.stringify(nextSnapshot);
    snapshot = nextSnapshot;
    if (nextKey === publishedSnapshotKey) return;
    publishedSnapshotKey = nextKey;
    onState(snapshot);
    for (const listener of listeners) listener(snapshot);
  };

  const submitHealthIfNeeded = async () => {
    if (
      stopped ||
      !healthRequested ||
      !snapshot ||
      !renderedSourceSha ||
      snapshot.healthToken.length === 0 ||
      snapshot.sourceSha !== renderedSourceSha ||
      healthSubmittedSha === renderedSourceSha ||
      pendingReloadSha === snapshot.sourceSha
    ) {
      return false;
    }
    try {
      const response = await windowRef.fetch(UPDATE_HEALTH_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          [HEALTH_TOKEN_HEADER]: snapshot.healthToken,
        },
        body: JSON.stringify({ sourceSha: renderedSourceSha }),
      });
      if (!response.ok) return false;
      healthSubmittedSha = renderedSourceSha;
      // Only the existing authorized Native Host 2xx receipt may release
      // post-boot optional work. This callback has no health-write authority.
      try {
        onHealthConfirmed(renderedSourceSha);
      } catch {
        // Optional component startup cannot veto the real Surface health ack.
      }
      return true;
    } catch {
      return false;
    }
  };

  const schedule = () => {
    if (stopped) return;
    // Keep the development update loop responsive during real activity; an
    // idle Surface does not require a new request every 750 milliseconds.
    const idle = snapshot !== null
      && snapshot.phase === "idle"
      && !snapshot.manualCheckPending
      && pendingReloadSha === null;
    timer = windowRef.setTimeout(() => {
      timer = null;
      void poll();
    }, idle ? Math.max(intervalMs, idleIntervalMs) : intervalMs);
  };

  const requestReload = () => {
    if (!snapshot || !pendingReloadSha || reloadAttempts >= MAX_RELOAD_ATTEMPTS) return;
    reloadAttempts += 1;
    try {
      if (
        typeof windowRef.location.replace === "function" &&
        typeof windowRef.location.href === "string"
      ) {
        const target = buildReloadUrl(
          windowRef.location.href,
          pendingReloadSha,
          reloadAttempts,
        );
        if (target) {
          windowRef.location.replace(target);
          return;
        }
      }
      windowRef.location.reload();
    } catch {
      try {
        windowRef.location.reload();
      } catch {
        // Keep polling. A later Surface restart can still recover the page.
      }
    }
  };

  const poll = async () => {
    try {
      const response = await windowRef.fetch(UPDATE_STATE_PATH, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) return;

      const state = await response.json();
      // A disposed watcher must never publish a late response or reload a page.
      if (stopped) return;
      if (!state || typeof state.sourceSha !== "string" || state.sourceSha.length === 0) return;

      manualCheckToken = state.manualCheckAvailable === true
        && typeof state.manualCheckToken === "string"
        && state.manualCheckToken.length >= 24
          ? state.manualCheckToken
          : "";
      notify(state);
      if (observedSha === null) {
        observedSha = snapshot.sourceSha;
        void submitHealthIfNeeded();
        return;
      }

      const previousSha = observedSha;
      observedSha = snapshot.sourceSha;
      if (shouldReloadForUpdate(previousSha, snapshot)) {
        pendingReloadSha = snapshot.sourceSha;
        reloadAttempts = 0;
        requestReload();
        return;
      }

      if (
        pendingReloadSha &&
        snapshot.sourceSha === pendingReloadSha &&
        snapshot.applyMode === "reload" &&
        snapshot.status === "applied"
      ) {
        requestReload();
        return;
      }

      if (
        pendingReloadSha &&
        (snapshot.sourceSha !== pendingReloadSha ||
          snapshot.applyMode !== "reload" ||
          snapshot.status !== "applied")
      ) {
        pendingReloadSha = null;
        reloadAttempts = 0;
      }

      void submitHealthIfNeeded();
    } catch {
      // Network/update polling must never take the running Surface down.
    } finally {
      schedule();
    }
  };

  void poll();

  return Object.freeze({
    schema: UPDATE_STATUS_SCHEMA,
    dispose() {
      stopped = true;
      if (timer !== null) {
        windowRef.clearTimeout(timer);
        timer = null;
      }
      listeners.clear();
    },
    getObservedSha() {
      return observedSha;
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("update watcher subscriber must be a function");
      }
      listeners.add(listener);
      if (snapshot) listener(snapshot);
      return () => listeners.delete(listener);
    },
    markHealthy() {
      healthRequested = true;
      return submitHealthIfNeeded();
    },
    async requestCheck() {
      if (stopped || snapshot?.manualCheckAvailable !== true || manualCheckToken.length < 24) {
        throw new Error("Owner/Development manual update is unavailable");
      }
      const response = await windowRef.fetch(UPDATE_CHECK_PATH, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-OrdaX-Update-Token": manualCheckToken,
        },
        body: JSON.stringify({ action: "check-main" }),
      });
      if (response.status !== 202) {
        throw new Error(`Owner/Development manual update request rejected: ${response.status}`);
      }
      const receipt = await response.json();
      if (receipt?.schema !== "ordax.owner-manual-update-request/1"
        || !["queued", "pending"].includes(receipt.state)) {
        throw new Error("Owner/Development manual update receipt is invalid");
      }
      return receipt.state;
    },
  });
}
