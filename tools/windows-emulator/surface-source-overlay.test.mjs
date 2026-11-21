import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createLocalSurfaceOverlayPlugin,
  resolveLocalSurfaceRoot,
  logicalSurfaceWatchIgnorePaths,
  virtualSurfaceAssetRedirect,
  logicalSurfaceAssetRedirect,
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
  put(surface, "system/surface/ui/tokens.css", ":root {}");
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
  // Vite can supply a physical checkout importer after transforming a
  // virtual Surface module. That must resolve to the same logical owners.
  assert.equal(plugin.resolveId("../../contracts/example.mjs", f.view), f.contract);
  assert.equal(plugin.resolveId("./sibling.mjs", f.view),
    SURFACE_OVERLAY_PREFIX + "system/surface/ui/sibling.mjs");
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

test("CSS uses Vite's physical pipeline while assets remain owner inputs", t => {
  const f = fixture(t);
  const plugin = createLocalSurfaceOverlayPlugin({ repoRoot: f.os, localSurface: f.surface });
  const cssId = plugin.resolveId("../../surface/ui/view.css", f.main);
  assert.equal(cssId, f.css);
  assert.equal(plugin.resolveId("/system/surface/ui/view.css", f.main), f.css);
  assert.equal(
    plugin.resolveId("./brand/mark.png", cssId),
    resolve(f.asset),
  );
  assert.equal(plugin.load.call({ addWatchFile() {} }, cssId), null);
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

test("local preview launches the existing Vite child with both editable owners and no Git sync", t => {
  const f = fixture(t);
  assert.equal(resolveLocalSurfaceRoot(f.os), f.surface);
  assert.equal(resolveLocalSurfaceRoot(f.os, f.surface), f.surface);
  assert.throws(() => resolveLocalSurfaceRoot(f.os, f.os), /separate/);
  assert.throws(() => resolveLocalSurfaceRoot(f.os, f.surface + "-absent"), /incomplete/);
  const dir = join(f.os, "tools/windows-emulator");
  mkdirSync(dir, {recursive:true});
  for (const name of ["dev-supervisor.mjs", "dev-restart-policy.mjs", "surface-source-overlay.mjs"]) {
    copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(dir, name));
  }
  mkdirSync(join(f.os, ".git")); // Would poll origin in ordinary mode.
  const vite = join(f.os, "node_modules/vite/bin");
  mkdirSync(vite, {recursive:true});
  writeFileSync(join(vite, "vite.js"), 'console.log(JSON.stringify({surface:process.env.ORDAX_DESKTOP_SURFACE_ROOT,host:process.env.ORDAX_EMULATOR_HOST,cwd:process.cwd()}));process.exit(17)');
  const env = {...process.env, ORDAX_DESKTOP_HOST:"0", ORDAX_EMULATOR_HOST:"0.0.0.0", ORDAX_EMULATOR_NO_BROWSER:"1"};
  const result = spawnSync(process.execPath, [join(dir,"dev-supervisor.mjs"), "--local"], {
    cwd:f.os, env, encoding:"utf8", timeout:8000,
  });
  assert.equal(result.status,17,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {surface:f.surface,host:"127.0.0.1",cwd:f.os});
  assert.match(result.stderr,/Git synchronization disabled/);
  assert.doesNotMatch(result.stderr,/remote main check|watching origin/);
});

test("missing explicit Surface source cannot fall through to stale OS visual copies", t => {
  const f = fixture(t);
  const stale = join(f.os,"system/surface/ui/missing.mjs");
  mkdirSync(dirname(stale),{recursive:true});
  writeFileSync(stale,"export const stale=true;");
  const plugin = createLocalSurfaceOverlayPlugin({repoRoot:f.os,localSurface:f.surface});
  assert.throws(() => plugin.resolveId("../../surface/ui/missing.mjs",f.main), /Surface overlay source missing/);
});

test("HTML styles and logical asset URLs redirect to the owner's physical Vite path", t => {
  const f = fixture(t);
  const fs = file => "/@fs/" + encodeURI(file.replaceAll("\\", "/"));
  assert.equal(logicalSurfaceAssetRedirect(f.surface, "/system/surface/ui/view.css?v=1"), fs(f.css) + "?v=1");
  assert.equal(logicalSurfaceAssetRedirect(f.surface, "/system/surface/ui/brand/mark.png"), fs(f.asset));
  assert.equal(logicalSurfaceAssetRedirect(f.surface, "/system/surface/ui/view.mjs"), null);
  assert.equal(logicalSurfaceAssetRedirect(f.surface, "/system/surface/ui/%2e%2e/view.css"), null);
  assert.equal(logicalSurfaceAssetRedirect(f.surface, "/system/surface/ui/missing.css"), null);
  const plugin = createLocalSurfaceOverlayPlugin({repoRoot:f.os,localSurface:f.surface});
  let middleware;
  plugin.configureServer({middlewares:{use:fn=>{middleware=fn;}}});
  const headers = {};
  const response = {statusCode:200,setHeader(k,v){headers[k]=v;},end(){this.ended=true;}};
  middleware({method:"GET",url:"/system/surface/ui/view.css"},response,()=>assert.fail("CSS not routed"));
  assert.equal(response.statusCode,302);
  assert.equal(headers.Location,fs(f.css));
  assert.equal(response.ended,true);
});
