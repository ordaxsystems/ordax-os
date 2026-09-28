import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import {
  MAX_PROJECT_EVIDENCE_ITEMS,
  MAX_PROJECT_EVIDENCE_TEXT_CHARS,
  MAX_PROJECT_EVIDENCE_TOTAL_CHARS,
  PROJECT_EVIDENCE_SCHEMA,
} from "../system/contracts/project-evidence.mjs";
import { createProjectEvidenceRuntime } from "../system/services/projects/evidence-runtime.mjs";
import {
  PROJECT_EVIDENCE_CONTEXT_SOURCE_ID,
  createProjectEvidenceIntelligenceContext,
} from "../system/services/intelligence/project-evidence-context.mjs";
import { listFirstPartyGrantedIntelligenceContextSources } from "../system/services/intelligence/first-party-context-sources.mjs";

function projectCatalog() {
  const snapshot = Object.freeze({
    persistence: "device",
    projects: Object.freeze([Object.freeze({
      id: "project-1",
      name: "Projeto seguro",
      path: "/Documentos/ProjetoSeguro",
      createdAt: 10,
      lastOpenedAt: 20,
      lastFilePath: null,
    })]),
  });
  return Object.freeze({
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    create() {},
    rename() {},
    recordOpened() {},
    recordFileOpened() {},
    clearLastFile() {},
    relocateLastFilePath() {},
    remove() {},
  });
}

function fileSpaceFixture() {
  const calls = [];
  const forbidden = () => {
    throw new Error("mutating file-space method must never be called by Project Intelligence evidence");
  };
  const rootPath = "/Documentos/ProjetoSeguro";
  const listings = new Map([
    [rootPath, {
      path: rootPath,
      entries: [
        { name: "README.md", kind: "file", size: 120, modifiedAt: 30 },
        { name: "package.json", kind: "file", size: 90, modifiedAt: 31 },
        { name: "secrets.txt", kind: "file", size: 40, modifiedAt: 32 },
        { name: "tests", kind: "directory", size: 0, modifiedAt: 33 },
        { name: "docs", kind: "directory", size: 0, modifiedAt: 34 },
        { name: "src", kind: "directory", size: 0, modifiedAt: 35 },
      ],
    }],
    [`${rootPath}/tests`, {
      path: `${rootPath}/tests`,
      entries: [
        { name: "unit.mjs", kind: "file", size: 20, modifiedAt: 40 },
        { name: "integration", kind: "directory", size: 0, modifiedAt: 41 },
      ],
    }],
    [`${rootPath}/docs`, {
      path: `${rootPath}/docs`,
      entries: [{ name: "architecture.md", kind: "file", size: 30, modifiedAt: 42 }],
    }],
  ]);
  const text = new Map([
    [`${rootPath}/README.md`, "# Projeto seguro\nArquitetura local."],
    [`${rootPath}/package.json`, '{"name":"projeto-seguro","scripts":{"test":"node --test"}}'],
  ]);

  const port = Object.freeze({
    schema: FILE_SPACE_SCHEMA,
    async list(path) {
      calls.push(["list", path]);
      const value = listings.get(path);
      if (!value) throw new Error("unexpected list path");
      return value;
    },
    async readTextFile(path) {
      calls.push(["readTextFile", path]);
      const value = text.get(path);
      if (value === undefined) throw new Error("unexpected text path");
      return { path, size: value.length, text: value };
    },
    createDirectory: forbidden,
    renameEntry: forbidden,
    copyFile: forbidden,
    moveEntry: forbidden,
    trashEntry: forbidden,
    listTrash: forbidden,
    restoreTrashEntry: forbidden,
    exportFile: forbidden,
    importFile: forbidden,
  });
  return { port, calls, rootPath };
}

test("Project evidence scans only approved top-level files and shallow evidence directories", async () => {
  const files = fileSpaceFixture();
  const runtime = createProjectEvidenceRuntime({
    projects: projectCatalog(),
    fileSpace: files.port,
    now: () => 50,
  });

  assert.equal(runtime.schema, PROJECT_EVIDENCE_SCHEMA);
  const snapshot = await runtime.inspect("project-1");
  assert.equal(snapshot.projectId, "project-1");
  assert.equal(snapshot.capturedAt, 50);
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.authority, "none");
  assert.deepEqual(snapshot.items.map((item) => item.kind), ["readme", "manifest", "tests", "docs"]);
  assert.deepEqual(files.calls, [
    ["list", files.rootPath],
    ["readTextFile", `${files.rootPath}/README.md`],
    ["readTextFile", `${files.rootPath}/package.json`],
    ["list", `${files.rootPath}/tests`],
    ["list", `${files.rootPath}/docs`],
  ]);
  assert.equal(files.calls.some(([, path]) => path.endsWith("secrets.txt")), false);
  assert.equal(files.calls.some(([, path]) => path.endsWith("/src")), false);
  assert.equal(files.calls.some(([, path]) => path.includes("/tests/integration")), false);
});

test("Project evidence context never exposes the project path and remains bounded", async () => {
  const files = fileSpaceFixture();
  const runtime = createProjectEvidenceRuntime({
    projects: projectCatalog(),
    fileSpace: files.port,
    now: () => 50,
  });
  const snapshot = await runtime.inspect("project-1");
  const context = createProjectEvidenceIntelligenceContext(snapshot);
  const serialized = JSON.stringify(context);

  assert.ok(context.length <= MAX_PROJECT_EVIDENCE_ITEMS);
  assert.ok(context.every((entry) => entry.scope === "workspace"));
  assert.ok(context.every((entry) => entry.text.length <= MAX_PROJECT_EVIDENCE_TEXT_CHARS + 256));
  assert.ok(context.reduce((sum, entry) => sum + entry.text.length, 0) <= MAX_PROJECT_EVIDENCE_TOTAL_CHARS + 4096);
  assert.equal(serialized.includes(files.rootPath), false);
  assert.equal(serialized.includes("secrets.txt"), false);
  assert.equal(serialized.includes("tool-grant"), false);
  assert.match(context[0].id, new RegExp(`^${PROJECT_EVIDENCE_CONTEXT_SOURCE_ID}-project-1-`));
});

test("Project evidence source is explicit and unknown project ids fail closed", async () => {
  const source = listFirstPartyGrantedIntelligenceContextSources().find(
    (entry) => entry.id === PROJECT_EVIDENCE_CONTEXT_SOURCE_ID,
  );
  assert.ok(source);

  const files = fileSpaceFixture();
  const runtime = createProjectEvidenceRuntime({
    projects: projectCatalog(),
    fileSpace: files.port,
  });
  await assert.rejects(() => runtime.inspect("project-2"), /target is unavailable/);
  assert.deepEqual(files.calls, []);
});
