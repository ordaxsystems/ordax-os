export type DesktopWindow = { title: string; minimized: boolean; maximized: boolean };
export type DesktopState = { windows: DesktopWindow[]; active: string | null };
export type DesktopAction = { type: 'open' | 'close' | 'minimize' | 'maximize' | 'focus'; title: string } | { type: 'show-desktop' };
export const initialDesktopState: DesktopState = { windows: [], active: null };
export function desktopReducer(state: DesktopState, action: DesktopAction): DesktopState {
  if (action.type === 'show-desktop') return { windows: state.windows.map(w => ({ ...w, minimized: true })), active: null };
  const existing = state.windows.find(w => w.title === action.title);
  if (action.type === 'open' || action.type === 'focus') {
    const window = existing ? { ...existing, minimized: false } : { title: action.title, minimized: false, maximized: false };
    return { windows: [...state.windows.filter(w => w.title !== action.title), window], active: action.title };
  }
  const windows = action.type === 'close' ? state.windows.filter(w => w.title !== action.title) : state.windows.map(w => w.title === action.title ? { ...w, minimized: action.type === 'minimize' ? true : w.minimized, maximized: action.type === 'maximize' ? !w.maximized : w.maximized } : w);
  return { windows, active: action.type === 'maximize' ? action.title : windows.filter(w => !w.minimized).at(-1)?.title ?? null };
}
