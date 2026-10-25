// Read-only Windows projection of the existing canonical update-status port.
// This is an adapter, not another update policy or a release authority.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateUpdateStatusSnapshot } from "../../contracts/update-status.mjs";
import { validateUpdateHistorySnapshot } from "../../contracts/update-history.mjs";

const SHA = /^[0-9a-f]{40}$/;
const UPDATE_STATE = "desktop-dev-update-state.json";
const JOURNAL_SCHEMA = "ordax.desktop-dev-update-state/1";
const JOURNAL_FIELDS = ["activeSha", "previousSha", "pendingSha", "attemptedSha", "pinnedSha", "rejectedSha"];

export async function readDesktopDevUpdateState(userData, { read = readFile } = {}) {
  if (typeof userData !== "string" || !userData) {
    throw new TypeError("The Windows Desktop update profile directory is required");
  }
  let parsed;
  try {
    parsed = JSON.parse(await read(join(userData, UPDATE_STATE), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Windows Desktop update journal is unavailable or corrupt", { cause: error });
  }
  if (!parsed || parsed.schema !== JOURNAL_SCHEMA ||
      JOURNAL_FIELDS.some(key => parsed[key] !== null && !(typeof parsed[key] === "string" && SHA.test(parsed[key]))) ||
      (parsed.attemptedSha && parsed.attemptedSha !== parsed.pendingSha) ||
      (parsed.pinnedSha && parsed.pinnedSha !== parsed.activeSha) ||
      (parsed.incompatibleSha !== undefined && parsed.incompatibleSha !== null &&
       !(typeof parsed.incompatibleSha === "string" && SHA.test(parsed.incompatibleSha)))) {
    throw new Error("Windows Desktop update journal is untrusted");
  }
  return parsed;
}

export function projectDesktopUpdateState(journal, { bundledSourceSha = "bundled-desktop", checkedAt = "unknown", lastError = "" } = {}) {
  const sourceSha = journal?.activeSha || bundledSourceSha;
  if (typeof sourceSha !== "string" || sourceSha.length === 0) throw new TypeError("A source identifier is required");
  const pending = journal?.pendingSha || "";
  const pinned = Boolean(journal?.pinnedSha);
  const rejected = Boolean(journal?.rejectedSha);
  const incompatible = journal?.incompatibleSha || "";
  const failedAttempt = Boolean(journal?.attemptedSha);
  return validateUpdateStatusSnapshot({
    sourceSha,
    runtimeSurfaceSha: sourceSha,
    targetSha: pending || incompatible,
    deliveryNumber: 0, // Git SHA is not an OrdaX delivery number.
    status: pinned ? "pinned" : pending ? "updating" : rejected ? "rejected" : journal?.activeSha ? "running" : "unavailable",
    phase: pending ? (failedAttempt ? "health-wait" : "validating")
      : pinned || rejected || incompatible || !journal?.activeSha ? "blocked" : "idle",
    applyMode: "surface-restart", // Windows activates a staged version only at next application boot.
    updateTransport: journal ? "git-main" : "unavailable",
    checkedAt,
    bootRefreshRequired: false, // Windows shell restart is not the Linux Base/UEFI refresh.
    rejectedSha: journal?.rejectedSha || "",
    lastAppliedSha: journal?.activeSha || "",
    lastError: String(lastError || (incompatible
      ? "A revisao "+incompatible.slice(0,12)+" da main nao atende ao contrato Desktop/Surface; ultima versao valida preservada."
      : journal?.activeSha ? "" :
      "A fonte main ainda nao foi ativada no Desktop; o host usa o snapshot integrado.")).slice(0,350),
  });
}

export async function readDesktopUpdateStatus(userData, options = {}) {
  try {
    const journal = await readDesktopDevUpdateState(userData, options);
    return projectDesktopUpdateState(journal, options);
  } catch (error) {
    return validateUpdateStatusSnapshot({
      sourceSha: options.bundledSourceSha || "bundled-desktop",
      status: "unavailable", phase: "error", applyMode: "none",
      lastError: "Estado de atualizacao Desktop inacessivel ou invalido; nenhum update foi autorizado.",
    });
  }
}

export function readDesktopUpdateHistory() {
  // No fabricated delivery numbers, release metadata or installation receipts.
  return validateUpdateHistorySnapshot({ releases: [], applications: [] });
}
