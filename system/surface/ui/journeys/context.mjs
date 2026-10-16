// Localized shared presentation. No account, device or backend authority.
import {translateSurfaceMessage} from '../../../services/i18n/surface.mjs';


export function createJourneyContext(locale='pt-BR') {
 const m=id=>translateSurfaceMessage(locale,id);

/** Read-only selectors over the injected presentation snapshot; no authority or cache. */
function currentContext(data) {
    const space = data.spaces.find(item => item.id === data.activeSpace) ?? { id: null, name: m("meridian.text.0897"), icon: 'spaces', tone: 'slate', profile: m("meridian.text.0001"), modules: [] };
    const projects = data.projects.filter(item => item.space === space.id);
    const files = data.files.filter(item => item.space === space.id);
    return { space, projects, files, project: projects[0] ?? null };
}
// Foreground is presentation state, never a capability or authorization.
function foregroundWindow(ui) {
    if (ui.presentation !== 'desktop')
        return null;
    return ui.windows.find(win => win.id === ui.activeWindow && !win.minimized && !(win.mode === 'compact' && ui.compactCollapsed)) ?? null;
}
 return {currentContext,foregroundWindow};
}

export const {currentContext,foregroundWindow}=createJourneyContext();
