import assert from "node:assert/strict";
import test from "node:test";

import { createNativeFileSpace } from "../system/adapters/native/file-space.mjs";
import { createProjectCatalogRuntime } from "../system/services/files/projects.mjs";
import { createProjectContinuityFileSpace } from "../system/services/files/project-continuity-file-space.mjs";

function harness() {
  const root = { path: "/", entries: [] };
  let payload = { path: "/Outra", entries: [] };
  const requests = [];
  const host = {
    async fetch(url, options) {
      requests.push([url, options?.method]);
      return {
        ok: true,
        status: 200,
        async json() {
          return url === "/__ordax/native/files?path=%2F" ? root : payload;
        },
      };
    },
  };
  return {
    host,
    requests,
    setPayload(value) { payload = value; },
  };
}

test("native File Space rejects cross-path listings before exposing successful operations", async () => {
  const h = harness();
  const files = await createNativeFileSpace(h.host);
  const cases = [
    () => files.list("/Documentos"),
    () => files.createDirectory("/Documentos", "Pasta"),
    () => files.renameEntry("/Documentos", "a.txt", "b.txt"),
    () => files.copyFile("/Documentos", "a.txt", "/Downloads", "b.txt"),
    () => files.moveEntry("/Documentos", "a.txt", "/Downloads"),
    () => files.trashEntry("/Documentos", "a.txt"),
    () => files.importFile("/Documentos", "a.txt", new Uint8Array([1])),
  ];
  for (const operation of cases) {
    await assert.rejects(operation(), /listing path differs from requested path/);
  }
  h.setPayload({ path: "/Documentos", entries: [] });
  const listed = await files.createDirectory("/Documentos", "Nova");
  assert.equal(listed.path, "/Documentos");
  h.setPayload({ path: "/Downloads", entries: [] });
  assert.equal((await files.copyFile("/Documentos", "a.txt", "/Downloads", "b.txt")).path, "/Downloads");
  assert.equal((await files.moveEntry("/Documentos", "a.txt", "/Downloads")).path, "/Downloads");
});

test("native text preview also binds its response to the exact requested file", async () => {
  const h = harness();
  const files = await createNativeFileSpace(h.host);
  h.setPayload({ path: "/Documentos/outro.txt", size: 2, text: "ok" });
  await assert.rejects(files.readTextFile("/Documentos/nota.txt"), /text path differs from requested path/);
  h.setPayload({ path: "/Documentos/nota.txt", size: 2, text: "ok" });
  assert.equal((await files.readTextFile("/Documentos/nota.txt")).text, "ok");
});

test("project continuity does not mutate when native mutation returns an unrelated folder", async () => {
  const h = harness();
  const native = await createNativeFileSpace(h.host);
  const projects = createProjectCatalogRuntime({ now: () => 100 });
  const project = projects.create({ name: "Projeto A", path: "/Documentos/A" }).projects[0];
  projects.recordFileOpened(project.id, "/Documentos/A/pasta/nota.txt");
  const files = createProjectContinuityFileSpace(native, projects);
  const before = projects.getSnapshot();
  await assert.rejects(
    files.renameEntry("/Documentos/A", "pasta", "renomeada"),
    /listing path differs from requested path/,
  );
  assert.deepEqual(projects.getSnapshot(), before);
  h.setPayload({ path: "/Documentos/A", entries: [] });
  await files.renameEntry("/Documentos/A", "pasta", "renomeada");
  const current = projects.getSnapshot().projects.find((entry) => entry.id === project.id);
  assert.equal(current.lastFilePath, "/Documentos/A/renomeada/nota.txt");
});
