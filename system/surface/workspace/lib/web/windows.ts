import type { WebAppId } from './model';

export type WindowMode = 'normal' | 'maximized' | 'compact' | 'minimized' | 'immersive';
export type WindowState = { id: string; appId: WebAppId; x: number; y: number; width: number; height: number; mode: WindowMode; previousMode: Exclude<WindowMode, 'minimized' | 'immersive'>; layer: number };
export type WindowAction = { type: 'open'; appId: WebAppId } | { type: 'focus' | 'close' | 'minimize' | 'maximize' | 'compact' | 'immersive' | 'restore'; appId: WebAppId } | { type: 'geometry'; appId: WebAppId; x: number; y: number; width?: number; height?: number } | { type: 'desktop' } | { type: 'arrange' } | { type: 'compact-all' };
export const initialWindows: WindowState[] = (['files', 'studio', 'internet'] as const).map((appId, index) => ({ id: `web-${appId}`, appId, x: 8 + index * 4, y: 8 + index * 4, width: 66, height: 75, mode: 'compact', previousMode: 'normal', layer: index + 1 }));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function windowReducer(state: WindowState[], action: WindowAction): WindowState[] {
  const nextLayer = Math.max(0, ...state.map(win => win.layer)) + 1;
  if (action.type === 'compact-all') return state.map(win => ({ ...win, mode: 'compact', previousMode: 'normal' }));
  if (action.type === 'desktop') return state.map(win => win.mode === 'minimized' || win.mode === 'compact' ? win : ({ ...win, previousMode: win.mode === 'immersive' ? win.previousMode : win.mode, mode: 'minimized' }));
  if (action.type === 'arrange') {
    const visible = state.filter(win => win.mode === 'normal' || win.mode === 'maximized');
    const columns = Math.min(3, visible.length || 1), rows = Math.max(1, Math.ceil(visible.length / columns));
    return state.map(win => { const i = visible.findIndex(item => item.id === win.id); return i < 0 ? win : { ...win, mode: 'normal', x: 1 + i % columns * 98 / columns, y: 1 + Math.floor(i / columns) * 98 / rows, width: 98 / columns - 1, height: 98 / rows - 1 }; });
  }
  const existing = state.find(win => win.appId === action.appId);
  if (!existing && action.type === 'open') return [...state, { id: `web-${action.appId}`, appId: action.appId, x: 8 + state.length % 4 * 4, y: 8 + state.length % 4 * 4, width: 66, height: 75, mode: 'maximized', previousMode: 'normal', layer: nextLayer }];
  if (action.type === 'close') return state.filter(win => win.appId !== action.appId);
  return state.map(win => {
    if (win.appId !== action.appId) return win;
    if (action.type === 'focus') return { ...win, layer: nextLayer };
    if (action.type === 'open' || action.type === 'restore') return { ...win, layer: nextLayer, mode: win.mode === 'minimized' ? (win.previousMode === 'compact' ? 'maximized' : win.previousMode) : win.mode === 'compact' ? 'maximized' : win.mode === 'immersive' ? win.previousMode : win.mode };
    if (action.type === 'minimize') return { ...win, mode: 'minimized', previousMode: win.mode === 'minimized' || win.mode === 'immersive' ? win.previousMode : win.mode };
    if (action.type === 'compact') return { ...win, mode: 'compact', previousMode: 'normal' };
    if (action.type === 'maximize') return { ...win, layer: nextLayer, mode: win.mode === 'maximized' ? win.previousMode : 'maximized', previousMode: win.mode === 'maximized' || win.mode === 'minimized' || win.mode === 'immersive' ? win.previousMode : win.mode };
    if (action.type === 'immersive') return { ...win, layer: nextLayer, mode: win.mode === 'immersive' ? win.previousMode : 'immersive', previousMode: win.mode === 'immersive' || win.mode === 'minimized' ? win.previousMode : win.mode };
    if (action.type === 'geometry' && win.mode === 'normal') { const width = clamp(action.width ?? win.width, 26, 98), height = clamp(action.height ?? win.height, 25, 98); return { ...win, width, height, x: clamp(action.x, 0, 100 - width), y: clamp(action.y, 0, 100 - height) }; }
    return win;
  });
}
