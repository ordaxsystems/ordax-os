import {
  PERSONAL_ACTIVITY_EXPORT_PORT_SCHEMA,
  assertPersonalActivityExportPort,
  validatePersonalActivityExportDocument,
} from "../../contracts/personal-activity-export.mjs";
import { assertFileSpacePort } from "../../contracts/file-space.mjs";

export const NATIVE_PERSONAL_ACTIVITY_EXPORT_DIRECTORY = "/Downloads";

function requirePersistedExport(listing, document) {
  if (
    !listing
    || typeof listing !== "object"
    || listing.path !== NATIVE_PERSONAL_ACTIVITY_EXPORT_DIRECTORY
    || !Array.isArray(listing.entries)
  ) {
    throw new TypeError("Native Personal Activity export did not confirm Downloads");
  }
  const entry = listing.entries.find((candidate) => candidate?.name === document.fileName);
  if (
    !entry
    || entry.kind !== "file"
    || entry.size !== document.bytes.byteLength
  ) {
    throw new TypeError("Native Personal Activity export did not confirm the persisted file");
  }
}

export function createNativePersonalActivityExport(fileSpaceValue) {
  const fileSpace = assertFileSpacePort(fileSpaceValue);
  const port = {
    schema: PERSONAL_ACTIVITY_EXPORT_PORT_SCHEMA,
    async save(value) {
      const document = validatePersonalActivityExportDocument(value);
      const listing = await fileSpace.importFile(
        NATIVE_PERSONAL_ACTIVITY_EXPORT_DIRECTORY,
        document.fileName,
        document.bytes,
      );
      requirePersistedExport(listing, document);
      return Object.freeze({ status: "saved", fileName: document.fileName });
    },
  };
  assertPersonalActivityExportPort(port);
  return Object.freeze(port);
}
