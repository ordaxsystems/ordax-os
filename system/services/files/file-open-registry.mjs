import { validateFileAssociationManifest } from "../../contracts/file-association-manifest.mjs";

export const FILE_OPEN_REGISTRY_SCHEMA = "ordax.file-open-registry/1";

function extensionFromPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) return null;
  const slash = path.lastIndexOf("/");
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  return extension || null;
}

export function createFileOpenRegistry({
  manifests = [],
  isAppAvailable = () => false,
} = {}) {
  if (!Array.isArray(manifests)) {
    throw new TypeError("File-open registry manifests must be an array");
  }
  if (typeof isAppAvailable !== "function") {
    throw new TypeError("File-open registry availability resolver must be a function");
  }

  const handlers = new Map();
  for (const value of manifests) {
    const manifest = validateFileAssociationManifest(value);
    for (const extension of manifest.extensions) {
      if (handlers.has(extension)) {
        throw new TypeError(
          `File association conflict for .${extension}: ${handlers.get(extension).appId} and ${manifest.appId}`,
        );
      }
      handlers.set(extension, Object.freeze({
        appId: manifest.appId,
        appVersion: manifest.appVersion,
        role: manifest.role,
      }));
    }
  }

  return Object.freeze({
    schema: FILE_OPEN_REGISTRY_SCHEMA,
    resolve(path) {
      const extension = extensionFromPath(path);
      if (extension === null) {
        return Object.freeze({ state: "unsupported", extension: null, appId: null, role: null });
      }
      const handler = handlers.get(extension) ?? null;
      if (handler === null) {
        return Object.freeze({ state: "unsupported", extension, appId: null, role: null });
      }
      const available = isAppAvailable(handler.appId) === true;
      return Object.freeze({
        state: available ? "ready" : "handler-unavailable",
        extension,
        appId: handler.appId,
        role: handler.role,
      });
    },
    list() {
      return Object.freeze(
        [...handlers.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([extension, handler]) => Object.freeze({
            extension,
            appId: handler.appId,
            appVersion: handler.appVersion,
            role: handler.role,
          })),
      );
    },
  });
}
