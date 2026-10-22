import {
  FILE_SPACE_SCHEMA,
  MAX_IMAGE_PREVIEW_BYTES,
  MAX_MEDIA_PREVIEW_BYTES,
  MAX_DOCUMENT_PREVIEW_BYTES,
  assertFileSpacePort,
  validateFileListing,
  validateFileSpacePath,
  validateImagePreview,
  validateMediaPreview,
  validateDocumentPreview,
  validateTextFile,
  validateTrashListing,
} from "../../contracts/file-space.mjs";

const FILES_ENDPOINT = "/__ordax/native/files";
const TRASH_ENDPOINT = "/__ordax/native/trash";
const FILE_CONTENT_ENDPOINT = "/__ordax/native/file-content";
const FILE_EXPORT_ENDPOINT = "/__ordax/native/file-export";
const IMAGE_PREVIEW_ENDPOINT = "/__ordax/native/image-preview";
const MEDIA_PREVIEW_ENDPOINT = "/__ordax/native/media-preview";
const DOCUMENT_PREVIEW_ENDPOINT = "/__ordax/native/document-preview";
const FILE_IMPORT_ENDPOINT = "/__ordax/native/file-import";

export class FileSpaceOperationError extends Error {
  constructor(operation, status) {
    super(`Native file-space ${operation} failed: ${status}`);
    this.name = "FileSpaceOperationError";
    this.operation = operation;
    this.status = status;
  }
}

function requireSuccess(response, operation) {
  if (!response.ok) {
    throw new FileSpaceOperationError(operation, response.status);
  }
  return response;
}

async function validateResponseListing(response, requestedPath) {
  // Validate the result before exposing it to platform project/recent-file
  // observers; a shape-valid response for a different folder is not success.
  const listing = validateFileListing(await response.json());
  if (listing.path !== validateFileSpacePath(requestedPath)) {
    throw new TypeError("Native file-space listing path differs from requested path");
  }
  return listing;
}

async function validateResponseText(response, requestedPath) {
  const file = validateTextFile(await response.json());
  if (file.path !== validateFileSpacePath(requestedPath)) {
    throw new TypeError("Native file-space text path differs from requested path");
  }
  return file;
}

function endpointFor(path) {
  return `${FILES_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function contentEndpointFor(path) {
  return `${FILE_CONTENT_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function exportEndpointFor(path) {
  return `${FILE_EXPORT_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function imagePreviewEndpointFor(path) {
  return `${IMAGE_PREVIEW_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function mediaPreviewEndpointFor(path) {
  return `${MEDIA_PREVIEW_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function documentPreviewEndpointFor(path) {
  return `${DOCUMENT_PREVIEW_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function fileNameFromPath(path) {
  const parts = String(path).split("/").filter(Boolean);
  return parts[parts.length - 1] || "arquivo";
}

function importEndpointFor(path, name) {
  return `${FILE_IMPORT_ENDPOINT}?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;
}

// One bounded transport for raster images, audio/video and documents. Enforce
// the limit while receiving bytes, including responses without Content-Length.
async function readPreview(windowRef, path, endpoint, operation, maxBytes, validate) {
  validateFileSpacePath(path);
  const response = await windowRef.fetch(endpoint(path), {
    redirect: "error",
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  let reader;
  try {
    requireSuccess(response, operation);
    const mime = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim()?.toLowerCase() ?? "";
    // Validate the media type before accepting or allocating the response body.
    validate({ path, size: 0, mime, bytes: new Uint8Array() });
    const declared = response.headers.get("Content-Length");
    if (declared !== null && (!/^[0-9]+$/.test(declared)
      || !Number.isSafeInteger(Number(declared)))) {
      throw new TypeError("Preview response has an invalid Content-Length");
    }
    if (declared !== null && Number(declared) > maxBytes) {
      throw new FileSpaceOperationError(operation, 413);
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      throw new TypeError("Preview response requires a readable byte stream");
    }
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Preview response must contain byte chunks");
      }
      if (value.byteLength > maxBytes - size) {
        throw new FileSpaceOperationError(operation, 413);
      }
      size += value.byteLength;
      chunks.push(value);
    }
    if (declared !== null && Number(declared) !== size) {
      throw new TypeError("Preview response differs from its Content-Length");
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return validate({ path, size, mime, bytes });
  } catch (error) {
    // Cancellation failure must never replace the useful transport/type error.
    try {
      if (reader) await reader.cancel();
      else await response.body?.cancel?.();
    } catch { /* the connection may already have failed */ }
    throw error;
  } finally {
    reader?.releaseLock();
  }
}

export async function createNativeFileSpace(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native file-space adapter requires window.fetch");
  }

  const requestListing = async (path) => {
    const response = await windowRef.fetch(endpointFor(path), {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    requireSuccess(response, "listing");
    return validateResponseListing(response, path);
  };

  // Probe the bounded user root before advertising this capability.
  await requestListing("/");

  const port = {
    schema: FILE_SPACE_SCHEMA,
    list(path = "/") {
      return requestListing(path);
    },
    async readTextFile(path) {
      const response = await windowRef.fetch(contentEndpointFor(path), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      requireSuccess(response, "text-read");
      return validateResponseText(response, path);
    },
    readImagePreview(path) {
      return readPreview(windowRef, path, imagePreviewEndpointFor, "image-preview",
        MAX_IMAGE_PREVIEW_BYTES, validateImagePreview);
    },
    readMediaPreview(path) {
      return readPreview(windowRef, path, mediaPreviewEndpointFor, "media-preview",
        MAX_MEDIA_PREVIEW_BYTES, validateMediaPreview);
    },
    readDocumentPreview(path) {
      return readPreview(windowRef, path, documentPreviewEndpointFor, "document-preview",
        MAX_DOCUMENT_PREVIEW_BYTES, validateDocumentPreview);
    },
    async copyFile(sourcePath, name, destinationPath, newName) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "copy-file",
          sourcePath,
          name,
          destinationPath,
          newName,
        }),
      });
      requireSuccess(response, "copy");
      return validateResponseListing(response, destinationPath);
    },
    async renameEntry(path, name, newName) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename-entry", path, name, newName }),
      });
      requireSuccess(response, "rename");
      return validateResponseListing(response, path);
    },
    async moveEntry(sourcePath, name, destinationPath) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move-entry",
          sourcePath,
          name,
          destinationPath,
        }),
      });
      requireSuccess(response, "move");
      return validateResponseListing(response, destinationPath);
    },
    async trashEntry(path, name) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trash-entry", path, name }),
      });
      requireSuccess(response, "trash");
      return validateResponseListing(response, path);
    },
    async listTrash() {
      const response = await windowRef.fetch(TRASH_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      requireSuccess(response, "trash-listing");
      return validateTrashListing(await response.json());
    },
    async restoreTrashEntry(id) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore-trash-entry", id }),
      });
      requireSuccess(response, "trash-restore");
      return validateTrashListing(await response.json());
    },
    async exportFile(path) {
      const response = await windowRef.fetch(exportEndpointFor(path), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      requireSuccess(response, "export");
      const blob = await response.blob();
      const createObjectURL = windowRef.URL?.createObjectURL?.bind(windowRef.URL);
      const revokeObjectURL = windowRef.URL?.revokeObjectURL?.bind(windowRef.URL);
      if (
        typeof createObjectURL !== "function" ||
        typeof revokeObjectURL !== "function" ||
        !windowRef.document?.body
      ) {
        throw new TypeError("Native file export requires browser download primitives");
      }

      const objectUrl = createObjectURL(blob);
      const anchor = windowRef.document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileNameFromPath(path);
      anchor.hidden = true;
      windowRef.document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        windowRef.setTimeout?.(() => revokeObjectURL(objectUrl), 0);
      }
    },
    async importFile(path, name, bytes) {
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("Native file import requires Uint8Array payload");
      }
      const response = await windowRef.fetch(importEndpointFor(path, name), {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      requireSuccess(response, "import");
      return validateResponseListing(response, path);
    },
    async createDirectory(path, name) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-directory", path, name }),
      });
      requireSuccess(response, "create-directory");
      return validateResponseListing(response, path);
    },
  };

  assertFileSpacePort(port);
  return Object.freeze(port);
}
