import { validateComponentManifests } from "../../contracts/component-manifest.mjs";

export const SERVICE_UPDATE_INVENTORY_SCHEMA = "ordax.service-update-inventory/1";

// This is a read-only projection of the existing component catalog and source
// directory tree. It owns no version, release policy, grant or installed state.
const SERVICE_PATH = /^system\/services\/[a-z][a-z0-9-]*$/;

const DELIVERY = Object.freeze({
  "base-ab": "os-base-ab",
  bundled: "os-bundled",
  "git-app": "development-git-only",
  "component-slot": "individual-declared-not-production-proven",
});

function validatedServicePaths(paths) {
  if (!Array.isArray(paths)) {
    throw new TypeError("Service paths must be an array");
  }
  const sorted = paths.map((path) => {
    if (typeof path !== "string" || !SERVICE_PATH.test(path)) {
      throw new TypeError("Invalid canonical service directory path");
    }
    return path;
  }).sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new TypeError("Duplicate canonical service directory");
  }
  return sorted;
}

function declaredServicePaths(owner) {
  // Match canonical path tokens, not ambiguous substring prefixes.
  const sources = owner.match(/system\/services\/[a-z][a-z0-9-]*/g) ?? [];
  return [...new Set(sources)].sort();
}

export function deriveNativeServiceUpdateInventory({
  manifests,
  servicePaths,
} = {}) {
  const catalog = validateComponentManifests(manifests);
  const paths = validatedServicePaths(servicePaths);
  const present = new Set(paths);

  const components = catalog
    .map((component) => {
      const sources = declaredServicePaths(component.owner);
      for (const source of sources) {
        if (!present.has(source)) {
          throw new TypeError("Component owner references missing service directory: " + source);
        }
      }
      return Object.freeze({
        id: component.id,
        kind: component.kind,
        owner: component.owner,
        version: component.version,
        releaseMode: component.releaseMode,
        currentDelivery: DELIVERY[component.releaseMode],
        sourceDirectories: Object.freeze(sources),
        // Slot declaration is not proof of pinned trust, activation or rollback.
        releaseReadiness: "not-assessed-by-this-projection",
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const domains = paths.map((path) => {
    const linked = components.filter((component) => component.sourceDirectories.includes(path));
    return Object.freeze({
      path,
      componentIds: Object.freeze(linked.map((component) => component.id)),
      state: linked.length > 0
        ? "manifest-linked"
        : "embedded-domain-without-independent-component",
      // No inferred SemVer or implicit eligibility for domains lacking a manifest.
      releaseReadiness: "not-assessed-by-this-projection",
    });
  });

  return Object.freeze({
    schema: SERVICE_UPDATE_INVENTORY_SCHEMA,
    authority: "none",
    components: Object.freeze(components),
    domains: Object.freeze(domains),
    summary: Object.freeze({
      componentCount: components.length,
      domainCount: domains.length,
      embeddedDomainCount: domains.filter((domain) =>
        domain.state === "embedded-domain-without-independent-component").length,
      declaredIndividualCount: components.filter((component) =>
        component.releaseMode === "component-slot").length,
    }),
  });
}
