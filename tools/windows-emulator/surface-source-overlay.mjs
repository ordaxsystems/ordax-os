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
const STATIC_ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".avif", ".woff", ".woff2", ".ttf", ".otf",
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

// Runtime `new URL('./image.png', import.meta.url)` inside a virtual JS module
// produces a virtual-path image URL. Only redirect verified static assets to
// Vite's existing /@fs/ handler (which enforces its configured fs.allow).
// Do not serve binary bytes or introduce a parallel static-file authority.
export function virtualSurfaceAssetRedirect(surfaceRoot, requestUrl) {
  if (typeof requestUrl !== "string") return null;
  let decoded;
  try { decoded = decodeURIComponent(requestUrl.split("?")[0]); }
  catch { return null; }
  if (!decoded.startsWith("/" + OVERLAY_PREFIX)) return null;
  const logical = decoded.slice(OVERLAY_PREFIX.length + 1);
  if (!VISUAL_ROOTS.some(prefix => logical.startsWith(prefix + "/"))) return null;
  if (!STATIC_ASSET_EXTENSIONS.has(extname(logical).toLowerCase())) return null;
  let found;
  try { found = resolveSurfaceFile(surfaceRoot, logical); }
  catch { return null; }
  if (!found || !VISUAL_ROOTS.some(prefix => found.logicalRelative.startsWith(prefix + "/")))
    return null;
  const absolute = found.physical.split(sep).join("/");
  return "/@fs/" + encodeURI(absolute).replaceAll("#", "%23").replaceAll("?", "%3F");
}

// HTML links and CSS asset URLs bypass Vite's JS module resolver. Route
// those same-owner files to Vite's real filesystem handler, never a shadow
// file in the OS checkout. JS imports continue through the virtual overlay.
export function logicalSurfaceAssetRedirect(surfaceRoot, requestUrl) {
  if (typeof requestUrl !== "string") return null;
  const parsed = stripQuery(requestUrl);
  let decoded;
  try { decoded = decodeURIComponent(parsed.path); }
  catch { return null; }
  if (!decoded.startsWith("/system/surface/")) return null;
  const logical = decoded.slice(1);
  if (!VISUAL_ROOTS.some(prefix => logical.startsWith(prefix + "/")) ||
      logical.split("/").some(part => !part || part === "." || part === "..") ||
      logical.includes("\\") || logical.includes("\0")) return null;
  const extension = extname(logical).toLowerCase();
  if (extension !== ".css" && !STATIC_ASSET_EXTENSIONS.has(extension)) return null;
  const found = resolveSurfaceFile(surfaceRoot, logical);
  if (!found || found.logicalRelative !== logical) return null;
  const absolute = found.physical.split(sep).join("/");
  return "/@fs/" + encodeURI(absolute).replaceAll("#", "%23").replaceAll("?", "%3F") + parsed.query;
}

// Explicit developer preview consumes the owner's actual visual checkout,
// not a copied or pinned delivery. It never changes either Git worktree.
export function resolveLocalSurfaceRoot(repoRoot, explicitRoot) {
  const root = resolve(repoRoot);
  const surface = explicitRoot ? resolve(explicitRoot) : resolve(root, "../ordax-surface");
  if (surface === root || inside(root, surface) || inside(surface, root))
    throw new Error("Surface checkout must be separate from the OS checkout");
  if (!regular(resolve(surface, "system/surface/ui/tokens.css")) ||
      !lstatSync(resolve(surface, "system/surface/workspace"), { throwIfNoEntry: false })?.isDirectory())
    throw new Error("local Surface checkout is incomplete: " + surface);
  return surface;
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
    const physicalBase = importerPath(importer, root);
    // Vite sometimes reports the real Surface checkout path as importer,
    // rather than the virtual overlay ID. Keep relative imports anchored to
    // the logical OS namespace so contracts still resolve to their owner.
    const surfaceRelative = physicalBase && inside(surface, physicalBase)
      ? relative(surface, physicalBase).split(sep).join("/") : null;
    const logicalBase = surfaceRelative === null ? null
      : resolve(root, ...surfaceRelative.split("/"));
    const surfaceImporter = logicalBase && visualRelative(root, logicalBase) !== null;
    const base = surfaceImporter ? logicalBase : physicalBase;
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
    if (VISUAL_ROOTS.some(prefix => parsed.path.startsWith("/" + prefix + "/"))) {
      return Object.freeze({
        target: resolve(root, ...parsed.path.slice(1).split("/")),
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
    return Object.freeze({ target, query: parsed.query, physicalSurfaceImporter: Boolean(surfaceImporter) });
  }

  return {
    name: "ordax-local-surface-overlay",
    enforce: "pre",

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") return next();
        const redirect = logicalSurfaceAssetRedirect(surface, request.url) ??
          virtualSurfaceAssetRedirect(surface, request.url);
        if (!redirect) return next();
        response.statusCode = 302;
        response.setHeader("Location", redirect);
        response.setHeader("Cache-Control", "no-store");
        response.end();
      });
    },

    resolveId(source, importer) {
      if (typeof source !== "string" || source.startsWith(OVERLAY_PREFIX)) return null;
      const resolved = logicalFromSource(source, importer);
      if (!resolved) return null;
      const logicalRelative = visualRelative(root, resolved.target);
      if (logicalRelative !== null) {
        const found = resolveSurfaceFile(surface, logicalRelative);
        if (!found) throw new Error("Surface overlay source missing: " + logicalRelative);
        // CSS uses Vite's physical CSS pipeline (including its file watcher
        // and relative url()/@import processing), rather than a virtual JS ID.
        if (extname(found.physical) === ".css" || !SOURCE_EXTENSIONS.has(extname(found.physical)))
          return found.physical + resolved.query;
        return overlayId(found.logicalRelative, resolved.query);
      }
      if (importer?.startsWith(OVERLAY_PREFIX) || resolved.physicalSurfaceImporter)
        return resolved.target + resolved.query;
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

    // The Surface lives outside Vite's logical OS root. For JS/TS sources
    // loaded through virtual overlay IDs, an on-disk change can have no HMR
    // boundary in the module graph and silently leave the running UI stale.
    // Reuse Vite's existing file watcher and channel; never create another.
    hotUpdate({ type, file, server }) {
      if (type !== "update" || (this.environment?.name && this.environment.name !== "client")) return;
      const physical = resolve(file);
      if (!inside(surface, physical) || !regular(physical)) return;
      const logical = relative(surface, physical).split(sep).join("/");
      if (!VISUAL_ROOTS.some(prefix => logical.startsWith(prefix + "/"))) return;
      const extension = extname(physical);
      if (extension === ".css" || !SOURCE_EXTENSIONS.has(extension)) return;
      // Vite caches transformed virtual modules under the overlay ID, not the
      // physical checkout path. Invalidate that entry before asking the client
      // to reload, or the new page may receive the previous JS bytes.
      const graph = server.environments?.client?.moduleGraph ?? server.moduleGraph;
      const module = graph?.getModuleById?.(overlayId(logical));
      if (module) graph.invalidateModule(module);
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}

export const SURFACE_OVERLAY_PREFIX = OVERLAY_PREFIX;
