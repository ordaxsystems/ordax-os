import {
  validateFileListing,
  validateFileSpacePath,
  validateTextFile,
} from "../../contracts/file-space.mjs";

/**
 * File Space validates payload shape. The app also binds each asynchronous
 * response to the logical path that initiated it, before changing UI/history.
 * No host paths, grants, persistence or authorization are introduced here.
 */
function requireMatchingPath(receivedPath, requestedPath) {
  const expected = validateFileSpacePath(requestedPath);
  if (receivedPath !== expected) {
    throw new TypeError("File Space response identity does not match the requested path");
  }
}

export function validateListingForRequest(payload, requestedPath) {
  const listing = validateFileListing(payload);
  requireMatchingPath(listing.path, requestedPath);
  return listing;
}

export function validateTextForRequest(payload, requestedPath) {
  const file = validateTextFile(payload);
  requireMatchingPath(file.path, requestedPath);
  return file;
}
