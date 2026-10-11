import { initialWindows, windowReducer, type WindowAction, type WindowState } from './windows';
import { webNavigation, type WebAppId, type WebView } from './model';
export type WorkspaceState = { page: WebView; spaceId: null; windows: WindowState[]; favorites: WebAppId[]; appearance: { wallpaper: boolean; compact: boolean }; carouselCollapsed: boolean; carouselBeforePage: boolean | null; carouselOffset: number; overview: boolean; intelligence: boolean };
export type WorkspaceAction = WindowAction | { type: 'navigate'; view: WebView } | { type: 'appearance'; value: WorkspaceState['appearance'] } | { type: 'carousel-collapse' } | { type: 'overview' } | { type: 'intelligence' } | { type: 'carousel-offset'; value: number };
export const initialWorkspace: WorkspaceState = { page: 'home', spaceId: null, windows: initialWindows, favorites: ['assistant', 'internet', 'files', 'projects', 'spaces', 'store'], appearance: { wallpaper: true, compact: false }, carouselCollapsed: false, carouselBeforePage: null, carouselOffset: 0, overview: false, intelligence: false };
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  if (action.type === 'navigate') { const target = webNavigation.find(item => item.id === action.view); if (target?.kind === 'app' && target.app) return workspaceReducer(state, { type: 'open', appId: target.app }); if (target?.kind === 'panel') return { ...state, intelligence: true }; const entering = action.view !== 'home' && action.view !== state.page; const leaving = action.view === 'home' && state.page !== 'home';
    const carousel = entering ? { carouselCollapsed: true, carouselBeforePage: state.carouselBeforePage ?? state.carouselCollapsed } : leaving ? { carouselCollapsed: state.carouselBeforePage ?? state.carouselCollapsed, carouselBeforePage: null } : {};
    return { ...state, ...carousel, page: action.view, intelligence: false, windows: windowReducer(state.windows, { type: 'desktop' }), overview: false }; }
  if (action.type === 'appearance') return { ...state, appearance: action.value };
  if (action.type === 'carousel-collapse') return { ...state, carouselCollapsed: !state.carouselCollapsed };
  if (action.type === 'carousel-offset') return { ...state, carouselOffset: Math.max(0, action.value) };
  if (action.type === 'overview') return { ...state, overview: !state.overview };
  if (action.type === 'intelligence') return { ...state, intelligence: !state.intelligence };
  return { ...state, carouselCollapsed: action.type === 'compact' || action.type === 'compact-all' ? false : state.carouselCollapsed, intelligence: action.type === 'open' || action.type === 'restore' ? false : state.intelligence, windows: windowReducer(state.windows, action), overview: action.type === 'open' || action.type === 'restore' ? false : state.overview };
}
