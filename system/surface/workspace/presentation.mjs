// Presentation policy shared by Native and React consumers. No persisted state.
const PRESENTATION_DESTINATIONS = Object.freeze({
  central: Object.freeze({ target: "desktop", labelId: "shell.presentation.desktop" }),
  desktop: Object.freeze({ target: "central", labelId: "shell.presentation.central" }),
});

// The toggle describes its destination, rather than the currently visible view.
export function presentationDestination(presentation) {
  defaultSidebarForPresentation(presentation);
  return PRESENTATION_DESTINATIONS[presentation];
}
export function defaultSidebarForPresentation(presentation) {
  if (presentation !== 'central' && presentation !== 'desktop') throw new TypeError('Unsupported workspace presentation');
  return presentation === 'desktop' ? 'collapsed' : 'auto';
}

// Desktop uses an icon rail permanently; Central supports manual sizing.
export function resolveSidebarMode(presentation, requestedMode) {
  defaultSidebarForPresentation(presentation);
  if (!["auto", "collapsed", "expanded"].includes(requestedMode)) {
    throw new TypeError("Unsupported sidebar presentation");
  }
  return presentation === "desktop" ? "collapsed" : requestedMode;
}
