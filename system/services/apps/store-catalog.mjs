import {
  validateVerifiedAppPublicationCatalogSnapshot,
} from "../../contracts/verified-app-publication-catalog.mjs";
import {
  validateFirstPartyAppDeliveryObservation,
} from "../../contracts/first-party-app-delivery.mjs";
import {
  getFirstPartyAppDeliveryPolicy,
  projectFirstPartyAppDelivery,
} from "./delivery-policy.mjs";
import {
  APP_STORE_CATALOG_SCHEMA,
  validateAppStoreCatalogSnapshot,
} from "../../contracts/app-store.mjs";

const DEFAULT_OBSERVATION = Object.freeze({
  installed: false,
  catalogued: true,
  transition: "idle",
  blockedReason: null,
  failedRetained: false,
});

function observationFor(appId, observations) {
  if (observations === null || observations === undefined) {
    return DEFAULT_OBSERVATION;
  }
  if (typeof observations === "function") {
    const value = observations(appId);
    return value == null
      ? DEFAULT_OBSERVATION
      : validateFirstPartyAppDeliveryObservation(value);
  }
  if (observations instanceof Map) {
    const value = observations.get(appId);
    return value == null
      ? DEFAULT_OBSERVATION
      : validateFirstPartyAppDeliveryObservation(value);
  }
  if (typeof observations === "object" && !Array.isArray(observations)) {
    const value = observations[appId];
    return value == null
      ? DEFAULT_OBSERVATION
      : validateFirstPartyAppDeliveryObservation(value);
  }
  throw new TypeError("Store delivery observations must be a function, Map, object, or absent");
}

export function projectVerifiedAppPublicationsToStoreCatalog(
  publicationSnapshotValue,
  { observations = null } = {},
) {
  const publications = validateVerifiedAppPublicationCatalogSnapshot(
    publicationSnapshotValue,
  );
  if (publications.state === "unavailable") {
    return validateAppStoreCatalogSnapshot({
      schema: APP_STORE_CATALOG_SCHEMA,
      state: "unavailable",
      entries: [],
      reason: publications.reason,
      authority: "none",
    });
  }

  const entries = publications.entries.map((publication) => {
    const policy = getFirstPartyAppDeliveryPolicy(publication.appId);
    if (policy === null) {
      throw new TypeError(
        `Verified publication references unknown first-party app: ${publication.appId}`,
      );
    }
    if (policy.deliveryClass === "structural") {
      throw new TypeError(
        `Structural app cannot be projected from independent Store publication: ${publication.appId}`,
      );
    }

    let observation = observationFor(publication.appId, observations);
    if (observation.catalogued !== true) {
      throw new TypeError(
        `Verified publication requires catalogued delivery observation: ${publication.appId}`,
      );
    }

    if (publication.compatibilityState === "blocked") {
      if (
        observation.transition !== "idle"
        || observation.failedRetained
        || observation.blockedReason !== null
      ) {
        throw new TypeError(
          `Blocked publication conflicts with active delivery observation: ${publication.appId}`,
        );
      }
      observation = validateFirstPartyAppDeliveryObservation({
        ...observation,
        blockedReason: publication.compatibilityReason,
      });
    }

    const projection = projectFirstPartyAppDelivery(
      publication.appId,
      observation,
    );
    return {
      appId: publication.appId,
      title: publication.title,
      version: publication.version,
      state: projection.state,
      installable: projection.installable
        && publication.compatibilityState === "compatible",
      installed: projection.launchable,
      blockedReason: projection.reason,
      artifactIdentityVerified: true,
      provenanceVerified: true,
    };
  });

  return validateAppStoreCatalogSnapshot({
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    entries,
    reason: null,
    authority: "none",
  });
}
