import {
  APP_LIFECYCLE_REQUEST_PORT_SCHEMA,
  APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
  validateAppLifecycleRequest,
  validateAppLifecycleRequestResultForRequest,
} from "../../contracts/app-lifecycle-request.mjs";
import {
  assertAppStoreCatalogPort,
  validateAppStoreCatalogSnapshot,
} from "../../contracts/app-store.mjs";

export const APP_LIFECYCLE_DELEGATE_SCHEMA = "ordax.app-lifecycle-delegate/1";

const MAX_COMPLETED_REQUESTS = 256;

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

export function assertAppLifecycleDelegate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App lifecycle delegate must be an object");
  }
  assertExactKeys(
    value,
    ["schema", "authority", "executeLifecycle"],
    "App lifecycle delegate",
  );
  if (value.schema !== APP_LIFECYCLE_DELEGATE_SCHEMA) {
    throw new TypeError("Unsupported app lifecycle delegate schema");
  }
  if (value.authority !== "platform-component-lifecycle") {
    throw new TypeError("App lifecycle delegate requires platform component lifecycle authority");
  }
  if (typeof value.executeLifecycle !== "function") {
    throw new TypeError("App lifecycle delegate requires executeLifecycle()");
  }
  return value;
}

function operationAllowed(entry, operation) {
  if (operation === "install") return entry.installable;
  if (operation === "update") return entry.updatable;
  if (operation === "remove") return entry.removable;
  return false;
}

function rejection(request, reason) {
  return Object.freeze({
    schema: APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
    requestId: request.requestId,
    appId: request.appId,
    operation: request.operation,
    source: request.source,
    state: "rejected",
    reason,
    authority: "none",
  });
}

function requestFingerprint(request) {
  return [
    request.appId,
    request.operation,
    request.source,
    request.authority,
  ].join("\u0000");
}

export function createAppLifecycleRequestService({
  catalogPort,
  lifecycleDelegate,
} = {}) {
  const catalog = assertAppStoreCatalogPort(catalogPort);
  const delegate = assertAppLifecycleDelegate(lifecycleDelegate);
  const inFlightByApp = new Map();
  const requests = new Map();

  const remember = (requestId, fingerprint, promise) => {
    requests.set(requestId, { fingerprint, promise });
    while (requests.size > MAX_COMPLETED_REQUESTS) {
      const oldest = requests.keys().next().value;
      if (inFlightByApp.has(oldest)) break;
      requests.delete(oldest);
    }
  };

  const requestLifecycle = (rawRequest) => {
    const request = validateAppLifecycleRequest(rawRequest);
    const fingerprint = requestFingerprint(request);
    const known = requests.get(request.requestId);
    if (known) {
      if (known.fingerprint !== fingerprint) {
        throw new TypeError("App lifecycle requestId replay identity mismatch");
      }
      return known.promise;
    }

    const currentRequestId = inFlightByApp.get(request.appId);
    if (currentRequestId) {
      return Promise.resolve(rejection(request, "lifecycle-request-in-flight"));
    }

    const snapshot = validateAppStoreCatalogSnapshot(catalog.getSnapshot());
    if (snapshot.state !== "ready") {
      return Promise.resolve(rejection(request, "verified-catalog-unavailable"));
    }
    const entry = snapshot.entries.find((candidate) => candidate.appId === request.appId);
    if (!entry) {
      return Promise.resolve(rejection(request, "app-not-catalogued"));
    }
    if (!operationAllowed(entry, request.operation)) {
      return Promise.resolve(rejection(request, "lifecycle-operation-not-available"));
    }

    inFlightByApp.set(request.appId, request.requestId);
    const promise = Promise.resolve()
      .then(() => delegate.executeLifecycle(request))
      .then((rawResult) => validateAppLifecycleRequestResultForRequest(rawResult, request))
      .catch(() => rejection(request, "platform-lifecycle-unavailable"))
      .finally(() => {
        if (inFlightByApp.get(request.appId) === request.requestId) {
          inFlightByApp.delete(request.appId);
        }
      });

    remember(request.requestId, fingerprint, promise);
    return promise;
  };

  return Object.freeze({
    schema: APP_LIFECYCLE_REQUEST_PORT_SCHEMA,
    authority: "none",
    requestLifecycle,
  });
}
