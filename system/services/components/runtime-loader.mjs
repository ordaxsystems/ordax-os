import { assertComponentManager } from "../../contracts/component-manager.mjs";
import {
  validateComponentRuntime,
  validateMountedComponent,
} from "../../contracts/component-runtime.mjs";

let trustedContextProvider = null;
let componentLoadStarted = false;

function componentRecord(manager, componentId) {
  const record = manager.getSnapshot().components.find(
    (component) => component.manifest.id === componentId,
  );
  if (!record) throw new TypeError(`Unknown component runtime: ${componentId}`);
  return record;
}

function validateTrustedContext(value, context) {
  if (value === null) return context;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Trusted component context provider must return an object or null");
  }
  const additions = Object.entries(value);
  if (!additions.length) return context;
  for (const [key] of additions) {
    if (!key || Object.prototype.hasOwnProperty.call(context, key)) {
      throw new TypeError(`Trusted component context cannot replace caller field: ${key}`);
    }
  }
  return Object.freeze({ ...context, ...value });
}

export function installTrustedComponentContextProvider(provider) {
  if (typeof provider !== "function") {
    throw new TypeError("Trusted component context provider must be a function");
  }
  if (componentLoadStarted) {
    throw new Error("Trusted component context provider cannot be installed after app loading starts");
  }
  if (trustedContextProvider !== null) {
    throw new Error("Trusted component context provider is already installed");
  }
  trustedContextProvider = provider;
}

export async function loadOptionalComponentRuntime({
  componentId,
  importer,
  context = Object.freeze({}),
  componentManager,
  onError = null,
} = {}) {
  if (typeof componentId !== "string" || !componentId) {
    throw new TypeError("Optional component runtime requires componentId");
  }
  if (typeof importer !== "function") {
    throw new TypeError(`Optional component ${componentId} requires importer()`);
  }
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Optional component onError must be a function or null");
  }

  const manager = assertComponentManager(componentManager);
  const expected = componentRecord(manager, componentId);
  componentLoadStarted = true;

  try {
    const trustedContext = trustedContextProvider === null
      ? null
      : await trustedContextProvider(componentId);
    const effectiveContext = validateTrustedContext(trustedContext, context);
    const module = await importer();
    const runtime = validateComponentRuntime(module?.componentRuntime, {
      componentId,
      version: expected.manifest.version,
    });
    const mounted = validateMountedComponent(
      await runtime.mount(effectiveContext),
      componentId,
    );
    manager.setCurrentHealth(componentId, "healthy");
    return mounted;
  } catch (error) {
    try {
      manager.setCurrentHealth(componentId, "failed");
    } catch {
      // Health reporting must never turn an optional-component failure into a Surface failure.
    }
    if (onError) onError(error);
    return null;
  }
}
