import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createEmptyProfileActivationState,
  validateProfileActivationState,
} from "../../system/contracts/profile-activation-state.mjs";
import {
  validateProfileComponentInventory,
} from "../../system/contracts/profile-component-inventory.mjs";
import { validateProfileContentContext } from "../../system/contracts/profile-content-context.mjs";
import { validateProfileContentContextCapability } from "../../system/contracts/profile-content-context-capability.mjs";

const COMMAND_SCHEMA = "ordax.profile-activation-command/1";
const STATE_FILE = "profile-activation-state.json";
const INVENTORY_FILE = "profile-component-inventory.json";

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}
function sendEmpty(res, status) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
async function readRequestJson(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("request-too-large"), { status: 413 });
    chunks.push(chunk);
  }
  if (size === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}
async function atomicJson(root, path, value) {
  await mkdir(root, { recursive: true });
  const temporary = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function permissionDigest(value) {
  return createHash("sha256").update(stable(value), "utf8").digest("hex");
}
function permissionDiff() {
  return Object.freeze({
    schema: "ordax.profile-permission-diff/1",
    componentAdds: Object.freeze([]),
    componentRemovals: Object.freeze([]),
    authorityChanges: Object.freeze([]),
    requiresExplicitReview: false,
  });
}
function commandError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function createWindowsProfileRuntimeHost(stateRoot, repoRoot, profileActivationToken) {
  const statePath = join(stateRoot, "NativeState", STATE_FILE);
  const inventoryPath = join(stateRoot, "NativeState", INVENTORY_FILE);
  const catalogPath = join(repoRoot, "system", "profile-packs", "catalog.json");

  const readState = async () => {
    const stored = await readJson(statePath, null);
    return validateProfileActivationState(stored ?? createEmptyProfileActivationState("device"));
  };
  const writeState = async (value) => {
    const validated = validateProfileActivationState(value);
    if (validated.persistence !== "device") throw commandError("profile-state-not-device-persistent", 500);
    await atomicJson(join(stateRoot, "NativeState"), statePath, validated);
    return validated;
  };
  const readInventory = async () => {
    const stored = await readJson(inventoryPath, null);
    return validateProfileComponentInventory(stored ?? {
      schema: "ordax.profile-component-inventory/1",
      revision: 0,
      persistence: "device",
      entries: [],
    });
  };
  const readManifest = async (profile) => {
    if (!profile || typeof profile.slug !== "string" || !Number.isSafeInteger(profile.version) || profile.version < 1) {
      throw commandError("invalid-profile-identity", 400);
    }
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    if (catalog?.$schema !== "ordax.profile-pack-bundled-catalog/1" || !Array.isArray(catalog.entries)) {
      throw commandError("profile-catalog-invalid", 500);
    }
    const expected = `/system/profile-packs/${profile.slug}/v${profile.version}/manifest.json`;
    const row = catalog.entries.find((entry) => entry?.slug === profile.slug && entry?.version === profile.version && entry?.manifest === expected);
    if (!row) throw commandError("profile-not-in-canonical-catalog", 400);
    const manifest = JSON.parse(await readFile(join(repoRoot, expected.slice(1)), "utf8"));
    if (manifest?.$schema !== "ordax.profile-pack/1" || manifest.slug !== profile.slug || manifest.version !== profile.version) {
      throw commandError("profile-manifest-identity-invalid", 500);
    }
    return manifest;
  };
  const assertStableMvpActivation = (manifest, spaceKind, components) => {
    if (manifest.space_kind !== spaceKind) throw commandError("profile-space-kind-mismatch", 400);
    if (manifest.state !== "active" || manifest.activation?.publicly_available !== true) {
      throw commandError("profile-not-published-for-stable-mvp", 403);
    }
    if (manifest.intelligence?.external_provider_required !== false) {
      throw commandError("profile-requires-unsupported-authority", 403);
    }
    const security = manifest.security;
    if (!security || security.auto_grant_privileges === true || security.allow_unsigned_apps === true || security.generic_shell_implied === true || security.cross_space_memory === true) {
      throw commandError("profile-broadens-authority", 403);
    }
    if (!Array.isArray(manifest.components) || manifest.components.length !== 0 || !Array.isArray(components) || components.length !== 0) {
      throw commandError("stable-mvp-profile-must-have-zero-components", 403);
    }
  };
  const preview = async (body, state) => {
    if (body.expectedRevision !== state.revision) throw commandError("profile-activation-revision-changed", 409);
    const manifest = await readManifest(body.profile);
    assertStableMvpActivation(manifest, body.spaceKind, body.components);
    const diff = permissionDiff();
    const digest = permissionDigest({
      schema: "ordax.profile-permission-review/1",
      expectedRevision: body.expectedRevision,
      spaceId: body.spaceId,
      spaceKind: body.spaceKind,
      profile: body.profile,
      components: body.components,
      permissionDiff: diff,
    });
    return { diff, digest };
  };
  const activate = async (body, state) => {
    const { diff, digest } = await preview(body, state);
    if (body.acceptedPermissionDiffSha256 != null && body.acceptedPermissionDiffSha256 !== digest) {
      throw commandError("profile-permission-review-stale", 403);
    }
    if (!Number.isSafeInteger(body.activatedAt) || body.activatedAt < 0) throw commandError("invalid-activated-at", 400);
    const activation = { profile: body.profile, components: [], activatedAt: body.activatedAt };
    const index = state.spaces.findIndex((entry) => entry.spaceId === body.spaceId);
    const spaces = state.spaces.map((entry) => ({ ...entry }));
    const existing = index < 0 ? null : spaces[index];
    if (existing && existing.spaceKind !== body.spaceKind) throw commandError("profile-space-kind-changed", 400);
    const same = existing?.current && stable({ profile: existing.current.profile, components: existing.current.components }) === stable({ profile: activation.profile, components: activation.components });
    if (same) return { changed: false, state, diff };
    const row = {
      spaceId: body.spaceId,
      spaceKind: body.spaceKind,
      current: activation,
      previous: existing ? (existing.current ?? existing.previous) : null,
    };
    if (index < 0) spaces.push(row); else spaces[index] = row;
    const next = await writeState({ schema: "ordax.profile-activation-state/1", revision: state.revision + 1, persistence: "device", spaces });
    return { changed: true, state: next, diff };
  };
  const deactivate = async (body, state) => {
    if (body.expectedRevision !== state.revision) throw commandError("profile-activation-revision-changed", 409);
    const index = state.spaces.findIndex((entry) => entry.spaceId === body.spaceId);
    if (index < 0 || state.spaces[index].current === null) return { changed: false, state };
    const spaces = state.spaces.map((entry) => ({ ...entry }));
    const row = spaces[index];
    spaces[index] = { spaceId: row.spaceId, spaceKind: row.spaceKind, current: null, previous: row.current };
    const next = await writeState({ schema: "ordax.profile-activation-state/1", revision: state.revision + 1, persistence: "device", spaces });
    return { changed: true, state: next };
  };

  const handle = async (req, res, url) => {
    const path = url.pathname;
    if (path === "/__ordax/native/profile-component-inventory" && req.method === "GET") {
      sendJson(res, 200, await readInventory()); return true;
    }
    if (path === "/__ordax/native/profile-activation-state" && req.method === "GET") {
      sendJson(res, 200, await readState()); return true;
    }
    if (path === "/__ordax/native/profile-content-context-capability" && req.method === "GET") {
      sendJson(res, 200, validateProfileContentContextCapability({ schema: "ordax.profile-content-context-capability/1", available: true })); return true;
    }
    if (path === "/__ordax/native/profile-content-context" && req.method === "GET") {
      const spaceId = url.searchParams.get("spaceId")?.trim() ?? "";
      const retrievalQuery = url.searchParams.get("query");
      if (!spaceId || spaceId.length > 160 || (retrievalQuery !== null && (!retrievalQuery.trim() || retrievalQuery.length > 256))) { sendEmpty(res, 400); return true; }
      const state = await readState();
      const row = state.spaces.find((entry) => entry.spaceId === spaceId) ?? null;
      const value = validateProfileContentContext({
        schema: "ordax.profile-content-context/1",
        spaceId,
        profile: row?.current?.profile ?? null,
        entries: [],
      });
      sendJson(res, 200, value); return true;
    }
    if (path === "/__ordax/native/profile-activation-command" && req.method === "POST") {
      if (req.headers["x-ordax-profile-activation-token"] !== profileActivationToken) { sendEmpty(res, 403); return true; }
      try {
        const body = await readRequestJson(req);
        if (!body || body.schema !== COMMAND_SCHEMA || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || typeof body.spaceId !== "string" || !body.spaceId || body.spaceId.length > 160) {
          throw commandError("invalid-profile-command", 400);
        }
        const state = await readState();
        if (body.action === "preview-activate" || body.action === "activate") {
          if (!["personal", "work", "professional"].includes(body.spaceKind) || !Array.isArray(body.components)) throw commandError("invalid-profile-command", 400);
          const result = body.action === "preview-activate" ? await preview(body, state) : await activate(body, state);
          sendJson(res, 200, {
            schema: COMMAND_SCHEMA,
            action: body.action,
            changed: body.action === "activate" ? result.changed : false,
            state: body.action === "activate" ? result.state : state,
            permissionDiff: result.diff,
            ...(body.action === "preview-activate" ? { permissionDiffSha256: result.digest } : {}),
          });
          return true;
        }
        if (body.action === "deactivate") {
          const result = await deactivate(body, state);
          sendJson(res, 200, { schema: COMMAND_SCHEMA, action: body.action, changed: result.changed, state: result.state, permissionDiff: null });
          return true;
        }
        if (body.action === "rollback") { sendEmpty(res, 403); return true; }
        throw commandError("unsupported-profile-command", 400);
      } catch (error) {
        sendEmpty(res, Number.isInteger(error?.status) ? error.status : 400); return true;
      }
    }
    return false;
  };

  return Object.freeze({ handle });
}