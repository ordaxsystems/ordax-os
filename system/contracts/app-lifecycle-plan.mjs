import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";
import {
  validateAppLifecycleRequest,
} from "./app-lifecycle-request.mjs";
import {
  validateAppArtifactIdentity,
} from "./app-artifact-identity.mjs";

export const APP_LIFECYCLE_PLAN_SCHEMA = "ordax.app-lifecycle-plan/1";

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function validateCandidate(value, appId) {
  if (value === null) return null;
  assertExactKeys(
    value,
    ["appId", "version", "sourceCommit", "artifacts"],
    "App lifecycle candidate",
  );
  const candidateAppId = validateComponentId(value.appId);
  if (candidateAppId !== appId) {
    throw new TypeError("App lifecycle candidate appId mismatch");
  }
  if (typeof value.sourceCommit !== "string" || !COMMIT_RE.test(value.sourceCommit)) {
    throw new TypeError("App lifecycle candidate sourceCommit is invalid");
  }
  assertExactKeys(
    value.artifacts,
    ["package", "release", "compatibility", "componentEnvelope"],
    "App lifecycle candidate artifacts",
  );
  const componentEnvelope = validateAppArtifactIdentity(
    value.artifacts.componentEnvelope,
    "App lifecycle component envelope",
  );
  if (componentEnvelope.name !== `${appId}.runtime-component-envelope.json`) {
    throw new TypeError("App lifecycle component envelope name is not canonical");
  }
  return Object.freeze({
    appId,
    version: validateComponentVersion(value.version),
    sourceCommit: value.sourceCommit,
    artifacts: Object.freeze({
      package: validateAppArtifactIdentity(value.artifacts.package, "App lifecycle package"),
      release: validateAppArtifactIdentity(value.artifacts.release, "App lifecycle release"),
      compatibility: validateAppArtifactIdentity(
        value.artifacts.compatibility,
        "App lifecycle compatibility",
      ),
      componentEnvelope,
    }),
  });
}

export function validateAppLifecyclePlan(value) {
  assertExactKeys(
    value,
    [
      "schema",
      "request",
      "catalogSequence",
      "catalogSha256",
      "catalogSourceCommit",
      "candidate",
      "authority",
    ],
    "App lifecycle plan",
  );
  if (value.schema !== APP_LIFECYCLE_PLAN_SCHEMA) {
    throw new TypeError("Unsupported app lifecycle plan schema");
  }
  if (value.authority !== "none") {
    throw new TypeError("App lifecycle plan must remain authority:none");
  }
  const request = validateAppLifecycleRequest(value.request);
  if (
    !Number.isSafeInteger(value.catalogSequence)
    || value.catalogSequence <= 0
    || typeof value.catalogSha256 !== "string"
    || !SHA256_RE.test(value.catalogSha256)
    || typeof value.catalogSourceCommit !== "string"
    || !COMMIT_RE.test(value.catalogSourceCommit)
  ) {
    throw new TypeError("App lifecycle plan catalog identity is invalid");
  }
  const candidate = validateCandidate(value.candidate, request.appId);
  if (["install", "update"].includes(request.operation) && candidate === null) {
    throw new TypeError("Install/update lifecycle plan requires verified candidate");
  }
  if (
    candidate !== null
    && candidate.sourceCommit !== value.catalogSourceCommit
  ) {
    throw new TypeError("App lifecycle candidate source does not match catalog source");
  }
  return Object.freeze({
    schema: APP_LIFECYCLE_PLAN_SCHEMA,
    request,
    catalogSequence: value.catalogSequence,
    catalogSha256: value.catalogSha256,
    catalogSourceCommit: value.catalogSourceCommit,
    candidate,
    authority: "none",
  });
}

export function createAppLifecyclePlan({
  request,
  verifiedCatalog,
  candidate = null,
} = {}) {
  return validateAppLifecyclePlan({
    schema: APP_LIFECYCLE_PLAN_SCHEMA,
    request,
    catalogSequence: verifiedCatalog.sequence,
    catalogSha256: verifiedCatalog.catalogSha256,
    catalogSourceCommit: verifiedCatalog.source.commit,
    candidate: candidate === null
      ? null
      : {
          appId: candidate.appId,
          version: candidate.version,
          sourceCommit: candidate.sourceCommit,
          artifacts: candidate.artifacts,
        },
    authority: "none",
  });
}
