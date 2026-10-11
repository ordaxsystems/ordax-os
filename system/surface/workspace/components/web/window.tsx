import { useRef, type CSSProperties, type Dispatch, type PointerEvent, type RefObject } from 'react';
import { Minus, Maximize2, Minimize2, X, Grip, PanelsTopLeft, MoreHorizontal, MoveUpRight } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { WindowMenu } from './window-menu';
import { Button } from '@/components/ui/button';
import { getWebApp } from '@/lib/web/model';
import type { WindowState, WindowAction } from '@/lib/web/windows';
import { AppIcon } from './primitives';
import { AppContent, type Appearance } from './app-content';

type Props = { primaryPane: RefObject<HTMLDivElement | null>; window: WindowState; compactIndex: number; compactVisible: boolean; active: boolean; dispatch: Dispatch<WindowAction>; appearance: Appearance; onAppearance: (value: Appearance) => void };
type Drag = { pointerId: number; startX: number; startY: number; x: number; y: number; width: number; height: number; containerWidth: number; containerHeight: number; resize: boolean };
export function AppWindow({ window: win, compactIndex, compactVisible, active, dispatch, appearance, onAppearance, primaryPane }: Props) {
  const app = getWebApp(win.appId);
  const root = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  function start(e: PointerEvent<HTMLElement>, resize = false) {
    if (win.mode !== 'normal' || globalThis.matchMedia('(max-width: 760px)').matches || (!resize && (e.target as HTMLElement).closest('button'))) return;
    const bounds = primaryPane.current?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return;
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: win.x, y: win.y, width: win.width, height: win.height, containerWidth: bounds.width, containerHeight: bounds.height, resize };
    e.currentTarget.setPointerCapture(e.pointerId);
    dispatch({ type: 'focus', appId: win.appId });
  }
  function move(e: PointerEvent<HTMLElement>) {
    const data = drag.current;
    if (!data || data.pointerId !== e.pointerId) return;
    const dx = (e.clientX - data.startX) / data.containerWidth * 100;
    const dy = (e.clientY - data.startY) / data.containerHeight * 100;
    dispatch({ type: 'geometry', appId: win.appId, x: data.resize ? data.x : data.x + dx, y: data.resize ? data.y : data.y + dy, width: data.resize ? data.width + dx : data.width, height: data.resize ? data.height + dy : data.height });
  }
  function end() { drag.current = null; }
  const style = { '--window-x': `${win.x}%`, '--window-y': `${win.y}%`, '--window-width': `${win.width}%`, '--window-height': `${win.height}%`, '--window-layer': Math.min(win.layer + 5, 35), '--compact-index': compactIndex } as CSSProperties;
  return <section ref={root} aria-label={`Janela ${app.name}`} className={`web-window ${active ? 'web-window-active' : ''} web-window-${win.mode} ${win.mode === 'compact' && !compactVisible ? 'web-compact-hidden' : ''}`} data-instance={win.id} style={style} onFocusCapture={() => { if (!active) dispatch({ type: 'focus', appId: win.appId }); }} onPointerDown={() => { if (!active) dispatch({ type: 'focus', appId: win.appId }); }}>
    <header className="web-window-titlebar" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={e => { if (e.currentTarget.contains(e.target as Node) && !(e.target as HTMLElement).closest('button')) dispatch({ type: 'maximize', appId: win.appId }); }}><span><AppIcon id={win.appId} small/><strong>{app.name}</strong><small>Protótipo</small></span><div><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Menu da janela ${app.name}`} title="Opções da janela"><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent className="web-window-menu" onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}><WindowMenu win={win} dispatch={dispatch}/></DropdownMenuContent></DropdownMenu><Button variant="ghost" size="icon" aria-label={`${win.mode === 'compact' ? 'Destacar' : 'Compactar'} ${app.name}`} title={win.mode === 'compact' ? 'Destacar' : 'Modo compacto'} onClick={() => dispatch({ type: win.mode === 'compact' ? 'restore' : 'compact', appId: win.appId })}>{win.mode === 'compact' ? <MoveUpRight/> : <PanelsTopLeft/>}</Button><Button variant="ghost" size="icon" aria-label={`Minimizar ${app.name}`} title="Minimizar" onClick={() => dispatch({ type: 'minimize', appId: win.appId })}><Minus/></Button><Button variant="ghost" size="icon" className="web-maximize-control" aria-label={`${(win.mode === 'maximized') ? 'Restaurar' : 'Maximizar'} ${app.name}`} title={(win.mode === 'maximized') ? 'Restaurar' : 'Maximizar'} onClick={() => dispatch({ type: 'maximize', appId: win.appId })}>{(win.mode === 'maximized') ? <Minimize2/> : <Maximize2/>}</Button><Button className="web-window-close" variant="ghost" size="icon" aria-label={`Fechar ${app.name}`} title="Fechar" onClick={() => dispatch({ type: 'close', appId: win.appId })}><X/></Button></div></header>
    <div className="web-window-content"><AppContent id={win.appId} appearance={appearance} onAppearance={onAppearance} onOpen={appId => dispatch({ type: 'open', appId })}/></div>
    {win.mode === 'normal' && <Button variant="ghost" size="icon" className="web-window-resize" aria-label={`Redimensionar ${app.name}`} title="Redimensionar" onPointerDown={e => start(e, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); dispatch({ type: 'geometry', appId: win.appId, x: win.x, y: win.y, width: win.width + (e.key === 'ArrowRight' ? 3 : e.key === 'ArrowLeft' ? -3 : 0), height: win.height + (e.key === 'ArrowDown' ? 3 : e.key === 'ArrowUp' ? -3 : 0) }); }}><Grip/></Button>}
  </section>;
}