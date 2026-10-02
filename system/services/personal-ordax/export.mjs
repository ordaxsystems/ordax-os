import {
  PERSONAL_ACTIVITY_EXPORT_SCHEMA,
  validatePersonalActivityExportDocument,
} from "../../contracts/personal-activity-export.mjs";
import {
  validatePersonalOrdaxRuntimeSnapshot,
} from "../../contracts/personal-ordax-store.mjs";

function timestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError("Personal Activity export clock must return an ISO timestamp");
  }
  return new Date(value).toISOString();
}

function fileStamp(iso) {
  return iso
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
}

function stripGrantRef(value) {
  if (!value || typeof value !== "object") return value;
  const copy = { ...value };
  if ("grantRef" in copy) copy.grantRef = null;
  return copy;
}

export function createPersonalActivityExportDocument(
  snapshotValue,
  {
    clock = () => new Date().toISOString(),
    TextEncoderCtor = globalThis.TextEncoder,
  } = {},
) {
  if (typeof TextEncoderCtor !== "function") {
    throw new TypeError("Personal Activity export requires TextEncoder");
  }
  const snapshot = validatePersonalOrdaxRuntimeSnapshot(snapshotValue);
  const generatedAt = timestamp(clock());

  const payload = Object.freeze({
    schema: PERSONAL_ACTIVITY_EXPORT_SCHEMA,
    generatedAt,
    owner: Object.freeze({
      ownerKind: snapshot.ownerKind,
      ownerId: snapshot.ownerId,
    }),
    persistence: snapshot.persistence,
    authorityReplayable: false,
    workItems: snapshot.workItems,
    activities: snapshot.activities,
    results: snapshot.results,
    approvals: Object.freeze(snapshot.approvals.map(stripGrantRef)),
    decisions: Object.freeze(snapshot.decisions.map(stripGrantRef)),
    attempts: Object.freeze(snapshot.attempts.map(stripGrantRef)),
  });

  const text = JSON.stringify(payload, null, 2) + "\n";
  const bytes = new TextEncoderCtor().encode(text);
  return validatePersonalActivityExportDocument({
    schema: PERSONAL_ACTIVITY_EXPORT_SCHEMA,
    fileName: `ordax-activity-${fileStamp(generatedAt)}.json`,
    mediaType: "application/json",
    bytes,
  });
}
