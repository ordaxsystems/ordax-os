import {
  validateComponentRuntime,
  validateMountedComponent,
} from "../../contracts/component-runtime.mjs";
import { assertVerifiedComponentPackageSource } from "../../contracts/verified-component-package-source.mjs";

function assertEntry(entry) {
  if (
    !entry
    || typeof entry !== "object"
    || !entry.app
    || !entry.component
    || !entry.metadata
    || entry.app.id !== entry.component.id
    || entry.metadata.componentId !== entry.component.id
    || entry.metadata.version !== entry.component.version
    || entry.metadata.state !== "current"
    || entry.metadata.source !== "slot"
  ) {
    throw new TypeError("Verified external app host entry is invalid");
  }
  return entry;
}

export async function loadVerifiedExternalAppRuntime({
  entry,
  root,
  surfaceLifecycle,
  packageSource,
  importModule = (url) => import(url),
  fileSpace = null,
  appActivation = null,
} = {}) {
  const verified = assertEntry(entry);
  if (!root || typeof root !== "object") {
    throw new TypeError("External app runtime requires an isolated mount root");
  }
  if (!surfaceLifecycle || typeof surfaceLifecycle !== "object") {
    throw new TypeError("External app runtime requires Surface lifecycle");
  }
  const source = assertVerifiedComponentPackageSource(packageSource);
  if (typeof importModule !== "function") {
    throw new TypeError("External app runtime importModule must be a function");
  }

  const context = { root, surfaceLifecycle };
  if (verified.association !== null) {
    if (fileSpace === null || appActivation === null) {
      throw new TypeError(
        `File-associated external app ${verified.app.id} requires public file and activation ports`,
      );
    }
    context.fileSpace = fileSpace;
    context.appActivation = appActivation;
  }

  const runtimeUrl = source.fileUrl({
    componentId: verified.app.id,
    state: "current",
    resolution: verified.metadata,
    path: verified.metadata.entrypoint,
  });
  const module = await importModule(runtimeUrl);
  const runtime = validateComponentRuntime(module?.componentRuntime, {
    componentId: verified.app.id,
    version: verified.component.version,
  });
  return validateMountedComponent(
    await runtime.mount(Object.freeze(context)),
    verified.app.id,
  );
}

export function createVerifiedExternalAppHost({
  root,
  surfaceLifecycle,
  entries = [],
  packageSource,
  importModule = (url) => import(url),
  fileSpace = null,
  appActivation = null,
  onError = null,
} = {}) {
  if (!root || typeof root.querySelector !== "function") {
    throw new TypeError("External app host requires a Surface root");
  }
  if (!surfaceLifecycle || typeof surfaceLifecycle.subscribeRender !== "function") {
    throw new TypeError("External app host requires Surface render lifecycle");
  }
  const source = assertVerifiedComponentPackageSource(packageSource);
  if (!Array.isArray(entries)) throw new TypeError("External app host entries must be an array");
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("External app host onError must be a function or null");
  }

  const byId = new Map();
  for (const raw of entries) {
    const entry = assertEntry(raw);
    if (byId.has(entry.app.id)) {
      throw new TypeError(`External app host duplicates app: ${entry.app.id}`);
    }
    byId.set(entry.app.id, entry);
  }

  const mounted = new Map();
  let destroyed = false;
  let chain = Promise.resolve();

  const disposeRecord = async (appId) => {
    const record = mounted.get(appId);
    if (!record) return;
    mounted.delete(appId);
    try {
      await record.instance?.destroy?.();
    } catch (error) {
      onError?.(error, appId);
    }
  };

  const runReconcile = async () => {
    if (destroyed) return;
    for (const [appId, entry] of byId) {
      const selector = `[data-app-extension="${appId}"]`;
      const mountRoot = root.querySelector(selector);
      const record = mounted.get(appId) ?? null;
      if (record?.root === mountRoot && record.instance) continue;
      if (record) await disposeRecord(appId);
      if (!mountRoot) continue;

      try {
        const instance = await loadVerifiedExternalAppRuntime({
          entry,
          root: mountRoot,
          surfaceLifecycle,
          packageSource: source,
          importModule,
          fileSpace,
          appActivation,
        });
        if (destroyed || root.querySelector(selector) !== mountRoot) {
          await instance.destroy();
          continue;
        }
        mounted.set(appId, Object.freeze({ root: mountRoot, instance }));
      } catch (error) {
        onError?.(error, appId);
      }
    }
  };

  const schedule = () => {
    chain = chain.then(runReconcile, runReconcile);
    return chain;
  };
  const unsubscribe = surfaceLifecycle.subscribeRender(() => { void schedule(); });

  return Object.freeze({
    reconcile: schedule,
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      await chain.catch(() => {});
      for (const appId of [...mounted.keys()]) await disposeRecord(appId);
    },
  });
}
