import { useEffect, useRef, useState, type Dispatch } from 'react';
import { ChevronDown, ChevronUp, Copy, Minus, MoreHorizontal, PanelBottom, Square, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { PresentationProps } from './desktop';
import { WindowContent } from './window-content';
import type { DesktopAction, DesktopState } from './desktop-state';
import { WindowAppIcon } from './primitives';

type WindowControl = { label: string; title: string; icon: LucideIcon; action: DesktopAction; expanded?: boolean };

type Props = PresentationProps & { state: DesktopState; dispatch: Dispatch<DesktopAction> };

// One stable parent keeps each app mounted through view and window-mode changes.
export function WindowLayer({ state, dispatch, ...presentation }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  // One explicit close operation survives a compact-window layout transition.
  const [openCompactMenuId, setOpenCompactMenuId] = useState<string | null>(null);
  const previousActive = useRef<string | null>(null);
  const panes = useRef(new Map<string, HTMLElement>());
  const compact = state.windows.filter(w => !w.minimized && w.mode === 'compact');
  const regular = state.windows.filter(w => !w.minimized && w.mode !== 'compact').at(-1);
  const activeWindow = state.windows.find(w => w.title === state.active);
  useEffect(() => {
    if (state.active) {
      const pane = panes.current.get(state.active);
      pane?.focus({ preventScroll: true });
    }
    else if (previousActive.current) {
      const tasks = layer.current?.parentElement?.querySelectorAll<HTMLButtonElement>('[data-window-restore]');
      const task = Array.from(tasks ?? []).find(node => node.dataset.windowRestore === previousActive.current && node.getClientRects().length > 0);
      const home = Array.from(layer.current?.parentElement?.querySelectorAll<HTMLButtonElement>('[data-window-home]') ?? []).find(node => node.getClientRects().length > 0);
      (task ?? home)?.focus({ preventScroll: true });
    }
    previousActive.current = state.active;
  }, [state.active, activeWindow]);
  return <div ref={layer} className="workspace-windows" role="group" aria-label="Janelas de apps" data-compact-count={compact.length} style={{ gridTemplateColumns: 'repeat(' + Math.max(1, compact.length) + ', minmax(0, 1fr))' }}>
    {state.windows.map(window => {
      const selected = window.mode === 'compact' || window.title === regular?.title;
      const collapsed = window.mode === 'compact' && state.compactCollapsed;
      const controls: WindowControl[] = [
        ...(window.mode === 'compact' ? [{ label: (collapsed ? 'Expandir' : 'Recolher') + ' painel ' + window.title, title: collapsed ? 'Expandir painel' : 'Recolher painel', icon: collapsed ? ChevronUp : ChevronDown, action: { type: 'toggle-compact' as const, collapsed: !collapsed }, expanded: !collapsed }] : []),
        { label: 'Minimizar ' + window.title, title: 'Minimizar', icon: Minus, action: { type: 'minimize', title: window.title } },
        { label: (window.mode === 'compact' ? 'Expandir janela' : 'Compactar') + ' ' + window.title, title: window.mode === 'compact' ? 'Expandir janela' : 'Modo compacto', icon: window.mode === 'compact' ? Copy : PanelBottom, action: { type: window.mode === 'compact' ? 'restore' : 'compact', title: window.title } },
        ...(window.mode !== 'compact' ? [{ label: (window.mode === 'maximized' ? 'Restaurar' : 'Maximizar') + ' ' + window.title, title: window.mode === 'maximized' ? 'Restaurar tamanho' : 'Maximizar', icon: window.mode === 'maximized' ? Copy : Square, action: { type: 'maximize' as const, title: window.title } }] : []),
      ];
      return <section key={window.title} ref={node => { if (node) panes.current.set(window.title, node); else panes.current.delete(window.title); }} role="region" tabIndex={-1}
        aria-label={`Janela ${window.title}`} className="desktop-window workspace-window" hidden={window.minimized || !selected}
        style={window.mode === 'compact' ? { gridColumn: compact.findIndex(pane => pane.title === window.title) + 1 } : undefined} data-mode={window.mode} data-active={state.active === window.title} data-maximized={window.mode === 'maximized'} data-collapsed={collapsed}
        onFocus={() => { if (state.active !== window.title) dispatch({ type: 'focus', title: window.title }); }}
        onPointerDown={() => { if (state.active !== window.title) dispatch({ type: 'focus', title: window.title }); }}>
        <header className="desktop-titlebar">
          <span className="desktop-window-title"><WindowAppIcon title={window.title}/><span title={window.title}>{window.title}</span></span>
          <div className="desktop-window-controls">
            <div className="window-secondary-actions">{controls.map(control => <Button key={control.label} variant="ghost" size="icon" aria-label={control.label} aria-expanded={control.expanded} title={control.title} onClick={() => dispatch(control.action)}><control.icon/></Button>)}</div>
            {window.mode === 'compact' && <div className="compact-actions-overflow"><DropdownMenu modal={false} open={openCompactMenuId === window.title} onOpenChange={open => setOpenCompactMenuId(open ? window.title : null)}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={'Mais ações de ' + window.title} title="Mais ações" onClick={() => setOpenCompactMenuId(window.title)}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={6} className="compact-actions-menu">{controls.map(control => <DropdownMenuItem key={control.label} onClick={() => { setOpenCompactMenuId(null); dispatch(control.action); }}><control.icon/>{control.title}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>}
            <Button variant="ghost" size="icon" className="window-close" aria-label={`Fechar ${window.title}`} title="Fechar" onClick={() => dispatch({ type: 'close', title: window.title })}><X/></Button>
          </div>
        </header>
        <div className="desktop-window-body" hidden={collapsed}>
          <WindowContent {...presentation} title={window.title} initialPrompt={window.initialPrompt} open={title => dispatch({ type: 'open', title })}/>
        </div>
      </section>;
    })}
  </div>;
}
