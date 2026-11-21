// UI-only React key for ephemeral Meridian Home drafts and example checklist.
// Authentication and Space access are decided upstream by the OS projection.
// Do not include connectivity: losing network is not a change of identity.
export function meridianHomeContextKey(identity, authorizedSpace) {
  if (identity?.state === "signed-in") {
    return JSON.stringify(["signed-in", identity.subjectId, authorizedSpace?.id ?? null]);
  }
  return JSON.stringify([identity?.state ?? "unavailable"]);
}
