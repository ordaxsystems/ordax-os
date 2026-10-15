import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_TEXT_BYTES = 256 * 1024;
const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const RESERVED = new Set([".ordax-trash"]);
const WINDOWS_INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
const IMAGE_TYPES = new Map([
  [".avif", "image/avif"], [".bmp", "image/bmp"], [".gif", "image/gif"],
  [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"],
]);
const MEDIA_TYPES = new Map([
  [".aac", "audio/aac"], [".flac", "audio/flac"], [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"], [".oga", "audio/ogg"], [".ogg", "audio/ogg"], [".wav", "audio/wav"],
  [".m4v", "video/mp4"], [".mp4", "video/mp4"], [".ogv", "video/ogg"], [".webm", "video/webm"],
]);
const DOCUMENT_TYPES = new Map([[".pdf", "application/pdf"]]);

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function sendBytes(res, status, bytes, contentType = "application/octet-stream") {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(bytes.byteLength));
  res.setHeader("Cache-Control", "no-store");
  res.end(bytes);
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function logicalPath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) throw new Error("invalid-path");
  if (value !== "/" && value.endsWith("/")) throw new Error("invalid-path");
  if (value === "/") return value;
  for (const segment of value.split("/").slice(1)) {
    if (!segment || segment === "." || segment === ".." || segment.includes("\0") || RESERVED.has(segment)) {
      throw new Error("invalid-path");
    }
  }
  return value;
}

function entryName(value) {
  if (
    typeof value !== "string" || !value || value === "." || value === ".." ||
    RESERVED.has(value) || WINDOWS_INVALID_NAME.test(value) || value.endsWith(".") || value.endsWith(" ")
  ) throw new Error("invalid-name");
  return value;
}

function physicalPath(userRoot, value) {
  const logical = logicalPath(value);
  const candidate = logical === "/" ? userRoot : resolve(userRoot, ...logical.split("/").slice(1));
  const rel = relative(userRoot, candidate);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("path-escape");
  return candidate;
}

function childPhysicalPath(userRoot, parentLogical, name) {
  const parent = physicalPath(userRoot, parentLogical);
  const validatedName = entryName(name);
  const candidate = resolve(parent, validatedName);
  const rel = relative(userRoot, candidate);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("path-escape");
  return candidate;
}

function joinLogical(parent, name) {
  return parent === "/" ? "/" + name : parent + "/" + name;
}

async function ensureRoots(userRoot, trashRoot) {
  await mkdir(userRoot, { recursive: true });
  await Promise.all(["Documentos", "Imagens", "Downloads"].map((name) => mkdir(join(userRoot, name), { recursive: true })));
  await mkdir(join(trashRoot, "files"), { recursive: true });
}

async function fileEntry(directory, name) {
  const info = await stat(join(directory, name));
  return {
    name,
    kind: info.isDirectory() ? "directory" : "file",
    size: info.isDirectory() ? 0 : info.size,
    modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
  };
}

async function listing(userRoot, value) {
  const logical = logicalPath(value);
  const directory = physicalPath(userRoot, logical);
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error("not-directory");
  const names = (await readdir(directory)).filter((name) => !RESERVED.has(name));
  names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  const entries = [];
  for (const name of names.slice(0, 1000)) entries.push(await fileEntry(directory, name));
  return { path: logical, entries };
}

async function rawBody(req, maxBytes = MAX_TRANSFER_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("payload-too-large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(req, maxBytes = 8192) {
  const bytes = await rawBody(req, maxBytes);
  if (bytes.length === 0) throw new Error("missing-body");
  return JSON.parse(bytes.toString("utf8"));
}

async function readTrashIndex(trashRoot) {
  try {
    const parsed = JSON.parse(await readFile(join(trashRoot, "index.json"), "utf8"));
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

async function writeTrashIndex(trashRoot, entries) {
  const path = join(trashRoot, "index.json");
  const temporary = path + ".tmp";
  await writeFile(temporary, JSON.stringify({ entries }, null, 2) + "\n", "utf8");
  await rename(temporary, path);
}

async function moveToTrash(userRoot, trashRoot, parentLogical, name) {
  const source = childPhysicalPath(userRoot, parentLogical, name);
  const info = await stat(source);
  const id = randomBytes(16).toString("hex");
  await rename(source, join(trashRoot, "files", id));
  const entries = await readTrashIndex(trashRoot);
  entries.push({
    id,
    name,
    kind: info.isDirectory() ? "directory" : "file",
    size: info.isDirectory() ? 0 : info.size,
    modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
    originalPath: joinLogical(parentLogical, name),
    trashedAt: Date.now(),
  });
  await writeTrashIndex(trashRoot, entries);
}

async function restoreFromTrash(userRoot, trashRoot, id) {
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) throw new Error("invalid-trash-id");
  const entries = await readTrashIndex(trashRoot);
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) throw new Error("trash-entry-missing");
  const entry = entries[index];
  const destination = physicalPath(userRoot, entry.originalPath);
  if (await exists(destination)) throw new Error("restore-destination-exists");
  await mkdir(dirname(destination), { recursive: true });
  await rename(join(trashRoot, "files", id), destination);
  entries.splice(index, 1);
  await writeTrashIndex(trashRoot, entries);
}

async function boundedFile(userRoot, logical, maxBytes) {
  const path = physicalPath(userRoot, logical);
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) throw new Error("preview-unavailable");
  return { path, info, bytes: await readFile(path) };
}

export function createWindowsFileSpaceHost(stateRoot) {
  const userRoot = join(stateRoot, "UserSpace");
  const trashRoot = join(userRoot, ".ordax-trash");

  return async function handleFileSpace(req, res, url) {
    if (!url.pathname.startsWith("/__ordax/native/")) return false;
    await ensureRoots(userRoot, trashRoot);

    if (url.pathname === "/__ordax/native/files" && req.method === "GET") {
      sendJson(res, 200, await listing(userRoot, url.searchParams.get("path") ?? "/"));
      return true;
    }

    if (url.pathname === "/__ordax/native/file-content" && req.method === "GET") {
      const logical = logicalPath(url.searchParams.get("path") ?? "");
      const file = await boundedFile(userRoot, logical, MAX_TEXT_BYTES);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
      if (text.includes("\0")) throw new Error("invalid-text");
      sendJson(res, 200, { path: logical, size: file.bytes.byteLength, text });
      return true;
    }

    if (url.pathname === "/__ordax/native/file-export" && req.method === "GET") {
      const logical = logicalPath(url.searchParams.get("path") ?? "");
      const file = await boundedFile(userRoot, logical, MAX_TRANSFER_BYTES);
      res.setHeader("Content-Disposition", `attachment; filename="${basename(file.path).replaceAll('"', '')}"`);
      sendBytes(res, 200, file.bytes);
      return true;
    }

    if (url.pathname === "/__ordax/native/file-import" && req.method === "POST") {
      const parent = logicalPath(url.searchParams.get("path") ?? "/");
      const name = entryName(url.searchParams.get("name") ?? "");
      const destination = childPhysicalPath(userRoot, parent, name);
      if (await exists(destination)) throw new Error("destination-exists");
      const bytes = await rawBody(req, MAX_TRANSFER_BYTES);
      await writeFile(destination, bytes, { flag: "wx" });
      sendJson(res, 200, await listing(userRoot, parent));
      return true;
    }

    if (["/__ordax/native/image-preview", "/__ordax/native/media-preview", "/__ordax/native/document-preview"].includes(url.pathname) && req.method === "GET") {
      const logical = logicalPath(url.searchParams.get("path") ?? "");
      const extension = extname(logical).toLowerCase();
      const table = url.pathname.includes("image-preview") ? IMAGE_TYPES : url.pathname.includes("media-preview") ? MEDIA_TYPES : DOCUMENT_TYPES;
      const maxBytes = url.pathname.includes("image-preview") ? MAX_IMAGE_BYTES : url.pathname.includes("document-preview") ? MAX_DOCUMENT_BYTES : MAX_TRANSFER_BYTES;
      const mime = table.get(extension);
      if (!mime) throw new Error("unsupported-preview-type");
      const file = await boundedFile(userRoot, logical, maxBytes);
      sendBytes(res, 200, file.bytes, mime);
      return true;
    }

    if (url.pathname === "/__ordax/native/trash" && req.method === "GET") {
      sendJson(res, 200, { entries: await readTrashIndex(trashRoot) });
      return true;
    }

    if (url.pathname === "/__ordax/native/files" && req.method === "POST") {
      const body = await jsonBody(req);
      if (body.action === "create-directory") {
        const parent = logicalPath(body.path);
        await mkdir(childPhysicalPath(userRoot, parent, body.name), { recursive: false });
        sendJson(res, 200, await listing(userRoot, parent));
        return true;
      }
      if (body.action === "rename-entry") {
        const parent = logicalPath(body.path);
        const source = childPhysicalPath(userRoot, parent, body.name);
        const destination = childPhysicalPath(userRoot, parent, body.newName);
        if (await exists(destination)) throw new Error("destination-exists");
        await rename(source, destination);
        sendJson(res, 200, await listing(userRoot, parent));
        return true;
      }
      if (body.action === "copy-file") {
        const sourceParent = logicalPath(body.sourcePath);
        const destinationParent = logicalPath(body.destinationPath);
        const source = childPhysicalPath(userRoot, sourceParent, body.name);
        const destination = childPhysicalPath(userRoot, destinationParent, body.newName);
        const sourceInfo = await stat(source);
        if (!sourceInfo.isFile() || sourceInfo.size > MAX_TRANSFER_BYTES || await exists(destination)) throw new Error("copy-unavailable");
        await copyFile(source, destination);
        sendJson(res, 200, await listing(userRoot, destinationParent));
        return true;
      }
      if (body.action === "move-entry") {
        const sourceParent = logicalPath(body.sourcePath);
        const destinationParent = logicalPath(body.destinationPath);
        const source = childPhysicalPath(userRoot, sourceParent, body.name);
        const destination = childPhysicalPath(userRoot, destinationParent, body.name);
        if (await exists(destination)) throw new Error("destination-exists");
        await rename(source, destination);
        sendJson(res, 200, await listing(userRoot, destinationParent));
        return true;
      }
      if (body.action === "trash-entry") {
        const parent = logicalPath(body.path);
        const name = entryName(body.name);
        await moveToTrash(userRoot, trashRoot, parent, name);
        sendJson(res, 200, await listing(userRoot, parent));
        return true;
      }
      if (body.action === "restore-trash-entry") {
        await restoreFromTrash(userRoot, trashRoot, body.id);
        sendJson(res, 200, { entries: await readTrashIndex(trashRoot) });
        return true;
      }
      throw new Error("unsupported-file-action");
    }

    return false;
  };
}