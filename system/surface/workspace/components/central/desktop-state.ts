export type WindowMode = 'normal' | 'maximized' | 'compact';
export type DesktopWindow = { title: string; initialPrompt?: { text: string }; mode: WindowMode; minimized: boolean; expandedMode: Exclude<WindowMode, 'compact'> };
export type DesktopState = { windows: DesktopWindow[]; active: string | null; compactCollapsed: boolean };
export type DesktopAction = { type: 'open'; title: string; prompt?: string } | { type: 'close' | 'minimize' | 'maximize' | 'focus' | 'compact' | 'restore'; title: string } | { type: 'show-desktop' } | { type: 'toggle-compact'; collapsed?: boolean };
export const initialDesktopState: DesktopState = { windows: [], active: null, compactCollapsed: false };

// Visibility is independent of size: minimizing never discards the current mode.
export function desktopReducer(state: DesktopState, action: DesktopAction): DesktopState {
  if (action.type === 'toggle-compact') return { ...state, compactCollapsed: action.collapsed ?? !state.compactCollapsed };
  if (action.type === 'show-desktop') return { ...state, windows: state.windows.map(w => ({ ...w, minimized: true })), active: null };
  const existing = state.windows.find(w => w.title === action.title);
  if (!existing && action.type !== 'open') return state;
  // Focusing a visible compact pane must not reorder its neighbors or expand the strip.
  if (action.type === 'focus' && existing?.mode === 'compact' && !existing.minimized) {
    return state.active === action.title ? state : { ...state, active: action.title };
  }
  let window: DesktopWindow = existing ?? { title: action.title, mode: 'maximized', minimized: false, expandedMode: 'maximized' };
  switch (action.type) {
    case 'open': window = { ...window, minimized: false, ...(action.prompt !== undefined ? { initialPrompt: { text: action.prompt } } : {}) }; break;
    case 'focus': window = { ...window, minimized: false }; break;
    case 'minimize': window = { ...window, minimized: true }; break;
    case 'compact': window = { ...window, minimized: false, mode: 'compact', expandedMode: window.mode === 'compact' ? window.expandedMode : window.mode }; break;
    case 'restore': window = { ...window, minimized: false, mode: window.mode === 'compact' ? window.expandedMode : window.mode }; break;
    case 'maximize': window = { ...window, minimized: false, mode: window.mode === 'maximized' ? 'normal' : 'maximized' }; break;
  }
  const windows = [...state.windows.filter(w => w.title !== action.title), ...(action.type === 'close' ? [] : [window])];
  return { windows, active: windows.filter(w => !w.minimized).at(-1)?.title ?? null, compactCollapsed: window.mode === 'compact' && !window.minimized && action.type !== 'close' ? false : state.compactCollapsed };
}
