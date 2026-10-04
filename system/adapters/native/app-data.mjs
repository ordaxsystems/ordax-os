import {
  validateAppDataBytes,
  validateAppDataDelete,
  validateAppDataIdentity,
  validateAppDataKey,
  validateAppDataPut,
  validateAppDataRevision,
} from "../../contracts/app-data.mjs";

const ENDPOINT_RE = /^\/__ordax\/native\/app-data\/[A-Za-z0-9_-]{32,128}$/;

function compatibleWindow(windowRef) {
  if (
    !windowRef
    || typeof windowRef.fetch !== "function"
    || typeof windowRef.btoa !== "function"
    || typeof windowRef.atob !== "function"
  ) {
    throw new TypeError("Native App Data adapter requires fetch/btoa/atob");
  }
  return windowRef;
}

function assertEndpoint(value) {
  if (typeof value !== "string" || !ENDPOINT_RE.test(value)) {
    throw new TypeError("Native App Data endpoint binding is invalid");
  }
  return value;
}

function sameIdentity(left, right) {
  return left.appId === right.appId
    && left.publisherId === right.publisherId
    && left.ownerScope === right.ownerScope;
}

function bytesToBase64(bytes, windowRef) {
  const value = validateAppDataBytes(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < value.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...value.subarray(offset, Math.min(offset + chunkSize, value.byteLength)));
  }
  return windowRef.btoa(binary);
}

function base64ToBytes(value, windowRef) {
  if (typeof value !== "string") {
    throw new TypeError("Native App Data response valueBase64 is invalid");
  }
  let binary;
  try {
    binary = windowRef.atob(value);
  } catch (error) {
    throw new TypeError("Native App Data response valueBase64 is invalid", { cause: error });
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return validateAppDataBytes(bytes);
}

async function parseJsonResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new TypeError("Native App Data response is not valid JSON", { cause: error });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Native App Data response shape is invalid");
  }
  return payload;
}

function validateKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function validateGetResponse(payload, requestedKey, windowRef) {
  validateKeys(payload, ["revision", "found", "key", "valueBase64"], "Native App Data get response");
  const revision = validateAppDataRevision(payload.revision);
  const key = validateAppDataKey(payload.key);
  if (key !== requestedKey || typeof payload.found !== "boolean") {
    throw new TypeError("Native App Data get response binding is invalid");
  }
  if (!payload.found && payload.valueBase64 !== null) {
    throw new TypeError("Native App Data missing value response is invalid");
  }
  if (payload.found && payload.valueBase64 === null) {
    throw new TypeError("Native App Data found response is missing value");
  }
  return Object.freeze({
    revision,
    found: payload.found,
    key,
    value: payload.found ? base64ToBytes(payload.valueBase64, windowRef) : null,
  });
}

function validateListResponse(payload) {
  validateKeys(payload, ["revision", "keys", "bytesUsed", "quotaBytes", "maxKeys"], "Native App Data list response");
  const revision = validateAppDataRevision(payload.revision);
  if (!Array.isArray(payload.keys)) throw new TypeError("Native App Data list keys are invalid");
  const keys = payload.keys.map((entry) => validateAppDataKey(entry));
  if (new Set(keys).size !== keys.length || [...keys].sort().some((entry, index) => entry !== keys[index])) {
    throw new TypeError("Native App Data list keys must be unique and sorted");
  }
  for (const field of ["bytesUsed", "quotaBytes", "maxKeys"]) {
    if (!Number.isSafeInteger(payload[field]) || payload[field] < 0) {
      throw new TypeError(`Native App Data list ${field} is invalid`);
    }
  }
  if (payload.bytesUsed > payload.quotaBytes) {
    throw new TypeError("Native App Data list response exceeds quota");
  }
  return Object.freeze({
    revision,
    keys: Object.freeze(keys),
    bytesUsed: payload.bytesUsed,
    quotaBytes: payload.quotaBytes,
    maxKeys: payload.maxKeys,
  });
}

function validateMutationResponse(payload, field) {
  validateKeys(payload, ["revision", field], "Native App Data mutation response");
  const revision = validateAppDataRevision(payload.revision);
  if (typeof payload[field] !== "boolean") {
    throw new TypeError(`Native App Data ${field} response is invalid`);
  }
  return Object.freeze({ revision, [field]: payload[field] });
}

export class NativeAppDataConflictError extends Error {
  constructor(expectedRevision, actualRevision) {
    super(`App Data revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = "AppDataConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export function createNativeAppDataStore({ windowRef = globalThis, endpoint, identity } = {}) {
  const host = compatibleWindow(windowRef);
  const boundEndpoint = assertEndpoint(endpoint);
  const boundIdentity = validateAppDataIdentity(identity);

  const request = async (body, expectedRevision = null) => {
    const response = await host.fetch(boundEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const payload = await parseJsonResponse(response);
    if (response.status === 409) {
      if (!Number.isSafeInteger(payload.actualRevision) || payload.actualRevision < 0 || expectedRevision === null) {
        throw new TypeError("Native App Data conflict response is invalid");
      }
      throw new NativeAppDataConflictError(expectedRevision, payload.actualRevision);
    }
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : `Native App Data request failed (${response.status})`;
      throw new Error(message);
    }
    return payload;
  };

  const assertBoundIdentity = (rawIdentity) => {
    const candidate = validateAppDataIdentity(rawIdentity);
    if (!sameIdentity(candidate, boundIdentity)) {
      throw new TypeError("Native App Data store cannot retarget its bound identity");
    }
  };

  return Object.freeze({
    async get(rawIdentity, rawKey) {
      assertBoundIdentity(rawIdentity);
      const key = validateAppDataKey(rawKey);
      return validateGetResponse(await request({ action: "get", key }), key, host);
    },
    async list(rawIdentity) {
      assertBoundIdentity(rawIdentity);
      return validateListResponse(await request({ action: "list" }));
    },
    async put(rawIdentity, rawCommand) {
      assertBoundIdentity(rawIdentity);
      const command = validateAppDataPut(rawCommand);
      const payload = await request({
        action: "put",
        key: command.key,
        valueBase64: bytesToBase64(command.value, host),
        expectedRevision: command.expectedRevision,
      }, command.expectedRevision);
      return validateMutationResponse(payload, "stored");
    },
    async delete(rawIdentity, rawCommand) {
      assertBoundIdentity(rawIdentity);
      const command = validateAppDataDelete(rawCommand);
      const payload = await request({
        action: "delete",
        key: command.key,
        expectedRevision: command.expectedRevision,
      }, command.expectedRevision);
      return validateMutationResponse(payload, "deleted");
    },
  });
}
