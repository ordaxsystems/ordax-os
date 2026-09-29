function firstPartyPresentation(app) {
  if (!app || typeof app !== "object" || typeof app.id !== "string" || !app.id) {
    throw new TypeError("First-party application presentation input is invalid");
  }
  return Object.freeze({
    id: app.id,
    title: app.title,
    description: app.description,
    monogram: app.monogram,
    sourceClass: "first-party",
    platform: "ordax",
    compatibilityManaged: false,
    detailDisclosure: null,
  });
}

export function composeApplicationPresentations(firstPartyApps, installedCatalog) {
  if (!Array.isArray(firstPartyApps)) {
    throw new TypeError("First-party applications must be an array");
  }
  if (!installedCatalog || typeof installedCatalog.listPresentations !== "function") {
    throw new TypeError("Installed application presentation catalog is required");
  }

  const firstParty = firstPartyApps.map(firstPartyPresentation);
  const installed = installedCatalog.listPresentations();
  if (!Array.isArray(installed)) {
    throw new TypeError("Installed application presentations must be an array");
  }

  const combined = [...firstParty, ...installed];
  const ids = new Set();
  for (const app of combined) {
    if (ids.has(app.id)) {
      throw new TypeError(`Application presentation id collision: ${app.id}`);
    }
    ids.add(app.id);
  }

  return Object.freeze(combined);
}
