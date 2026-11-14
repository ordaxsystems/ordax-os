import { lstatSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const OVERLAY_PREFIX = "\0ordax-surface-overlay:";
const VISUAL_ROOTS = Object.freeze([
  "system/surface/ui",
  "system/surface/workspace",
]);
const SOURCE_EXTENSIONS = new Set([
  ".mjs", ".js", ".cjs", ".ts", ".tsx", ".jsx", ".css",
]);
const RESOLVE_EXTENSIONS = Object.freeze([
  "", ".mjs", ".js", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".json",
]);

function inside(root, target) {
  const value = relative(root, target);
  return value === "" || (!value.startsWith(".." + sep) && value !== ".." && !isAbsolute(value));
}

function stripQuery(value) {
  const index = value.indexOf("?");
  return index < 0
    ? Object.freeze({ path: value, query: "" })
    : Object.freeze({ path: value.slice(0, index), query: value.slice(index) });
}

function importerPath(importer, repoRoot) {
  if (!importer) return null;
  if (importer.startsWith(OVERLAY_PREFIX)) {
    const { path } = stripQuery(importer.slice(OVERLAY_PREFIX.length));
    return resolve(repoRoot, ...path.split("/"));
  }
  const { path } = stripQuery(importer);
  const decoded = path.startsWith("file:") ? fileURLToPath(path) : path;
  return isAbsolute(decoded) ? resolve(decoded) : null;
}

function visualRelative(repoRoot, logicalPath) {
  for (const prefix of VISUAL_ROOTS) {
    const root = resolve(repoRoot, ...prefix.split("/"));
    if (inside(root, logicalPath)) {
      return relative(repoRoot, logicalPath).split(sep).join("/");
    }
  }
  return null;
}

function physicalVisualRelative(surfaceRoot, path) {
  const target = resolve(surfaceRoot, ...path.split("/"));
  if (!inside(surfaceRoot, target)) throw new Error("Surface overlay path escaped source root");
  return target;
}

function regular(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function resolveSurfaceFile(surfaceRoot, logicalRelative) {
  const initial = physicalVisualRelative(surfaceRoot, logicalRelative);
  const extension = extname(initial);
  const candidates = extension
    ? [initial]
    : [
        ...RESOLVE_EXTENSIONS.map(suffix => initial + suffix),
        ...RESOLVE_EXTENSIONS.slice(1).map(suffix => resolve(initial, "index" + suffix)),
      ];
  for (const candidate of candidates) {
    if (regular(candidate)) {
      const relativeToSurface = relative(surfaceRoot, candidate).split(sep).join("/");
      return Object.freeze({ physical: candidate, logicalRelative: relativeToSurface });
    }
  }
  return null;
}

function overlayId(logicalRelative, query = "") {
  return OVERLAY_PREFIX + logicalRelative + query;
}

export function logicalSurfaceWatchIgnorePaths(repoRoot) {
  if (typeof repoRoot !== "string" || !isAbsolute(repoRoot))
    throw new TypeError("Surface overlay repoRoot must be absolute");
  // Chokidar/readdirp lstat children before applying a child-level ignore.
  // Ignore the real parent boundary so Windows junctions under it are never
  // traversed by the OS watcher. The physical Surface checkout is watched
  // independently by addWatchFile() from the overlay plugin.
  return Object.freeze([resolve(repoRoot, "system/surface")]);
}

export function createLocalSurfaceOverlayPlugin({ repoRoot, localSurface }) {
  if (typeof repoRoot !== "string" || !isAbsolute(repoRoot))
    throw new TypeError("Surface overlay repoRoot must be absolute");
  if (typeof localSurface !== "string" || !isAbsolute(localSurface))
    throw new TypeError("Surface overlay source must be absolute");

  const root = resolve(repoRoot);
  const surface = resolve(localSurface);

  function logicalFromSource(source, importer) {
    const parsed = stripQuery(source);
    const base = importerPath(importer, root);
    if (parsed.path === "@" || parsed.path.startsWith("@/")) {
      const rest = parsed.path === "@" ? "" : parsed.path.slice(2);
      return Object.freeze({
        target: resolve(root, "system/surface/workspace", ...rest.split("/").filter(Boolean)),
        query: parsed.query,
      });
    }
    if (parsed.path === "@ordax-brand" || parsed.path.startsWith("@ordax-brand/")) {
      const rest = parsed.path === "@ordax-brand" ? "" : parsed.path.slice("@ordax-brand/".length);
      return Object.freeze({
        target: resolve(root, "system/surface/ui/brand", ...rest.split("/").filter(Boolean)),
        query: parsed.query,
      });
    }
    if (isAbsolute(parsed.path) && inside(surface, resolve(parsed.path))) {
      const relativeToSurface = relative(surface, resolve(parsed.path)).split(sep).join("/");
      return Object.freeze({
        target: resolve(root, ...relativeToSurface.split("/")),
        query: parsed.query,
      });
    }
    if (!base || !parsed.path.startsWith(".")) return null;
    const target = resolve(dirname(base), parsed.path);
    if (!inside(root, target))
      throw new Error("Surface overlay import escaped OS source root");
    return Object.freeze({ target, query: parsed.query });
  }

  return {
    name: "ordax-local-surface-overlay",
    enforce: "pre",

    resolveId(source, importer) {
      if (typeof source !== "string" || source.startsWith(OVERLAY_PREFIX)) return null;
      const resolved = logicalFromSource(source, importer);
      if (!resolved) return null;
      const logicalRelative = visualRelative(root, resolved.target);
      if (logicalRelative !== null) {
        const found = resolveSurfaceFile(surface, logicalRelative);
        if (!found) return null;
        if (!SOURCE_EXTENSIONS.has(extname(found.physical)))
          return found.physical + resolved.query;
        return overlayId(found.logicalRelative, resolved.query);
      }
      if (importer?.startsWith(OVERLAY_PREFIX)) return resolved.target + resolved.query;
      return null;
    },

    load(id) {
      if (typeof id !== "string" || !id.startsWith(OVERLAY_PREFIX)) return null;
      const parsed = stripQuery(id.slice(OVERLAY_PREFIX.length));
      const found = resolveSurfaceFile(surface, parsed.path);
      if (!found) throw new Error("Verified Surface overlay source disappeared: " + parsed.path);
      this.addWatchFile(found.physical);
      return readFileSync(found.physical, "utf8");
    },
  };
}

export const SURFACE_OVERLAY_PREFIX = OVERLAY_PREFIX;
