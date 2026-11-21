// Pure presentation key: offline transport is not equivalent to a logout.
// The OS identity session remains the only authority for signed-in state.
export function sidebarAccountStatusKey(sessionState, offline = false) {
  if (sessionState === "signed-out") return "sidebar.account.connect";
  if (offline) return "sidebar.account.offline";
  return sessionState === "signed-in"
    ? "sidebar.account.signedIn" : "sidebar.account.connect";
}
