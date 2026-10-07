import { validateAppArtifactIdentity } from "./app-artifact-identity.mjs";

export const APP_ARTIFACT_ACQUISITION_SOURCE_SCHEMA = "ordax.app-artifact-acquisition-source/1";

export function assertAppArtifactAcquisitionSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("App artifact acquisition source must be an object");
  }
  const keys = Object.keys(value).sort();
  const expected = ["authority", "load", "schema", "transport"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("App artifact acquisition source fields are not canonical");
  }
  if (value.schema !== APP_ARTIFACT_ACQUISITION_SOURCE_SCHEMA) {
    throw new TypeError("Unsupported app artifact acquisition source schema");
  }
  if (value.authority !== "content-fetch-only") {
    throw new TypeError("App artifact acquisition source authority is invalid");
  }
  if (value.transport !== "unconfigured" && value.transport !== "https") {
    throw new TypeError("App artifact acquisition source transport is invalid");
  }
  if (typeof value.load !== "function") {
    throw new TypeError("App artifact acquisition source requires load()");
  }
  return value;
}

export function createUnavailableAppArtifactAcquisitionSource() {
  return Object.freeze({
    schema: APP_ARTIFACT_ACQUISITION_SOURCE_SCHEMA,
    authority: "content-fetch-only",
    transport: "unconfigured",
    async load(identity) {
      validateAppArtifactIdentity(identity);
      throw new Error("App artifact acquisition transport is unconfigured");
    },
  });
}
