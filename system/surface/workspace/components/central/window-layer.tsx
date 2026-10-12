import { Component, lazy, Suspense, useEffect, useRef, type Dispatch, type ReactNode, type CSSProperties } from 'react';
import { ChevronDown, ChevronUp, Copy, Minus, PanelBottom, Square, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PresentationProps } from './desktop';
import { WindowContent } from './window-content';
import type { DesktopAction, DesktopState } from './desktop-state';
import { WindowAppIcon } from './primitives';

export type WindowControl = { label: string; title: string; icon: LucideIcon; action: DesktopAction; expanded?: boolean };

// Stable module identity. No dropdown code is loaded before the first compact app.
const CompactActions = lazy(() => import('./compact-actions').then(module => ({ default: module.CompactActions })));

class CompactActionsBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function ExpandCompactAction({ title, dispatch, failed = false }: { title: string; dispatch: Dispatch<DesktopAction>; failed?: boolean }) {
  return <><Button variant="ghost" size="icon" aria-label={'Expandir janela ' + title} title={failed ? 'Ações indisponíveis. Expandir janela' : 'Carregando ações. Expandir janela'} onClick={() => dispatch({ type: 'restore', title })}><Copy/></Button>{failed && <span className="sr-only" role="status">Não foi possível carregar as ações. Expanda a janela para usar seus controles.</span>}</>;
}

type Props = PresentationProps & { state: DesktopState; dispatch: Dispatch<DesktopAction> };

// One stable parent keeps each app mounted through view and window-mode changes.
export function WindowLayer({ state, dispatch, ...presentation }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  // The Radix menu owns its own presentation-open state.
  const previousActive = useRef<string | null>(null);
  const panes = useRef(new Map<string, HTMLElement>());
  const compact = state.windows.filter(w => !w.minimized && w.mode === 'compact');
  const regular = state.windows.filter(w => !w.minimized && w.mode !== 'compact').at(-1);
  const activeWindow = state.windows.find(w => w.title === state.active);
  useEffect(() => {
    if (state.active) {
      const pane = panes.current.get(state.active);
      if (pane && !pane.contains(document.activeElement)) pane.focus({ preventScroll: true });
    }
    else if (previousActive.current) {
      const tasks = layer.current?.parentElement?.querySelectorAll<HTMLButtonElement>('[data-window-restore]');
      const task = Array.from(tasks ?? []).find(node => node.dataset.windowRestore === previousActive.current && node.getClientRects().length > 0);
      const home = Array.from(layer.current?.parentElement?.querySelectorAll<HTMLButtonElement>('[data-window-home]') ?? []).find(node => node.getClientRects().length > 0);
      (task ?? home)?.focus({ preventScroll: true });
    }
    previousActive.current = state.active;
  }, [state.active, activeWindow]);
  return <div ref={layer} className="workspace-windows" role="group" aria-label="Janelas de apps" data-compact-count={compact.length} style={{ '--compact-columns': Math.max(1, compact.length) } as CSSProperties}>
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
        style={window.mode === 'compact' ? { '--compact-column': compact.findIndex(pane => pane.title === window.title) + 1 } as CSSProperties : undefined} data-compact-selected={window.title === state.compactActive} data-mode={window.mode} data-active={state.active === window.title} data-maximized={window.mode === 'maximized'} data-collapsed={collapsed}
        onFocus={() => { if (state.active !== window.title) dispatch({ type: 'focus', title: window.title }); }}
        onPointerDown={() => { if (state.active !== window.title) dispatch({ type: 'focus', title: window.title }); }}>
        <header className="desktop-titlebar">
          <span className="desktop-window-title" data-switchable={window.mode === 'compact' && compact.length > 1 && window.title === state.compactActive}><WindowAppIcon title={window.title}/><span title={window.title}>{window.title}</span>{window.mode === 'compact' && compact.length > 1 && window.title === state.compactActive && <select className="compact-window-switcher" aria-label="Aplicativo no painel compacto" value={window.title} onChange={event => dispatch({ type: 'focus', title: event.target.value })}>{compact.map(pane => <option key={pane.title} value={pane.title}>{pane.title}</option>)}</select>}</span>
          <div className="desktop-window-controls">
            <div className="window-secondary-actions">{controls.map(control => <Button key={control.label} variant="ghost" size="icon" aria-label={control.label} aria-expanded={control.expanded} title={control.title} onClick={() => dispatch(control.action)}><control.icon/></Button>)}</div>
            {window.mode === 'compact' && <div className="compact-actions-overflow"><CompactActionsBoundary fallback={<ExpandCompactAction title={window.title} dispatch={dispatch} failed/>}><Suspense fallback={<ExpandCompactAction title={window.title} dispatch={dispatch}/>}><CompactActions title={window.title} controls={controls} onAction={action => dispatch(action)}/></Suspense></CompactActionsBoundary></div>}
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
