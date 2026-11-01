// Read-only Windows projection of the existing canonical update-status port.
// This is an adapter, not another update policy or a release authority.
import { open, lstat } from "node:fs/promises";
import { join } from "node:path";
import { validateUpdateStatusSnapshot } from "../../contracts/update-status.mjs";
import { validateUpdateHistorySnapshot } from "../../contracts/update-history.mjs";

const SHA = /^[0-9a-f]{40}$/;
const UPDATE_STATE = "desktop-dev-update-state.json";
const MAX_JOURNAL_BYTES = 8 * 1024;
const JOURNAL_SCHEMA = "ordax.desktop-dev-update-state/1";
const JOURNAL_FIELDS = ["activeSha", "previousSha", "pendingSha", "attemptedSha", "pinnedSha", "rejectedSha"];

function sameFileIdentity(left, right) {
  for (const key of ["dev", "ino"]) {
    if (Number.isSafeInteger(left?.[key]) && Number.isSafeInteger(right?.[key])
      && left[key] !== right[key]) return false;
  }
  return true;
}

// Read at most MAX_JOURNAL_BYTES + 1 even if the host-owned file is replaced
// or grows between the first lstat and open. The handle pins the file under
// inspection; re-stat both it and the pathname before accepting its contents.
async function readBoundedJournal(path, _encoding, initial) {
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size < 1 || opened.size > MAX_JOURNAL_BYTES
      || opened.size !== initial.size || !sameFileIdentity(initial, opened)) {
      throw new Error("Windows Desktop update journal changed during open");
    }
    const buffer = Buffer.alloc(MAX_JOURNAL_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const final = await handle.stat();
    const pathFinal = await lstat(path);
    if (length > MAX_JOURNAL_BYTES || length !== opened.size
      || final.size !== opened.size || final.mtimeMs !== opened.mtimeMs
      || !sameFileIdentity(opened, final)
      || !pathFinal.isFile() || pathFinal.isSymbolicLink()
      || pathFinal.size !== opened.size || !sameFileIdentity(opened, pathFinal)) {
      throw new Error("Windows Desktop update journal changed during read");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}

export async function readDesktopDevUpdateState(userData, { read = readBoundedJournal, stat = lstat } = {}) {
  if (typeof userData !== "string" || !userData) {
    throw new TypeError("The Windows Desktop update profile directory is required");
  }
  let parsed;
  try {
    const path = join(userData, UPDATE_STATE);
    const info = await stat(path);
    // The writable Owner/Dev journal must be a regular host-owned file,
    // never a junction/symlink to an unrelated file. Mirror the updater gate.
    if (!info.isFile() || info.isSymbolicLink()
      || !Number.isSafeInteger(info.size)
      || info.size < 1 || info.size > MAX_JOURNAL_BYTES) {
      throw new Error("Windows Desktop update journal is not a bounded regular file");
    }
    const raw = await read(path, "utf8", info);
    // A replaced/growing journal cannot escape the same bounded read contract.
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_JOURNAL_BYTES) {
      throw new Error("Windows Desktop update journal exceeded safe bounds");
    }
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Windows Desktop update journal is unavailable or corrupt", { cause: error });
  }
  if (!parsed || parsed.schema !== JOURNAL_SCHEMA ||
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
  // A persisted Git journal is history, not proof that Electron loaded it.
  // The installed Desktop host alone supplies the observed, verified SHA.
  const runtimeProven = Boolean(renderedSourceSha);
  const sourceSha = renderedSourceSha || bundledSourceSha;
  if (typeof sourceSha !== "string" || sourceSha.length === 0) throw new TypeError("A source identifier is required");
  const pinned = Boolean(journal?.pinnedSha);
  const rejected = Boolean(journal?.rejectedSha);
  const incompatible = journal?.incompatibleSha || "";
  const failedAttempt = Boolean(journal?.attemptedSha);
  // An invalid/missing active tree may have fallen back to the packaged
  // version. Do not describe the old journal SHA as currently running.
  const activeMismatch = Boolean(active && renderedSourceSha && renderedSourceSha !== active
    && renderedSourceSha !== pending);
  const running = runtimeProven && !activeMismatch;
  const error = activeMismatch
    ? "A revisao ativa do journal difere do codigo executado; usando a ultima Surface valida."
    : incompatible
      ? "A revisao "+incompatible.slice(0,12)+" da main nao atende ao contrato Desktop/Surface; ultima versao valida preservada."
      : running ? "" : "A revisao em execucao ainda nao foi atestada pelo host Desktop.";
  return validateUpdateStatusSnapshot({
    sourceSha,
    runtimeSurfaceSha: sourceSha,
    targetSha: pending || incompatible,
    deliveryNumber: 0, // Git SHA is not an OrdaX delivery number.
    status: activeMismatch || !running ? "unavailable"
      : pinned ? "pinned" : pending ? "updating" : rejected ? "rejected"
      : "running",
    phase: activeMismatch ? "error"
      : !running ? "blocked"
      : pending ? (failedAttempt ? "health-wait" : "activating")
      : pinned || rejected || incompatible ? "blocked" : "idle",
    applyMode: "surface-restart", // The safe automatic Electron relaunch performs a one-shot Native health trial.
    updateTransport: journal ? "git-main" : "unavailable",
    checkedAt,
    bootRefreshRequired: false, // Windows shell restart is not the Linux Base/UEFI refresh.
    rejectedSha: journal?.rejectedSha || "",
    // A bundled installer is not a previously activated Git transaction.
    lastAppliedSha: active,
    lastError: String(lastError || error).slice(0,350),
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
