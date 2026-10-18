import {
  APP_LIFECYCLE_REQUEST_PORT_SCHEMA,
  APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
  validateAppLifecycleRequest,
  validateAppLifecycleRequestResultForRequest,
} from "../../contracts/app-lifecycle-request.mjs";
import {
  createAppLifecyclePlan,
  validateAppLifecyclePlan,
} from "../../contracts/app-lifecycle-plan.mjs";
import {
  assertAppStoreCatalogPort,
  validateAppStoreCatalogSnapshot,
} from "../../contracts/app-store.mjs";
import {
  validateComponentRuntimeMetadata,
} from "../../contracts/component-runtime-metadata.mjs";
import {
  assertVerifiedAppStoreCatalogPort,
  validateVerifiedAppStoreCatalogSnapshot,
} from "../../contracts/verified-app-store-catalog.mjs";

import {
  hasNativeExternalFirstPartyModuleRead,
  hasNativeExternalFirstPartyProbation,
} from "./external-first-party-policy.mjs";

export const APP_LIFECYCLE_DELEGATE_SCHEMA = "ordax.app-lifecycle-delegate/1";

// Remember every request identity for the lifetime of this runtime instance.
// Evicting an old decision would allow the same requestId to acquire a new
// lifecycle plan after the Store/catalog changes.
const MAX_REQUEST_IDENTITIES = 256;

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

function candidateMatchesProjection(candidate, entry) {
  return (
    candidate !== null
    && entry.availableVersion === candidate.version
    && entry.artifactIdentityVerified === true
    && entry.provenanceVerified === true
  );
}

export function createAppLifecycleRequestService({
  catalogPort,
  verifiedCatalogPort,
  lifecycleDelegate,
  getCurrentObservations,
} = {}) {
  if (typeof getCurrentObservations !== "function") {
    throw new TypeError("Native Store lifecycle requires canonical current observations");
  }
  const catalog = assertAppStoreCatalogPort(catalogPort);
  const verifiedCatalog = assertVerifiedAppStoreCatalogPort(verifiedCatalogPort);
  const delegate = assertAppLifecycleDelegate(lifecycleDelegate);
  const inFlightByApp = new Map();
  const requests = new Map();

  const expectedActivationFor = (request, entry) => {
    const raw = getCurrentObservations();
    if (!Array.isArray(raw)) {
      throw new TypeError("Native Store current observations are unavailable");
    }
    const matches = raw.filter((item) => item?.componentId === request.appId);
    if (matches.length !== 1) {
      throw new TypeError("Native Store requires exactly one current activation observation");
    }
    const current = validateComponentRuntimeMetadata(matches[0], {
      componentId: request.appId,
      state: "current",
    });
    if (
      (current.source === "slot" && current.version !== entry.installedVersion)
      || (current.source !== "slot" && entry.installedVersion !== null)
      || current.source === "bundled"
    ) {
      throw new TypeError("Store projection and Native current activation disagree");
    }
    return {
      source: current.source,
      revision: current.revision,
      version: current.version,
      sourceCommit: current.sourceCommit,
    };
  };

  // A bounded instance cannot forget an earlier accepted or rejected ID.
  // Fresh requests fail closed after the capacity is reached; the caller must
  // establish a new lifecycle session rather than reusing stale identities.
  const remember = (requestId, fingerprint, promise) => {
    requests.set(requestId, { fingerprint, promise });
  };

  // Every valid requestId identifies one decision, including decisions rejected
  // before privileged delegation. Otherwise a rejected request may be replayed
  // after the signed catalog changes and unexpectedly become executable.
  const rejectAndRemember = (request, fingerprint, reason) => {
    const response = Promise.resolve(rejection(request, reason));
    remember(request.requestId, fingerprint, response);
    return response;
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

    // Known requestIds remain idempotent even when the ledger is full.
    // No new request can evict their decisions or reach Native authority.
    if (requests.size >= MAX_REQUEST_IDENTITIES) {
      return Promise.resolve(rejection(request, "lifecycle-request-capacity-exhausted"));
    }

    const currentRequestId = inFlightByApp.get(request.appId);
    if (currentRequestId) {
      return rejectAndRemember(request, fingerprint, "lifecycle-request-in-flight");
    }

    const snapshot = validateAppStoreCatalogSnapshot(catalog.getSnapshot());
    if (snapshot.state !== "ready") {
      return rejectAndRemember(request, fingerprint, "verified-catalog-unavailable");
    }
    const entry = snapshot.entries.find((candidate) => candidate.appId === request.appId);
    if (!entry) {
      return rejectAndRemember(request, fingerprint, "app-not-catalogued");
    }
    if (!operationAllowed(entry, request.operation)) {
      return rejectAndRemember(request, fingerprint, "lifecycle-operation-not-available");
    }

    const verified = validateVerifiedAppStoreCatalogSnapshot(verifiedCatalog.getSnapshot());
    if (verified.state !== "ready") {
      return rejectAndRemember(request, fingerprint, "verified-catalog-unavailable");
    }
    const candidate = verified.entries.find((value) => value.appId === request.appId) ?? null;
    if (
      ["install", "update"].includes(request.operation)
      && !candidateMatchesProjection(candidate, entry)
    ) {
      return rejectAndRemember(request, fingerprint, "verified-candidate-projection-mismatch");
    }

    // Signed catalog presence is not executable-read authority. Until the
    // canonical Native broker supports this app, do not delegate an install or
    // update the host cannot load. Removing an installed app stays available.
    if (
      ["install", "update"].includes(request.operation)
      && !hasNativeExternalFirstPartyModuleRead(request.appId)
    ) {
      return rejectAndRemember(request, fingerprint, "runtime-module-read-unavailable");
    }
    if (
      ["install", "update"].includes(request.operation)
      && !hasNativeExternalFirstPartyProbation(request.appId)
    ) {
      return rejectAndRemember(request, fingerprint, "runtime-probation-unavailable");
    }

    let plan;
    try {
      plan = createAppLifecyclePlan({
        request,
        verifiedCatalog: verified,
        candidate,
        expectedActivation: expectedActivationFor(request, entry),
      });
      validateAppLifecyclePlan(plan);
    } catch {
      return rejectAndRemember(request, fingerprint, "verified-lifecycle-plan-unavailable");
    }

    // A catalog can change between synchronous planning and the deferred
    // privileged call. Check the same SSOT ports again at the actual handoff,
    // including candidate artifacts, not only its version or appId.
    const isStillEligible = () => {
      try {
        const latestProjection = validateAppStoreCatalogSnapshot(catalog.getSnapshot());
        const currentEntry = latestProjection.state === "ready"
          ? latestProjection.entries.find((value) => value.appId === request.appId)
          : null;
        if (!currentEntry || !operationAllowed(currentEntry, request.operation)) return false;
        // The signed plan identifies a candidate, not the previously installed
        // slot. A different slot/version must never inherit this request even
        // when the same candidate remains available. Compare the exact fields
        // provided by the canonical, already validated projection schema.
        if (!Object.keys(entry).every((key) => currentEntry[key] === entry[key])) return false;

        const latestCatalog = validateVerifiedAppStoreCatalogSnapshot(verifiedCatalog.getSnapshot());
        if (latestCatalog.state !== "ready") return false;
        const latestCandidate = latestCatalog.entries.find((value) => value.appId === request.appId) ?? null;
        if (["install", "update"].includes(request.operation)) {
          if (!candidateMatchesProjection(latestCandidate, currentEntry)
              || !hasNativeExternalFirstPartyModuleRead(request.appId)
              || !hasNativeExternalFirstPartyProbation(request.appId)) return false;
        }

        // createAppLifecyclePlan() already owns canonical normalization for
        // source identity and all four artifact identities. No duplicate
        // signing policy or independent Store catalog is introduced here.
        const currentPlan = createAppLifecyclePlan({
          request,
          verifiedCatalog: latestCatalog,
          candidate: latestCandidate,
          expectedActivation: expectedActivationFor(request, currentEntry),
        });
        return JSON.stringify(currentPlan) === JSON.stringify(plan);
      } catch {
        return false;
      }
    };

    inFlightByApp.set(request.appId, request.requestId);
    const promise = Promise.resolve()
      .then(() => isStillEligible()
        ? delegate.executeLifecycle(plan)
        : rejection(request, "verified-lifecycle-plan-stale"))
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
