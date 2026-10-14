import { assertComponentManager } from "../../contracts/component-manager.mjs";
import {
  validateComponentRuntime,
  validateMountedComponent,
} from "../../contracts/component-runtime.mjs";
import { createComponentContextProviderRegistry } from "./context-provider-registry.mjs";

const trustedContextRegistry = createComponentContextProviderRegistry({
  label: "Trusted component context",
  startDescription: "app loading",
});

function componentRecord(manager, componentId) {
  const record = manager.getSnapshot().components.find(
    (component) => component.manifest.id === componentId,
  );
  if (!record) throw new TypeError(`Unknown component runtime: ${componentId}`);
  return record;
}

export async function composeTrustedComponentContext(componentId, context) {
  return trustedContextRegistry.compose(componentId, context);
}

export function installTrustedComponentContextProvider(provider) {
  trustedContextRegistry.install(provider);
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

  try {
    const effectiveContext = await composeTrustedComponentContext(componentId, context);
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
