import { realpathSync, readFileSync, lstatSync } from "node:fs";
import { resolve, sep } from "node:path";

const HTML_PATH = "/system/composition/native/index.html";
const ASSET_PREFIX = "/__ordax/desktop-assets/assets/";
const CONTENT_TYPES = Object.freeze({
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff2: "font/woff2",
});
const HASHED_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.(?:js|css|html|png|svg|webp|woff2)$/;

export function createDesktopBuiltAssetsMiddleware(root) {
  const base = realpathSync(root);
  return function desktopBuiltAssets(request, response, next) {
    const url = (request.url ?? "").split("?")[0];
    const isHtml = url === HTML_PATH;
    const isAsset = url.startsWith(ASSET_PREFIX);
    if (!isHtml && !isAsset) return next();
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
      return response.end();
    }
    const filename = isHtml ? null : url.slice(ASSET_PREFIX.length);
    // Only one-level fingerprinted asset names are addressable. No directory
    // browse, symlink escapes, encoded separators or untrusted filesystem paths.
    if (isAsset && !HASHED_FILE.test(filename)) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      return response.end();
    }
    const source = isHtml
      ? resolve(base, "system/composition/native/index.html")
      : resolve(base, "assets", filename);
    try {
      if (!source.startsWith(base + sep)) throw Error("Asset outside root");
      if (!lstatSync(source).isFile() || realpathSync(source) !== source) {
        throw Error("Missing regular asset");
      }
      const ext = isHtml ? "html" : filename.slice(filename.lastIndexOf(".") + 1);
      const bytes = readFileSync(source);
      if (bytes.length > 8 * 1024 * 1024) throw Error("Oversized Desktop asset");
      response.writeHead(200, {
        "Content-Type": CONTENT_TYPES[ext],
        "Cache-Control": isHtml ? "no-store" : "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": bytes.length,
      });
      return response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(404, { "Cache-Control": "no-store" });
      return response.end();
    }
  };
}
