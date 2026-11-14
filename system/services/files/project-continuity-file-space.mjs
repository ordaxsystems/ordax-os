import {
  FILE_SPACE_SCHEMA,
  assertFileSpacePort,
} from "../../contracts/file-space.mjs";
import { assertProjectCatalogReader } from "../../contracts/project-catalog.mjs";
import { assertProjectMutations } from "../../contracts/project-mutations.mjs";

function joinPath(path, name) {
  return path === "/" ? `/${name}` : `${path}/${name}`;
}

function reportContinuityError(callback, error) {
  if (!callback) return;
  try {
    callback(error);
  } catch {
    // Diagnostics must never turn an already-completed file operation into a failure.
  }
}

export function createProjectContinuityFileSpace(
  fileSpace,
  projects = null,
  { projectMutations = null, onContinuityError = null } = {},
) {
  const filePort = assertFileSpacePort(fileSpace);
  const projectReader = projects === null ? null : assertProjectCatalogReader(projects);
  const mutationPort = projects === null
    ? null
    : assertProjectMutations(projectMutations ?? projects);
  if (onContinuityError !== null && typeof onContinuityError !== "function") {
    throw new TypeError("Project continuity file-space error reporter must be a function");
  }
  if (!projectReader || !mutationPort) return filePort;

  const relocate = async (previousPath, nextPath) => {
    try {
      await mutationPort.relocateLastFilePath(previousPath, nextPath);
    } catch (error) {
      reportContinuityError(onContinuityError, error);
    }
  };

  const clearContinuity = async (removedPath) => {
    try {
      for (const project of projectReader.getSnapshot().projects) {
        const current = project.lastFilePath;
        if (
          current !== null
          && (current === removedPath || current.startsWith(`${removedPath}/`))
        ) {
          await mutationPort.clearLastFile(project.id);
        }
      }
    } catch (error) {
      reportContinuityError(onContinuityError, error);
    }
  };

  const port = {
    schema: FILE_SPACE_SCHEMA,
    ...(filePort.scope === undefined ? {} : { scope: filePort.scope }),
    list(...args) {
      return filePort.list(...args);
    },
    createDirectory(...args) {
      return filePort.createDirectory(...args);
    },
    readTextFile(...args) {
      return filePort.readTextFile(...args);
    },
    ...(typeof filePort.readImagePreview === "function" ? {
      readImagePreview(...args) {
        return filePort.readImagePreview(...args);
      },
    } : {}),
    ...(typeof filePort.readMediaPreview === "function" ? {
      readMediaPreview(...args) {
        return filePort.readMediaPreview(...args);
      },
    } : {}),
    ...(typeof filePort.readDocumentPreview === "function" ? {
      readDocumentPreview(...args) {
        return filePort.readDocumentPreview(...args);
      },
    } : {}),
    async renameEntry(path, name, newName) {
      const result = await filePort.renameEntry(path, name, newName);
      await relocate(joinPath(path, name), joinPath(path, newName));
      return result;
    },
    copyFile(...args) {
      return filePort.copyFile(...args);
    },
    async moveEntry(sourcePath, name, destinationPath) {
      const result = await filePort.moveEntry(sourcePath, name, destinationPath);
      await relocate(joinPath(sourcePath, name), joinPath(destinationPath, name));
      return result;
    },
    async trashEntry(path, name) {
      const result = await filePort.trashEntry(path, name);
      await clearContinuity(joinPath(path, name));
      return result;
    },
    listTrash(...args) {
      return filePort.listTrash(...args);
    },
    restoreTrashEntry(...args) {
      return filePort.restoreTrashEntry(...args);
    },
    exportFile(...args) {
      return filePort.exportFile(...args);
    },
    importFile(...args) {
      return filePort.importFile(...args);
    },
  };

  assertFileSpacePort(port);
  return Object.freeze(port);
}
