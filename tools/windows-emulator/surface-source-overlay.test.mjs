import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createLocalSurfaceOverlayPlugin,
  logicalSurfaceWatchIgnorePaths,
  virtualSurfaceAssetRedirect,
  SURFACE_OVERLAY_PREFIX,
} from "./surface-source-overlay.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ordax-surface-overlay-"));
  const os = join(root, "ordax-os");
  const surface = join(root, "ordax-surface");
  const put = (base, relative, body = "") => {
    const target = join(base, ...relative.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    return target;
  };
  const main = put(os, "system/composition/native/main.mjs", "// main");
  const contract = put(os, "system/contracts/example.mjs", "export const owner='os';");
  const view = put(surface, "system/surface/ui/view.mjs",
    "import { owner } from '../../contracts/example.mjs';\nexport { owner };\n");
  const sibling = put(surface, "system/surface/ui/sibling.mjs", "export const sibling=true;\n");
  const css = put(surface, "system/surface/ui/view.css", ".x{background:url('./brand/mark.png')}\n");
  const asset = put(surface, "system/surface/ui/brand/mark.png", "asset");
  const workspace = put(surface, "system/surface/workspace/components/ui/button.tsx",
    "export const Button=()=>null;\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { os, surface, main, contract, view, sibling, css, asset, workspace };
}

test("DEV overlay keeps Surface modules in the logical OS namespace", async t => {
  const f = fixture(t);
  const plugin = createLocalSurfaceOverlayPlugin({ repoRoot: f.os, localSurface: f.surface });
  const id = plugin.resolveId("../../surface/ui/view.mjs", f.main);
  assert.equal(id, SURFACE_OVERLAY_PREFIX + "system/surface/ui/view.mjs");
  const watched = [];
  const source = plugin.load.call({ addWatchFile: file => watched.push(file) }, id);
  assert.match(source, /contracts\/example\.mjs/);
  assert.deepEqual(watched, [f.view]);

  assert.equal(
    plugin.resolveId("../../contracts/example.mjs", id),
    resolve(f.contract),
    "Surface imports outside its visual boundary resolve back to OS authority",
  );
  assert.equal(
    plugin.resolveId("./sibling.mjs", id),
    SURFACE_OVERLAY_PREFIX + "system/surface/ui/sibling.mjs",
  );
});

test("workspace and brand aliases use verified Surface bytes without a junction", t => {
  const f = fixture(t);
  const plugin = createLocalSurfaceOverlayPlugin({ repoRoot: f.os, localSurface: f.surface });
  assert.equal(
    plugin.resolveId("@/components/ui/button", f.main),
    SURFACE_OVERLAY_PREFIX + "system/surface/workspace/components/ui/button.tsx",
  );
  assert.equal(
    plugin.resolveId("@ordax-brand/mark.png", f.main),
    resolve(f.asset),
  );
  assert.equal(
    plugin.resolveId(resolve(f.workspace), f.main),
    SURFACE_OVERLAY_PREFIX + "system/surface/workspace/components/ui/button.tsx",
  );
});

test("CSS stays overlaid while binary assets remain physical read-only inputs", t => {
  const f = fixture(t);
  const plugin = createLocalSurfaceOverlayPlugin({ repoRoot: f.os, localSurface: f.surface });
  const cssId = plugin.resolveId("../../surface/ui/view.css", f.main);
  assert.equal(cssId, SURFACE_OVERLAY_PREFIX + "system/surface/ui/view.css");
  assert.equal(
    plugin.resolveId("./brand/mark.png", cssId),
    resolve(f.asset),
  );
  assert.equal(plugin.load.call({ addWatchFile() {} }, cssId), ".x{background:url('./brand/mark.png')}\n");
});

test("overlay rejects relative traversal outside the OS source root", t => {
  const f = fixture(t);
  const plugin = createLocalSurfaceOverlayPlugin({ repoRoot: f.os, localSurface: f.surface });
  const id = SURFACE_OVERLAY_PREFIX + "system/surface/ui/view.mjs";
  assert.throws(
    () => plugin.resolveId("../../../../../../outside.mjs", id),
    /escaped OS source root/,
  );
});

test("watcher stops at the real Surface parent before Windows junction children", t => {
  const f = fixture(t);
  assert.deepEqual(logicalSurfaceWatchIgnorePaths(f.os), [
    join(f.os, "system/surface"),
  ]);
  assert.equal(
    logicalSurfaceWatchIgnorePaths(f.os).some(path => path.startsWith(f.surface)),
    false,
    "physical Surface checkout must remain outside ignored logical mounts",
  );
});

test("overlay requires absolute, explicit roots", () => {
  assert.throws(
    () => createLocalSurfaceOverlayPlugin({ repoRoot: ".", localSurface: "surface" }),
    /repoRoot must be absolute/,
  );
});

test("physical Surface JS changes refresh the existing Vite client without a second watcher", t => {
  const f = fixture(t);
  const plugin = createLocalSurfaceOverlayPlugin({ repoRoot: f.os, localSurface: f.surface });
  const emitted = [];
  const invalidated = [];
  const tracked = { id: SURFACE_OVERLAY_PREFIX + "system/surface/ui/view.mjs" };
  const graph = {
    getModuleById: id => id === tracked.id ? tracked : undefined,
    invalidateModule: module => invalidated.push(module),
  };
  const context = { environment: { name: "client" } };
  const update = (file, type = "update", owner = context) =>
    plugin.hotUpdate.call(owner, {
      file, type, server: {
        environments: { client: { moduleGraph: graph } },
        ws: { send: payload => emitted.push(payload) },
      },
    });
  assert.deepEqual(update(f.view), []);
  assert.deepEqual(invalidated, [tracked], "Cached virtual JS must be invalidated before reload");
  assert.deepEqual(emitted, [{ type: "full-reload" }]);
  assert.equal(update(f.css), undefined, "CSS must retain its existing no-reload HMR path");
  assert.equal(update(f.contract), undefined, "OS modules are not owned by the Surface overlay");
  assert.equal(update(f.view, "create"), undefined, "A new file alone is not a running module update");
  assert.equal(update(f.view, "update", { environment: { name: "ssr" } }), undefined);
  assert.deepEqual(emitted, [{ type: "full-reload" }], "Only the verified browser JS update may trigger a reload");
});

test("virtual-module image URL redirects to Vite existing allowlisted filesystem handler", t => {
  const f = fixture(t);
  const url = "/%00ordax-surface-overlay:system/surface/ui/brand/mark.png";
  const expected = "/@fs/" + encodeURI(f.asset.replaceAll("\\", "/"));
  assert.equal(virtualSurfaceAssetRedirect(f.surface, url), expected);
  assert.equal(virtualSurfaceAssetRedirect(f.surface, url + "?cache=1"), expected);
  assert.equal(virtualSurfaceAssetRedirect(f.surface, "/%00ordax-surface-overlay:system/surface/ui/view.mjs"), null);
  assert.equal(virtualSurfaceAssetRedirect(f.surface, "/%00ordax-surface-overlay:system/surface/ui/brand/missing.png"), null);
  assert.equal(virtualSurfaceAssetRedirect(f.surface, "/%00ordax-surface-overlay:system/surface/ui/../../../contracts/secret.png"), null);
  assert.equal(virtualSurfaceAssetRedirect(f.surface, "/%00ordax-surface-overlay:system/other/mark.png"), null);
  assert.equal(virtualSurfaceAssetRedirect(f.surface, "/%ZZbad"), null);
  assert.equal(virtualSurfaceAssetRedirect(f.surface, "/system/surface/ui/brand/mark.png"), null);
  const plugin = createLocalSurfaceOverlayPlugin({ repoRoot:f.os,localSurface:f.surface });
  let middleware;
  plugin.configureServer({ middlewares: { use: fn => { middleware = fn; } } });
  const headers = {};
  const response = { statusCode:200, setHeader:(key,value)=>{headers[key]=value}, end(){this.ended=true} };
  let nextCalled=false;
  middleware({ method:"GET",url },response,()=>{nextCalled=true});
  assert.equal(nextCalled,false);
  assert.equal(response.statusCode,302);
  assert.equal(response.ended,true);
  assert.equal(headers.Location,expected);
  const rejected={ statusCode:200, setHeader(){throw Error("Must not redirect")}, end(){throw Error("Must not respond")} };
  middleware({ method:"POST",url },rejected,()=>{nextCalled=true});
  assert.equal(nextCalled,true);
});
