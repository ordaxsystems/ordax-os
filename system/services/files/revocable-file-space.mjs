// An application receives only a per-mount projection of host-owned File Space.
// This prevents further JS-port calls after teardown, not direct HTTP access
// or filesystem mutations already admitted by the Native host.
import { FILE_SPACE_SCHEMA, assertFileSpacePort } from "../../contracts/file-space.mjs";

const FILE_OPERATIONS = Object.freeze([
  "list", "createDirectory", "readTextFile", "renameEntry", "copyFile",
  "moveEntry", "trashEntry", "listTrash", "restoreTrashEntry", "exportFile", "importFile",
]);
const OPTIONAL_PREVIEWS = Object.freeze([
  "readImagePreview", "readMediaPreview", "readDocumentPreview",
]);

export function createRevocableFileSpacePort(hostPort) {
  const host = assertFileSpacePort(hostPort);
  let active = true;
  const requireActive = () => {
    if (!active) throw new TypeError("Mounted File Space port has been revoked");
  };
  const port = { schema: FILE_SPACE_SCHEMA };
  for (const operation of [...FILE_OPERATIONS, ...OPTIONAL_PREVIEWS]) {
    if (!FILE_OPERATIONS.includes(operation) && typeof host[operation] !== "function") {
      continue;
    }
    port[operation] = (...args) => {
      requireActive();
      const result = host[operation](...args);
      if (result !== null && typeof result === "object" && typeof result.then === "function") {
        return Promise.resolve(result).then((value) => {
          requireActive();
          return value;
        });
      }
      requireActive();
      return result;
    };
  }
  const exposed = Object.freeze(assertFileSpacePort(port));
  return Object.freeze({
    port: exposed,
    revoke() { active = false; },
  });
}
