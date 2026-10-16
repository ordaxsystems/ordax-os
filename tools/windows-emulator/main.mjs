import { mountFirstRunExperience } from "/system/surface/ui/first-run.mjs";
import { createPreferenceRuntime } from "/system/services/preferences/runtime.mjs";
import {
  PREFERENCE_STORE_SCHEMA,
  validatePreferenceRecord,
} from "/system/contracts/preference-store.mjs";
import {
  FIRST_RUN_STATE_SCHEMA,
  FIRST_RUN_STATE_STORE_SCHEMA,
  createInitialFirstRunState,
  validateFirstRunState,
} from "/system/contracts/first-run-state-store.mjs";

const STATE_KEY = "ordax.windows-emulator.first-run.v1";
const PREFS_KEY = "ordax.windows-emulator.preferences.v1";
const SURFACE_TARGET = "/system/composition/web/";

const surfaceFrame = document.querySelector("#ordax-emulator-surface");
if (!(surfaceFrame instanceof HTMLIFrameElement)) throw new Error("Windows emulator Surface frame is missing");

function activateSurface() {
  if (surfaceFrame.getAttribute("src") === SURFACE_TARGET) return;
  surfaceFrame.setAttribute("src", SURFACE_TARGET);
}

function loadJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function createEmulatedFirstRunStateStore() {
  let state;
  try {
    state = validateFirstRunState(loadJson(STATE_KEY, createInitialFirstRunState()));
  } catch {
    state = createInitialFirstRunState();
  }

  return Object.freeze({
    schema: FIRST_RUN_STATE_STORE_SCHEMA,
    load() {
      return state;
    },
    async save(snapshot) {
      const next = validateFirstRunState(snapshot);
      state = next;
      window.localStorage.setItem(STATE_KEY, JSON.stringify(next));
      if (next.completed) queueMicrotask(activateSurface);
      return next;
    },
  });
}

function createEmulatedPreferenceStore() {
  let snapshot;
  try {
    snapshot = validatePreferenceRecord(loadJson(PREFS_KEY, {}));
  } catch {
    snapshot = validatePreferenceRecord({});
  }

  const persist = (next) => {
    const validated = validatePreferenceRecord(next);
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(validated));
    snapshot = validated;
    return true;
  };

  return Object.freeze({
    schema: PREFERENCE_STORE_SCHEMA,
    load() {
      return snapshot;
    },
    save(next) {
      return persist(next);
    },
    async saveConfirmed(next) {
      persist(next);
      return true;
    },
  });
}

function createUnavailableIdentitySession() {
  const snapshot = Object.freeze({ state: "unavailable" });
  return Object.freeze({
    schema: "ordax.identity-session/1",
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
    async refresh() {
      return snapshot;
    },
  });
}

function createUnavailableIdentityActions() {
  const snapshot = Object.freeze({ supportedActions: [] });
  return Object.freeze({
    schema: "ordax.identity-actions/1",
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
    async execute() {
      throw new Error("Online identity actions are not wired in the Windows emulator yet");
    },
  });
}

const root = document.querySelector("#ordax-emulator-root");
if (!(root instanceof Element)) throw new Error("Windows emulator root is missing");

const stateStore = createEmulatedFirstRunStateStore();
const preferences = createPreferenceRuntime(createEmulatedPreferenceStore());
const identitySession = createUnavailableIdentitySession();
const identityActions = createUnavailableIdentityActions();

if (stateStore.load().completed) activateSurface();

window.__ORDAX_EMULATOR__ = Object.freeze({
  schema: "ordax.windows-emulator/1",
  kernel: false,
  host: "windows-development",
  repositoryBacked: true,
  surfaceTarget: SURFACE_TARGET,
  isSurfaceActive: () => surfaceFrame.getAttribute("src") === SURFACE_TARGET,
  getFirstRunState: () => stateStore.load(),
  resetFirstRun() {
    window.localStorage.removeItem(STATE_KEY);
    window.location.reload();
  },
});

mountFirstRunExperience(root, {
  stateStore,
  preferences,
  identitySession,
  identityActions,
});

document.querySelector("#ordax-emulator-reset")?.addEventListener("click", () => {
  window.__ORDAX_EMULATOR__.resetFirstRun();
});

console.info("OrdaX Windows Emulator ready", {
  schema: window.__ORDAX_EMULATOR__.schema,
  kernel: false,
  firstRunSchema: FIRST_RUN_STATE_SCHEMA,
});
