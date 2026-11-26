// Read-only Windows projection of the existing canonical update-status port.
// This is an adapter, not another update policy or a release authority.
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { validateUpdateStatusSnapshot } from "../../contracts/update-status.mjs";
import { validateUpdateHistorySnapshot } from "../../contracts/update-history.mjs";

const SHA = /^[0-9a-f]{40}$/;
const UPDATE_STATE = "desktop-dev-update-state.json";
const JOURNAL_SCHEMA = "ordax.desktop-dev-update-state/1";
const JOURNAL_FIELDS = ["activeSha", "previousSha", "pendingSha", "attemptedSha", "pinnedSha", "rejectedSha"];
const CHECK_PHASES = new Set(["checking", "fetching", "validating", "idle", "blocked", "error"]);
const CHECK_ERRORS = Object.freeze({
  "remote-unavailable": "Consulta ou obtencao da main indisponivel; ultima revisao valida preservada.",
  "stage-failed": "Falha na preparacao da revisao; nenhuma ativacao foi autorizada.",
  "diverged": "Historico da main divergente; ultima revisao valida preservada.",
  "untrusted": "Candidato nao comprovado; nenhuma ativacao foi autorizada.",
  "conflict": "Estado de atualizacao mudou durante a tentativa.",
  "incompatible": "Revisao incompativel com o contrato Desktop/Surface.",
  "rejected": "Revisao rejeitada pelo atualizador.",
  "first-run-pending": "Conclua a configuracao inicial para habilitar a consulta da main.",
});
function validCheck(check) {
  return check == null || (typeof check === "object" && !Array.isArray(check) &&
    typeof check.attemptId === "string" && /^[a-f0-9-]{36}$/.test(check.attemptId) &&
    CHECK_PHASES.has(check.phase) &&
    (check.targetSha === null || (typeof check.targetSha === "string" && SHA.test(check.targetSha))) &&
    typeof check.checkedAt === "string" && Number.isFinite(Date.parse(check.checkedAt)) &&
    (check.error === null || Object.hasOwn(CHECK_ERRORS, check.error)));
}

export async function readDesktopDevUpdateState(userData, { read = readFile, stat = lstat } = {}) {
  if (typeof userData !== "string" || !userData) {
    throw new TypeError("The Windows Desktop update profile directory is required");
  }
  let parsed;
  try {
    const path = join(userData, UPDATE_STATE);
    const info = await stat(path);
    // The writable Owner/Dev journal must be a regular host-owned file,
    // never a junction/symlink to an unrelated file. Mirror the updater gate.
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Windows Desktop update journal is not a regular file");
    parsed = JSON.parse(await read(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Windows Desktop update journal is unavailable or corrupt", { cause: error });
  }
  if (!parsed || parsed.schema !== JOURNAL_SCHEMA || !validCheck(parsed.check) ||
      JOURNAL_FIELDS.some(key => parsed[key] !== null && !(typeof parsed[key] === "string" && SHA.test(parsed[key]))) ||
      (parsed.pendingSha && parsed.pendingSha === parsed.activeSha) ||
      (parsed.attemptedSha && parsed.attemptedSha !== parsed.pendingSha) ||
      (parsed.pinnedSha && parsed.pinnedSha !== parsed.activeSha) ||
      (parsed.incompatibleSha !== undefined && parsed.incompatibleSha !== null &&
       !(typeof parsed.incompatibleSha === "string" && SHA.test(parsed.incompatibleSha)))) {
    throw new Error("Windows Desktop update journal is untrusted");
  }
  return parsed;
}

export function projectDesktopUpdateState(journal, {
  bundledSourceSha = "bundled-desktop", renderedSourceSha = "", checkedAt = "unknown", lastError = "",
} = {}) {
  // The running SHA comes from the Electron host AFTER verifying the compiled
  // Native bundle or immutable Git candidate. Never infer an activated Git SHA
  // from a packaged fallback or trust a SHA supplied by the browser.
  if (renderedSourceSha !== "" && (typeof renderedSourceSha !== "string" || !SHA.test(renderedSourceSha))) {
    throw new TypeError("Windows Desktop rendered source proof is invalid");
  }
  const active = journal?.activeSha || "";
  const pending = journal?.pendingSha || "";
  // A journal only records a previous Git transaction; it is not a proof of
  // which source is currently rendered. The Electron host provides that proof.
  const sourceSha = renderedSourceSha || bundledSourceSha;
  if (typeof sourceSha !== "string" || sourceSha.length === 0) throw new TypeError("A source identifier is required");
  const pinned = Boolean(journal?.pinnedSha);
  const rejected = Boolean(journal?.rejectedSha);
  const incompatible = journal?.incompatibleSha || "";
  const failedAttempt = Boolean(journal?.attemptedSha);
  const check = journal?.check;
  if (!validCheck(check)) throw new TypeError("Windows Desktop update observation is untrusted");
  const observing = Boolean(check && !pinned && !pending && !rejected && !incompatible);
  const preparing = observing && ["checking", "fetching", "validating"].includes(check.phase);
  // An invalid/missing active tree may have fallen back to the packaged
  // version. Do not describe the old journal SHA as currently running.
  const activeMismatch = Boolean(active && renderedSourceSha && renderedSourceSha !== active
    && renderedSourceSha !== pending);
  const running = Boolean(renderedSourceSha && !activeMismatch);
  const error = !renderedSourceSha
    ? "A revisao executada nao foi comprovada pelo host; o journal nao confirma execucao."
    : activeMismatch
    ? "A revisao ativa do journal difere do codigo executado; usando a ultima Surface valida."
    : incompatible
      ? "A revisao "+incompatible.slice(0,12)+" da main nao atende ao contrato Desktop/Surface; ultima versao valida preservada."
      : running ? "" : "A fonte main ainda nao foi ativada no Desktop; o host usa o snapshot integrado.";
  return validateUpdateStatusSnapshot({
    sourceSha,
    runtimeSurfaceSha: sourceSha,
    targetSha: pending || incompatible || (observing ? check.targetSha || "" : ""),
    deliveryNumber: 0, // Git SHA is not an OrdaX delivery number.
    status: !running ? "unavailable"
      : pinned ? "pinned" : pending || preparing ? "updating" : rejected ? "rejected" : "running",
    phase: activeMismatch ? "error" : !running ? "blocked"
      : pending ? (failedAttempt ? "health-wait" : "activating")
      : pinned || rejected || incompatible ? "blocked" : observing ? check.phase : "idle",
    applyMode: "surface-restart", // The safe automatic Electron relaunch performs a one-shot Native health trial.
    updateTransport: journal ? "git-main" : "unavailable",
    checkedAt: check?.checkedAt || checkedAt,
    attemptId: observing ? check.attemptId : "",
    bootRefreshRequired: false, // Windows shell restart is not the Linux Base/UEFI refresh.
    rejectedSha: journal?.rejectedSha || "",
    // A bundled installer is not a previously activated Git transaction.
    lastAppliedSha: active,
    lastError: String(lastError || error || (observing && check.error ? CHECK_ERRORS[check.error] : "")).slice(0,350),
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
