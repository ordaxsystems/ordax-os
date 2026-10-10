import { assertComponentManager } from "../../contracts/component-manager.mjs";
import { assertAppDataPort } from "../../contracts/app-data.mjs";
import { hasNativeExternalFirstPartyModuleRead } from "../apps/external-first-party-policy.mjs";
import { loadVerifiedCurrentComponentRuntime } from "./current-slot-loader.mjs";
import {
  validateComponentRuntime,
  validateMountedComponent,
} from "../../contracts/component-runtime.mjs";

const MAX_TRUSTED_CONTEXT_PROVIDERS = 16;
const MAX_TRUSTED_CONTEXT_FIELDS_PER_PROVIDER = 16;
const FORBIDDEN_TRUSTED_CONTEXT_FIELDS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const trustedContextProviders = [];
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
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (
      Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null
    )
  ) {
    throw new TypeError("Trusted component context provider must return a plain object or null");
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError("Trusted component context provider must not return symbol fields");
  }
  const additions = Object.entries(value);
  if (additions.length > MAX_TRUSTED_CONTEXT_FIELDS_PER_PROVIDER) {
    throw new RangeError("Trusted component context provider returned too many fields");
  }
  if (!additions.length) return context;
  for (const [key] of additions) {
    if (
      key.length === 0
      || key.length > 128
      || /[\u0000-\u001f\u007f]/.test(key)
      || FORBIDDEN_TRUSTED_CONTEXT_FIELDS.has(key)
      || Object.prototype.hasOwnProperty.call(context, key)
    ) {
      throw new TypeError(`Trusted component context cannot add field: ${key}`);
    }
  }
  return Object.freeze({ ...context, ...value });
}

async function composeTrustedContext(componentId, callerContext) {
  let context = callerContext;
  for (const provider of trustedContextProviders) {
    context = validateTrustedContext(await provider(componentId), context);
  }
  return context;
}

export function installTrustedComponentContextProvider(provider) {
  if (typeof provider !== "function") {
    throw new TypeError("Trusted component context provider must be a function");
  }
  if (componentLoadStarted) {
    throw new Error("Trusted component context provider cannot be installed after app loading starts");
  }
  if (trustedContextProviders.includes(provider)) {
    throw new Error("Trusted component context provider is already installed");
  }
  if (trustedContextProviders.length >= MAX_TRUSTED_CONTEXT_PROVIDERS) {
    throw new RangeError("Trusted component context provider limit reached");
  }
  trustedContextProviders.push(provider);
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
    const effectiveContext = await composeTrustedContext(componentId, context);
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

// This is the privileged Native composition boundary for independently
// installed first-party apps. A manifest or catalog never supplies App Data.
// The host-only bootstrap's existing trusted providers bind it by componentId.
export async function loadTrustedCurrentExternalAppRuntime({
  componentId,
  source,
  fetchImpl,
  importModule,
  context = Object.freeze({}),
  timeout = 5_000,
  onError = null,
} = {}) {
  if (!hasNativeExternalFirstPartyModuleRead(componentId)) {
    throw new TypeError("External component is not allowed by the Native module-read policy");
  }
  if (!context || typeof context !== "object" || Array.isArray(context)
      || Object.prototype.hasOwnProperty.call(context, "appData")) {
    throw new TypeError("External component context cannot supply App Data");
  }
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("External component error handler must be a function or null");
  }
  componentLoadStarted = true;
  let effectiveContext;
  try {
    effectiveContext = await composeTrustedContext(componentId, Object.freeze({ ...context }));
    const appData = assertAppDataPort(effectiveContext.appData);
    if (appData.identity.appId !== componentId) {
      throw new TypeError("External component App Data identity is not bound to this app");
    }
  } catch (error) {
    onError?.(error);
    return null;
  }
  return loadVerifiedCurrentComponentRuntime({
    componentId, source, fetchImpl, importModule,
    context: effectiveContext, timeout, onError,
  });
}
