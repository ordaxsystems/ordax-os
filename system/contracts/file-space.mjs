export const FILE_SPACE_SCHEMA = "ordax.file-space/11";
export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_FILE_COPY_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_EXPORT_BYTES = 64 * 1024 * 1024;
export const MAX_FILE_IMPORT_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_PREVIEW_BYTES = 64 * 1024 * 1024;
export const MAX_DOCUMENT_PREVIEW_BYTES = 32 * 1024 * 1024;

const IMAGE_PREVIEW_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MEDIA_PREVIEW_MIME_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/ogg",
  "video/webm",
]);

const DOCUMENT_PREVIEW_MIME_TYPES = new Set([
  "application/pdf",
]);

const ENTRY_KINDS = new Set(["file", "directory"]);
const RESERVED_ENTRY_NAMES = new Set([".ordax-trash"]);

export function validateFileSpacePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError("File-space path must be an absolute logical path");
  }
  if (path !== "/" && path.endsWith("/")) {
    throw new TypeError("File-space path must not have a trailing slash");
  }
  if (path === "/") return path;
  const parts = path.split("/").slice(1);
  if (
    parts.some(
      (part) =>
        !part
        || part === "."
        || part === ".."
        || part.includes("\0")
        || RESERVED_ENTRY_NAMES.has(part),
    )
  ) {
    throw new TypeError("File-space path contains an invalid segment");
  }
  return path;
}

export function validateFileEntry(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("File-space entry must be an object");
  }
  if (
    typeof value.name !== "string" ||
    !value.name ||
    value.name === "." ||
    value.name === ".." ||
    value.name.includes("/") ||
    value.name.includes("\0") ||
    RESERVED_ENTRY_NAMES.has(value.name)
  ) {
    throw new TypeError("File-space entry name is invalid");
  }
  if (!ENTRY_KINDS.has(value.kind)) {
    throw new TypeError(`Unsupported file-space entry kind: ${String(value.kind)}`);
  }
  if (!Number.isInteger(value.size) || value.size < 0) {
    throw new TypeError("File-space entry size must be a non-negative integer");
  }
  if (!Number.isSafeInteger(value.modifiedAt) || value.modifiedAt < 0) {
    throw new TypeError("File-space entry modifiedAt must be a non-negative epoch millisecond");
  }
  return Object.freeze({
    name: value.name,
    kind: value.kind,
    size: value.size,
    modifiedAt: value.modifiedAt,
  });
}

export function validateFileListing(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) {
    throw new TypeError("File-space listing is invalid");
  }
  const path = validateFileSpacePath(value.path);
  const entries = value.entries.map(validateFileEntry);
  return Object.freeze({ path, entries: Object.freeze(entries) });
}

const TRASH_ID_RE = /^[0-9a-f]{32}$/;

export function validateTrashEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Trash entry must be an object");
  }
  if (typeof value.id !== "string" || !TRASH_ID_RE.test(value.id)) {
    throw new TypeError("Trash entry id is invalid");
  }
  const entry = validateFileEntry(value);
  const originalPath = validateFileSpacePath(value.originalPath);
  if (originalPath === "/") {
    throw new TypeError("Trash entry original path must identify an entry");
  }
  const expectedSuffix = originalPath.startsWith("/") ? originalPath.split("/").at(-1) : "";
  if (expectedSuffix !== entry.name) {
    throw new TypeError("Trash entry name must match its original path");
  }
  if (!Number.isSafeInteger(value.trashedAt) || value.trashedAt < 0) {
    throw new TypeError("Trash entry trashedAt must be a non-negative epoch millisecond");
  }
  return Object.freeze({
    id: value.id,
    name: entry.name,
    kind: entry.kind,
    size: entry.size,
    modifiedAt: entry.modifiedAt,
    originalPath,
    trashedAt: value.trashedAt,
  });
}

export function validateTrashListing(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) {
    throw new TypeError("Trash listing is invalid");
  }
  return Object.freeze({
    entries: Object.freeze(value.entries.map(validateTrashEntry)),
  });
}

export function validateTextFile(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Text-file payload must be an object");
  }
  const path = validateFileSpacePath(value.path);
  if (!Number.isInteger(value.size) || value.size < 0 || value.size > MAX_TEXT_FILE_BYTES) {
    throw new TypeError("Text-file size is outside the preview boundary");
  }
  if (typeof value.text !== "string" || value.text.includes("\0")) {
    throw new TypeError("Text-file content must be valid text");
  }
  return Object.freeze({ path, size: value.size, text: value.text });
}

export function validateImagePreview(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Image-preview payload must be an object");
  }
  const path = validateFileSpacePath(value.path);
  if (!Number.isInteger(value.size) || value.size < 0 || value.size > MAX_IMAGE_PREVIEW_BYTES) {
    throw new TypeError("Image-preview size is outside the preview boundary");
  }
  if (!IMAGE_PREVIEW_MIME_TYPES.has(value.mime)) {
    throw new TypeError("Image-preview MIME type is unsupported");
  }
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength !== value.size) {
    throw new TypeError("Image-preview bytes must match the declared size");
  }
  return Object.freeze({
    path,
    size: value.size,
    mime: value.mime,
    bytes: value.bytes,
  });
}

export function validateMediaPreview(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Media-preview payload must be an object");
  }
  const path = validateFileSpacePath(value.path);
  if (!Number.isInteger(value.size) || value.size < 0 || value.size > MAX_MEDIA_PREVIEW_BYTES) {
    throw new TypeError("Media-preview size is outside the preview boundary");
  }
  if (!MEDIA_PREVIEW_MIME_TYPES.has(value.mime)) {
    throw new TypeError("Media-preview MIME type is unsupported");
  }
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength !== value.size) {
    throw new TypeError("Media-preview bytes must match the declared size");
  }
  return Object.freeze({
    path,
    size: value.size,
    mime: value.mime,
    bytes: value.bytes,
  });
}

export function validateDocumentPreview(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Document-preview payload must be an object");
  }
  const path = validateFileSpacePath(value.path);
  if (!Number.isInteger(value.size) || value.size < 0 || value.size > MAX_DOCUMENT_PREVIEW_BYTES) {
    throw new TypeError("Document-preview size is outside the preview boundary");
  }
  if (!DOCUMENT_PREVIEW_MIME_TYPES.has(value.mime)) {
    throw new TypeError("Document-preview MIME type is unsupported");
  }
  if (!(value.bytes instanceof Uint8Array) || value.bytes.byteLength !== value.size) {
    throw new TypeError("Document-preview bytes must match the declared size");
  }
  return Object.freeze({ path, size: value.size, mime: value.mime, bytes: value.bytes });
}

export function assertFileSpacePort(port) {
  if (!port || typeof port !== "object" || port.schema !== FILE_SPACE_SCHEMA) {
    throw new TypeError("A compatible file-space port is required");
  }
  if (
    typeof port.list !== "function" ||
    typeof port.createDirectory !== "function" ||
    typeof port.readTextFile !== "function" ||
    typeof port.renameEntry !== "function" ||
    typeof port.copyFile !== "function" ||
    typeof port.moveEntry !== "function" ||
    typeof port.trashEntry !== "function" ||
    typeof port.listTrash !== "function" ||
    typeof port.restoreTrashEntry !== "function" ||
    typeof port.exportFile !== "function" ||
    typeof port.importFile !== "function"
  ) {
    throw new TypeError(
      "File-space port must implement list(), createDirectory(), readTextFile(), renameEntry(), copyFile(), moveEntry(), trashEntry(), listTrash(), restoreTrashEntry(), exportFile(), and importFile()",
    );
  }
  return port;
}


export function assertMediaPreviewFileSpacePort(port) {
  assertFileSpacePort(port);
  if (typeof port.readMediaPreview !== "function") {
    throw new TypeError("File-space port does not provide bounded media preview");
  }
  return port;
}


export function assertDocumentPreviewFileSpacePort(port) {
  assertFileSpacePort(port);
  if (typeof port.readDocumentPreview !== "function") {
    throw new TypeError("File-space port does not provide bounded document preview");
  }
  return port;
}
