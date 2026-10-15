import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateComponentState } from "../../system/contracts/component-state-store.mjs";
import { validateDiagnosticJournalPayload } from "../../system/contracts/diagnostic-journal-store.mjs";
import { parseMemorySnapshotPayload } from "../../system/contracts/memory-store.mjs";
import { validateSyncStatePayload } from "../../system/contracts/sync-state-store.mjs";
import { validateSyncCheckpoint } from "../../system/contracts/sync-checkpoint-store.mjs";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

async function readRequestJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("state-payload-too-large");
    chunks.push(chunk);
  }
  if (size === 0) throw new Error("state-payload-missing");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function loadRecord(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function saveRecord(root, path, value) {
  await mkdir(root, { recursive: true });
  const temporary = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

function requireObjectWithOnly(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("state-envelope-invalid");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("state-envelope-invalid");
  }
  return value;
}

export function createWindowsStatePersistenceHost(stateRoot) {
  const recordsRoot = join(stateRoot, "NativeState");
  const paths = Object.freeze({
    component: join(recordsRoot, "component-state.json"),
    diagnostic: join(recordsRoot, "diagnostic-journal.json"),
    memory: join(recordsRoot, "intelligence-memory.json"),
    syncState: join(recordsRoot, "sync-state.json"),
    syncCheckpoint: join(recordsRoot, "sync-checkpoint.json"),
  });

  return async function handleStatePersistence(req, res, url) {
    if (url.pathname === "/__ordax/native/component-state") {
      if (req.method === "GET") {
        const record = await loadRecord(paths.component, { payload: null });
        sendJson(res, 200, record);
        return true;
      }
      if (req.method === "POST") {
        const body = requireObjectWithOnly(await readRequestJson(req), ["payload"]);
        if (typeof body.payload !== "string") throw new Error("component-state-payload-invalid");
        const validated = validateComponentState(JSON.parse(body.payload));
        const record = { payload: JSON.stringify(validated) };
        await saveRecord(recordsRoot, paths.component, record);
        sendJson(res, 200, { ok: true });
        return true;
      }
      return false;
    }

    if (url.pathname === "/__ordax/native/diagnostic-journal") {
      if (req.method === "GET") {
        const record = await loadRecord(paths.diagnostic, { payload: null });
        const payload = validateDiagnosticJournalPayload(record.payload ?? null);
        sendJson(res, 200, { payload });
        return true;
      }
      if (req.method === "POST") {
        const body = requireObjectWithOnly(await readRequestJson(req), ["payload"]);
        const payload = validateDiagnosticJournalPayload(body.payload ?? null);
        await saveRecord(recordsRoot, paths.diagnostic, { payload });
        sendJson(res, 200, { ok: true });
        return true;
      }
      return false;
    }

    if (url.pathname === "/__ordax/native/intelligence-memory") {
      if (req.method === "GET") {
        const record = await loadRecord(paths.memory, { payload: null });
        if (record.payload !== null) {
          if (typeof record.payload !== "string") throw new Error("memory-payload-invalid");
          parseMemorySnapshotPayload(record.payload);
        }
        sendJson(res, 200, { payload: record.payload ?? null });
        return true;
      }
      if (req.method === "POST") {
        const body = requireObjectWithOnly(await readRequestJson(req), ["payload"]);
        if (typeof body.payload !== "string") throw new Error("memory-payload-invalid");
        parseMemorySnapshotPayload(body.payload);
        await saveRecord(recordsRoot, paths.memory, { payload: body.payload });
        sendJson(res, 200, { ok: true });
        return true;
      }
      return false;
    }

    if (url.pathname === "/__ordax/native/sync-state") {
      if (req.method === "GET") {
        const record = await loadRecord(paths.syncState, { payload: null });
        const payload = validateSyncStatePayload(record.payload ?? null);
        sendJson(res, 200, { payload });
        return true;
      }
      if (req.method === "POST") {
        const body = requireObjectWithOnly(await readRequestJson(req), ["payload"]);
        const payload = validateSyncStatePayload(body.payload ?? null);
        await saveRecord(recordsRoot, paths.syncState, { payload });
        sendJson(res, 200, { ok: true });
        return true;
      }
      return false;
    }

    if (url.pathname === "/__ordax/native/sync-checkpoint") {
      if (req.method === "GET") {
        const record = await loadRecord(paths.syncCheckpoint, { checkpoint: null });
        const checkpoint = validateSyncCheckpoint(record.checkpoint ?? null);
        sendJson(res, 200, { checkpoint });
        return true;
      }
      if (req.method === "POST") {
        const body = requireObjectWithOnly(await readRequestJson(req), ["checkpoint"]);
        const checkpoint = validateSyncCheckpoint(body.checkpoint ?? null);
        await saveRecord(recordsRoot, paths.syncCheckpoint, { checkpoint });
        sendJson(res, 200, { ok: true });
        return true;
      }
      return false;
    }

    return false;
  };
}