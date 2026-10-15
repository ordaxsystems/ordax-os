import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_APP_DATA_KEY_CHARS,
  MAX_APP_DATA_VALUE_BYTES,
  validateAppDataIdentity,
  validateAppDataKey,
  validateAppDataRevision,
} from "../../system/contracts/app-data.mjs";

const PREFIX = "/__ordax/native/app-data/";
const QUOTA_BYTES = 8 * 1024 * 1024;
const MAX_KEYS = 1024;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const STATE_SCHEMA = "ordax.windows-mvp-app-data-partition/1";
const ENDPOINT_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Native App Data request body exceeds byte limit"), { status: 413 });
    chunks.push(chunk);
  }
  if (size === 0) throw Object.assign(new Error("Native App Data request body is empty"), { status: 400 });
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Native App Data request body is invalid JSON"), { status: 400 }); }
}

function canonicalBase64(value) {
  if (typeof value !== "string") throw new TypeError("App Data valueBase64 is invalid");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.byteLength > MAX_APP_DATA_VALUE_BYTES) {
    throw new TypeError("App Data valueBase64 is invalid");
  }
  return bytes;
}

function partitionId(identity) {
  return createHash("sha256")
    .update(`${identity.publisherId}\0${identity.appId}\0${identity.ownerScope}`, "utf8")
    .digest("hex");
}

function emptyPartition(identity) {
  return {
    schema: STATE_SCHEMA,
    identity,
    revision: 0,
    entries: {},
  };
}

function validateStoredPartition(value, identity) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== STATE_SCHEMA
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) {
    throw new TypeError("Windows MVP App Data partition is invalid");
  }
  const storedIdentity = validateAppDataIdentity(value.identity);
  if (JSON.stringify(storedIdentity) !== JSON.stringify(identity)) throw new TypeError("Windows MVP App Data identity mismatch");
  let bytesUsed = 0;
  const entries = {};
  for (const [key, encoded] of Object.entries(value.entries)) {
    validateAppDataKey(key);
    const bytes = canonicalBase64(encoded);
    bytesUsed += bytes.byteLength;
    entries[key] = encoded;
  }
  if (Object.keys(entries).length > MAX_KEYS || bytesUsed > QUOTA_BYTES) throw new TypeError("Windows MVP App Data partition exceeds quota");
  return { schema: STATE_SCHEMA, identity, revision: value.revision, entries };
}

async function atomicWrite(root, path, value) {
  await mkdir(root, { recursive: true });
  const temporary = `${path}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

async function loadPartition(root, identity) {
  const path = join(root, `${partitionId(identity)}.json`);
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return { path, value: validateStoredPartition(value, identity) };
  } catch (error) {
    if (error?.code === "ENOENT") return { path, value: emptyPartition(identity) };
    throw error;
  }
}

function bytesUsed(entries) {
  return Object.values(entries).reduce((total, value) => total + Buffer.from(value, "base64").byteLength, 0);
}

function nextRevision(value) {
  if (value >= Number.MAX_SAFE_INTEGER) throw Object.assign(new Error("App Data partition revision is exhausted"), { status: 503 });
  return value + 1;
}

function validateRequestIdentityFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("App Data request body must be an object");
  for (const key of ["appId", "publisherId", "ownerScope", "identity"]) {
    if (Object.hasOwn(value, key)) throw new TypeError("App Data request may not self-assert identity");
  }
  return value;
}

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function createWindowsAppDataHost(stateRoot, repoRoot) {
  const inventoryPath = join(repoRoot, "system", "services", "apps", "first-party-identities.json");
  const dataRoot = join(stateRoot, "AppData");
  const bindings = [];
  const endpointIdentities = new Map();
  const queues = new Map();
  let initialized = false;

  const initialize = async () => {
    if (initialized) return;
    const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
    if (inventory?.$schema !== "ordax.first-party-app-identity-inventory/1"
      || inventory.status !== "system-release-authenticated-source"
      || !Array.isArray(inventory.apps)) {
      throw new TypeError("Canonical first-party identity inventory is invalid");
    }
    for (const app of inventory.apps) {
      const identity = validateAppDataIdentity({
        publisherId: app.publisherPrincipalId,
        appId: app.appId,
        ownerScope: "device",
      });
      const token = randomBytes(32).toString("base64url");
      if (!ENDPOINT_TOKEN_RE.test(token)) throw new Error("opaque App Data token generation failed");
      const endpoint = `${PREFIX}${token}`;
      endpointIdentities.set(endpoint, identity);
      bindings.push(Object.freeze({
        appId: identity.appId,
        endpoint,
        ownerScope: identity.ownerScope,
        publisherId: identity.publisherId,
      }));
    }
    initialized = true;
  };

  const runSerialized = (identity, operation) => {
    const id = partitionId(identity);
    const previous = queues.get(id) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    queues.set(id, current.catch(() => {}));
    return current;
  };

  const handleRequest = async (identity, request) => runSerialized(identity, async () => {
    const body = validateRequestIdentityFields(request);
    const { path, value: partition } = await loadPartition(dataRoot, identity);
    const action = body.action;
    if (action === "get" && exactKeys(body, ["action", "key"])) {
      const key = validateAppDataKey(body.key);
      const encoded = Object.hasOwn(partition.entries, key) ? partition.entries[key] : null;
      return { revision: partition.revision, found: encoded !== null, key, valueBase64: encoded };
    }
    if (action === "list" && exactKeys(body, ["action"])) {
      return {
        revision: partition.revision,
        keys: Object.keys(partition.entries).sort(),
        bytesUsed: bytesUsed(partition.entries),
        quotaBytes: QUOTA_BYTES,
        maxKeys: MAX_KEYS,
      };
    }
    if (action === "put" && exactKeys(body, ["action", "key", "valueBase64", "expectedRevision"])) {
      const key = validateAppDataKey(body.key);
      const expectedRevision = validateAppDataRevision(body.expectedRevision);
      if (expectedRevision !== partition.revision) {
        throw Object.assign(new Error(`App Data revision conflict: expected ${expectedRevision}, actual ${partition.revision}`), { status: 409, actualRevision: partition.revision });
      }
      const bytes = canonicalBase64(body.valueBase64);
      const nextEntries = { ...partition.entries, [key]: bytes.toString("base64") };
      if (!Object.hasOwn(partition.entries, key) && Object.keys(nextEntries).length > MAX_KEYS) throw Object.assign(new Error("App Data partition key quota exceeded"), { status: 400 });
      if (bytesUsed(nextEntries) > QUOTA_BYTES) throw Object.assign(new Error("App Data partition byte quota exceeded"), { status: 400 });
      const next = { ...partition, revision: nextRevision(partition.revision), entries: nextEntries };
      await atomicWrite(dataRoot, path, next);
      return { revision: next.revision, stored: true };
    }
    if (action === "delete" && exactKeys(body, ["action", "key", "expectedRevision"])) {
      const key = validateAppDataKey(body.key);
      const expectedRevision = validateAppDataRevision(body.expectedRevision);
      if (expectedRevision !== partition.revision) {
        throw Object.assign(new Error(`App Data revision conflict: expected ${expectedRevision}, actual ${partition.revision}`), { status: 409, actualRevision: partition.revision });
      }
      if (!Object.hasOwn(partition.entries, key)) return { revision: partition.revision, deleted: false };
      const nextEntries = { ...partition.entries };
      delete nextEntries[key];
      const next = { ...partition, revision: nextRevision(partition.revision), entries: nextEntries };
      await atomicWrite(dataRoot, path, next);
      return { revision: next.revision, deleted: true };
    }
    throw Object.assign(new Error("App Data action or request shape is invalid"), { status: 400 });
  });

  const handle = async (req, res, url) => {
    await initialize();
    if (!url.pathname.startsWith(PREFIX)) return false;
    if (req.method !== "POST") { sendJson(res, 405, { error: "Native App Data requires POST" }); return true; }
    if (url.search) { sendJson(res, 400, { error: "Native App Data capability does not accept a query" }); return true; }
    const identity = endpointIdentities.get(url.pathname);
    if (!identity) { sendJson(res, 404, { error: "Native App Data capability is unknown" }); return true; }
    const type = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
    if (type !== "application/json") { sendJson(res, 415, { error: "Native App Data requires application/json" }); return true; }
    try {
      const request = await readBody(req);
      sendJson(res, 200, await handleRequest(identity, request));
    } catch (error) {
      sendJson(res, Number.isInteger(error?.status) ? error.status : 400, {
        error: String(error?.message ?? "Native App Data request failed"),
        ...(Number.isSafeInteger(error?.actualRevision) ? { actualRevision: error.actualRevision } : {}),
      });
    }
    return true;
  };

  return Object.freeze({
    handle,
    async getBindings() {
      await initialize();
      return Object.freeze(bindings.map((binding) => binding));
    },
  });
}