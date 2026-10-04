import {
  assertAppDataPort,
  validateAppDataIdentity,
} from "../../contracts/app-data.mjs";
import { createBoundAppDataPort } from "../../services/app-data/runtime.mjs";
import { createNativeAppDataStore } from "./app-data.mjs";

/**
 * Trusted Native composition factory.
 *
 * endpoint and identity are bootstrap inputs owned by the platform. They are
 * closed over here and are never properties of the returned app-facing port.
 */
export function createNativeBoundAppDataPort({
  windowRef = globalThis,
  endpoint,
  identity,
} = {}) {
  const boundIdentity = validateAppDataIdentity(identity);
  const store = createNativeAppDataStore({
    windowRef,
    endpoint,
    identity: boundIdentity,
  });
  const port = createBoundAppDataPort({
    store,
    appId: boundIdentity.appId,
    publisherId: boundIdentity.publisherId,
  });
  assertAppDataPort(port);
  return port;
}
