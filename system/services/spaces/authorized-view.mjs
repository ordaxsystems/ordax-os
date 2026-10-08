// Read-only subject-bound projection for Account and the global Space picker.
// Authorization remains server-side; this prevents stale UI exposure while
// identity, catalog and Native selection snapshots converge.
export function deriveAuthorizedSpaces(identity, catalog, selection = null) {
  const signedIn = identity?.state === "signed-in";
  const subjectMatches = selection === null || (
    selection?.state !== "unavailable"
    && selection?.subjectId === identity?.subjectId
  );
  const ready = signedIn && catalog?.state === "ready" && subjectMatches;
  const visibleSpaces = ready ? catalog.spaces : [];
  const activeSpace = selection?.state === "selected" && ready
    ? visibleSpaces.find((space) =>
      space.id === selection.selectedSpace?.id
      && space.kind === selection.selectedSpace?.kind
      && space.state === "active"
    ) ?? null
    : null;
  return Object.freeze({
    ready,
    visibleSpaces,
    activeSpace,
  });
}
