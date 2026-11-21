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

/**
 * The Native Home can link to the real Aura app only after the OS-provided
 * signed component catalog exposes its canonical "assistant" install slot.
 * This is presentation gating, not model access or execution authorization.
 */
function isNativeHomeInstalledApp(app, catalog, capabilityIds) {
  return app?.component?.kind === "app"
    && app.component.releaseMode === "component-slot"
    && app.panels?.length === 1
    && app.panels[0]?.kind === "extension"
    && app.panels[0]?.extensionId === app.id
    && catalog.isAvailable(app, capabilityIds);
}

export function nativeHomeAssistantApp(catalog, capabilityIds) {
  const app = catalog.get("assistant");
  return isNativeHomeInstalledApp(app, catalog, capabilityIds) ? app : null;
}

// Installed component slots are supplied by the OS-owned runtime catalog.
// Navigation uses the full list, never a second local registry or discovery
// mechanism; revoked capabilities and removed slots disappear on next render.
export function nativeNavigationInstalledApps(catalog, capabilityIds) {
  return Object.freeze(catalog.list()
    .filter((app) => isNativeHomeInstalledApp(app, catalog, capabilityIds)));
}

// The Home is a small quick-access projection, not a second app registry.
// Aura already has its dedicated Home tile and must not appear twice.
export function nativeHomeInstalledApps(catalog, capabilityIds) {
  return Object.freeze(nativeNavigationInstalledApps(catalog, capabilityIds)
    .filter((app) => app.id !== "assistant")
    .slice(0, 4));
}
