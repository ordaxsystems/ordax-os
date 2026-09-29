import {
  INSTALLED_APPLICATION_SCHEMA,
  toInstalledApplicationPresentation,
  validateInstalledApplication,
} from "../../contracts/installed-application.mjs";

export const INSTALLED_APPLICATION_CATALOG_SCHEMA = "ordax.installed-application-catalog/1";

export function createInstalledApplicationCatalog(records = []) {
  if (!Array.isArray(records)) {
    throw new TypeError("Installed application catalog records must be an array");
  }

  const applications = records.map((record) => validateInstalledApplication(record));
  const byId = new Map();
  for (const app of applications) {
    if (byId.has(app.id)) {
      throw new TypeError(`Installed application id is duplicated: ${app.id}`);
    }
    byId.set(app.id, app);
  }

  const frozen = Object.freeze([...applications]);
  const catalog = {
    schema: INSTALLED_APPLICATION_CATALOG_SCHEMA,
    recordSchema: INSTALLED_APPLICATION_SCHEMA,
    list() {
      return frozen;
    },
    get(appId) {
      return byId.get(appId) ?? null;
    },
    listPresentations() {
      return Object.freeze(frozen.map((app) => toInstalledApplicationPresentation(app)));
    },
  };

  return Object.freeze(catalog);
}
