// Windows recovery observation. This is explicitly NOT portable-v2 boot recovery.
// Uses the same verified Desktop Dev journal; never fabricates Linux UEFI slots.
export const DESKTOP_RECOVERY_SCHEMA = "ordax.desktop-recovery/1";
const SHA = /^[a-f0-9]{40}$/;
const safeSha = value => value === null || (typeof value === "string" && SHA.test(value));
export function validateDesktopRecoverySnapshot(value) {
  if (!value || value.schema !== DESKTOP_RECOVERY_SCHEMA ||
      !["bundled", "verified-source", "unavailable"].includes(value.runningKind) ||
      !["none", "staged", "attempted"].includes(value.candidateState) ||
      !["available", "unavailable"].includes(value.rollbackState) ||
      !["none", "pinned"].includes(value.updatePin) ||
      !["none", "rejected"].includes(value.rejectionState) ||
      !["activeSha", "previousSha", "pendingSha", "rejectedSha"].every(k => safeSha(value[k]))) {
    throw new TypeError("Invalid Windows recovery observation");
  }
  return Object.freeze({...value});
}
export function projectDesktopRecovery(journal) {
  return validateDesktopRecoverySnapshot({
    schema: DESKTOP_RECOVERY_SCHEMA,
    platform: "windows",
    runningKind: journal?.activeSha ? "verified-source" : "bundled",
    activeSha: journal?.activeSha || null,
    previousSha: journal?.previousSha || null,
    pendingSha: journal?.pendingSha || null,
    rejectedSha: journal?.rejectedSha || null,
    candidateState: journal?.pendingSha ? (journal?.attemptedSha ? "attempted" : "staged") : "none",
    rollbackState: journal?.previousSha ? "available" : "unavailable",
    updatePin: journal?.pinnedSha ? "pinned" : "none",
    rejectionState: journal?.rejectedSha ? "rejected" : "none",
    mutationAuthorized: false,
  });
}
