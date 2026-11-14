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
