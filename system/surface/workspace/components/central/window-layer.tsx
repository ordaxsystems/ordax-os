import { useEffect, useRef, type Dispatch } from 'react';
import { ChevronDown, ChevronUp, Copy, LayoutGrid, Minus, PanelBottom, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DesktopContent, type PresentationProps } from './desktop';
import type { DesktopAction, DesktopState } from './desktop-state';

type Props = PresentationProps & { state: DesktopState; dispatch: Dispatch<DesktopAction> };

// One stable parent keeps each app mounted through view and window-mode changes.
export function WindowLayer({ state, dispatch, ...presentation }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const previousActive = useRef<string | null>(null);
  const panes = useRef(new Map<string, HTMLElement>());
  const compact = state.windows.filter(w => !w.minimized && w.mode === 'compact');
  const regular = state.windows.filter(w => !w.minimized && w.mode !== 'compact').at(-1);
  const activeMode = state.windows.find(w => w.title === state.active)?.mode;
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
  }, [state.active, activeMode]);
  return <div ref={layer} className="workspace-windows" role="group" aria-label="Janelas de apps"><div className="compact-window-strip" data-count={compact.length}>
    {state.windows.map(window => {
      const selected = window.mode === 'compact' || window.title === regular?.title;
      const collapsed = window.mode === 'compact' && state.compactCollapsed;
      return <section key={window.title} ref={node => { if (node) panes.current.set(window.title, node); else panes.current.delete(window.title); }} role="region" tabIndex={-1}
        aria-label={`Janela ${window.title}`} className="desktop-window workspace-window" hidden={window.minimized || !selected}
        data-mode={window.mode} data-active={state.active === window.title} data-maximized={window.mode === 'maximized'} data-collapsed={collapsed}
        onFocus={() => { if (state.active !== window.title) dispatch({ type: 'focus', title: window.title }); }}
        onPointerDown={() => { if (state.active !== window.title) dispatch({ type: 'focus', title: window.title }); }}>
        <header className="desktop-titlebar">
          <span className="desktop-window-title"><LayoutGrid/><span>{window.title}</span></span>
          <div className="desktop-window-controls">
            {window.mode === 'compact' && <Button variant="ghost" size="icon" aria-label={`${collapsed ? 'Expandir' : 'Recolher'} painel ${window.title}`} aria-expanded={!collapsed} title={collapsed ? 'Expandir painel' : 'Recolher painel'} onClick={() => dispatch({ type: 'toggle-compact', collapsed: !collapsed })}>{collapsed ? <ChevronUp/> : <ChevronDown/>}</Button>}
            <Button variant="ghost" size="icon" aria-label={`Minimizar ${window.title}`} title="Minimizar" onClick={() => dispatch({ type: 'minimize', title: window.title })}><Minus/></Button>
            <Button variant="ghost" size="icon" aria-label={`${window.mode === 'compact' ? 'Expandir janela' : 'Compactar'} ${window.title}`} title={window.mode === 'compact' ? 'Expandir janela' : 'Modo compacto'} onClick={() => dispatch({ type: window.mode === 'compact' ? 'restore' : 'compact', title: window.title })}>{window.mode === 'compact' ? <Copy/> : <PanelBottom/>}</Button>
            {window.mode !== 'compact' && <Button variant="ghost" size="icon" aria-label={`${window.mode === 'maximized' ? 'Restaurar' : 'Maximizar'} ${window.title}`} title={window.mode === 'maximized' ? 'Restaurar tamanho' : 'Maximizar'} onClick={() => dispatch({ type: 'maximize', title: window.title })}>{window.mode === 'maximized' ? <Copy/> : <Square/>}</Button>}
            <Button variant="ghost" size="icon" className="window-close" aria-label={`Fechar ${window.title}`} title="Fechar" onClick={() => dispatch({ type: 'close', title: window.title })}><X/></Button>
          </div>
        </header>
        <div className="desktop-window-body" hidden={collapsed}>
          <DesktopContent {...presentation} title={window.title} initialPrompt={window.initialPrompt} open={title => dispatch({ type: 'open', title })}/>
        </div>
      </section>;
    })}
  </div></div>;
}
