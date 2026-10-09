import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import { mountFileSpaceControls } from "../system/surface/ui/file-space-controls.mjs";
import { createProjectCatalogRuntime } from "../system/services/files/projects.mjs";
import { createProjectContinuityFileSpace } from "../system/services/files/project-continuity-file-space.mjs";

test("Files UI module resolves existing platform contracts", () => {
  assert.equal(typeof mountFileSpaceControls, "function");
});

function emptyListing(path) {
  return Object.freeze({ path, entries: Object.freeze([]) });
}

function createFileSpace({ failRename = false, failMove = false, failTrash = false } = {}) {
  const calls = [];
  const port = {
    schema: FILE_SPACE_SCHEMA,
    async list(path) {
      calls.push(["list", path]);
      return emptyListing(path);
    },
    async createDirectory(path, name) {
      calls.push(["createDirectory", path, name]);
      return emptyListing(path);
    },
    async readTextFile(path) {
      calls.push(["readTextFile", path]);
      return Object.freeze({ path, size: 0, text: "" });
    },
    async renameEntry(path, name, newName) {
      calls.push(["renameEntry", path, name, newName]);
      if (failRename) throw new Error("rename failed");
      return emptyListing(path);
    },
    async copyFile(sourcePath, sourceName, destinationPath, destinationName) {
      calls.push(["copyFile", sourcePath, sourceName, destinationPath, destinationName]);
      return emptyListing(destinationPath);
    },
    async moveEntry(sourcePath, name, destinationPath) {
      calls.push(["moveEntry", sourcePath, name, destinationPath]);
      if (failMove) throw new Error("move failed");
      return emptyListing(destinationPath);
    },
    async trashEntry(path, name) {
      calls.push(["trashEntry", path, name]);
      if (failTrash) throw new Error("trash failed");
      return emptyListing(path);
    },
    async listTrash() {
      calls.push(["listTrash"]);
      return Object.freeze({ entries: Object.freeze([]) });
    },
    async restoreTrashEntry(id) {
      calls.push(["restoreTrashEntry", id]);
      return Object.freeze({ entries: Object.freeze([]) });
    },
    async exportFile(path) {
      calls.push(["exportFile", path]);
      return true;
    },
    async importFile(path, name, bytes) {
      calls.push(["importFile", path, name, bytes.byteLength]);
      return emptyListing(path);
    },
  };
  return Object.freeze({ port: Object.freeze(port), calls });
}

function createProjectWithLastFile(filePath = "/Documentos/A/pasta/contexto.txt") {
  let clock = 100;
  const projects = createProjectCatalogRuntime({ now: () => clock++ });
  projects.create({ name: "Projeto A", path: "/Documentos/A" });
  projects.create({ name: "Projeto B", path: "/Documentos/B" });
  projects.recordFileOpened("project-1", filePath);
  return projects;
}

test("rename and move relocate project continuity only after file-space success", async () => {
  const projects = createProjectWithLastFile();
  const { port } = createFileSpace();
  const files = createProjectContinuityFileSpace(port, projects);

  await files.renameEntry("/Documentos/A", "pasta", "renomeada");
  let projectA = projects.getSnapshot().projects.find((project) => project.id === "project-1");
  assert.equal(projectA.lastFilePath, "/Documentos/A/renomeada/contexto.txt");

  await files.moveEntry("/Documentos/A", "renomeada", "/Downloads");
  projectA = projects.getSnapshot().projects.find((project) => project.id === "project-1");
  const projectB = projects.getSnapshot().projects.find((project) => project.id === "project-2");
  assert.equal(projectA.lastFilePath, null);
  assert.equal(projectB.lastFilePath, null);
});

test("trash clears affected project continuity only after file-space success", async () => {
  const projects = createProjectWithLastFile();
  const { port } = createFileSpace();
  const files = createProjectContinuityFileSpace(port, projects);

  await files.trashEntry("/Documentos/A", "pasta");
  const projectA = projects.getSnapshot().projects.find((project) => project.id === "project-1");
  assert.equal(projectA.lastFilePath, null);

  const failedProjects = createProjectWithLastFile();
  const failedFiles = createProjectContinuityFileSpace(
    createFileSpace({ failTrash: true }).port,
    failedProjects,
  );
  const before = failedProjects.getSnapshot();
  await assert.rejects(
    failedFiles.trashEntry("/Documentos/A", "pasta"),
    /trash failed/,
  );
  assert.deepEqual(failedProjects.getSnapshot(), before);
});

test("trash listing and restore are proxied without inventing project continuity", async () => {
  const projects = createProjectWithLastFile();
  const { port, calls } = createFileSpace();
  const files = createProjectContinuityFileSpace(port, projects);
  const before = projects.getSnapshot();

  await files.listTrash();
  await files.restoreTrashEntry("0123456789abcdef0123456789abcdef");

  assert.deepEqual(projects.getSnapshot(), before);
  assert.deepEqual(calls.slice(-2), [
    ["listTrash"],
    ["restoreTrashEntry", "0123456789abcdef0123456789abcdef"],
  ]);
});

test("copy never changes project continuity", async () => {
  const projects = createProjectWithLastFile();
  const before = projects.getSnapshot();
  const { port } = createFileSpace();
  const files = createProjectContinuityFileSpace(port, projects);

  await files.copyFile("/Documentos/A/pasta", "contexto.txt", "/Documentos/B", "copia.txt");
  assert.deepEqual(projects.getSnapshot(), before);
});

test("failed file operations never mutate project continuity", async () => {
  const renameProjects = createProjectWithLastFile();
  const renameFiles = createProjectContinuityFileSpace(
    createFileSpace({ failRename: true }).port,
    renameProjects,
  );
  const beforeRename = renameProjects.getSnapshot();
  await assert.rejects(
    renameFiles.renameEntry("/Documentos/A", "pasta", "novo"),
    /rename failed/,
  );
  assert.deepEqual(renameProjects.getSnapshot(), beforeRename);

  const moveProjects = createProjectWithLastFile();
  const moveFiles = createProjectContinuityFileSpace(
    createFileSpace({ failMove: true }).port,
    moveProjects,
  );
  const beforeMove = moveProjects.getSnapshot();
  await assert.rejects(
    moveFiles.moveEntry("/Documentos/A", "pasta", "/Downloads"),
    /move failed/,
  );
  assert.deepEqual(moveProjects.getSnapshot(), beforeMove);
});

test("project continuity failure is fail-soft after a completed file operation", async () => {
  const projects = createProjectWithLastFile();
  const throwingProjects = Object.freeze({
    ...projects,
    relocateLastFilePath() {
      throw new Error("private project-store detail");
    },
  });
  const errors = [];
  const { port } = createFileSpace();
  const files = createProjectContinuityFileSpace(port, throwingProjects, {
    onContinuityError(error) {
      errors.push(error);
      throw new Error("diagnostic reporter failed too");
    },
  });

  const result = await files.renameEntry("/Documentos/A", "pasta", "novo");
  assert.deepEqual(result, emptyListing("/Documentos/A"));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /private project-store detail/);
});

test("without a project catalog the decorator preserves the original file-space identity", () => {
  const { port } = createFileSpace();
  assert.equal(createProjectContinuityFileSpace(port, null), port);
});

