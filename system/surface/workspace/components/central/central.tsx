import { defaultSidebarForPresentation, resolveSidebarMode } from '../../presentation.mjs';
import { useReducer, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Desktop, WorkspaceNavigation } from './desktop';
import { desktopReducer, initialDesktopState } from './desktop-state';
import { WindowLayer } from './window-layer';
import { MeridianHome } from './meridian-home';
import { useWebPreferences } from './preferences-context';
import { WorkspaceHeader } from './meridian-navigation';

export function Central() {
  const {theme,setColorTheme} = useWebPreferences();
  const [windows, dispatch] = useReducer(desktopReducer, initialDesktopState);
  const compact = windows.windows.some(window => !window.minimized && window.mode === 'compact');
  const regular = windows.windows.some(window => !window.minimized && window.mode !== 'compact');
  const [view, setView] = useState<'central' | 'desktop'>('central');
  const [sidebarMode, setSidebarMode] = useState<'auto' | 'collapsed' | 'expanded'>('auto');
  const [menuRequest, setMenuRequest] = useState(0);
  const [example, setExample] = useState<string | null>(null);
  function changeView(next: 'central' | 'desktop') {
    if (next !== view) { setView(next); setSidebarMode(defaultSidebarForPresentation(next)); }
  }
  const open = (title: string) => dispatch({ type: 'open', title });
  return <div className="window-workspace meridian-workspace" data-view={view} data-sidebar={sidebarMode} data-compact={compact ? (windows.compactCollapsed ? 'collapsed' : 'expanded') : 'none'} data-running={windows.windows.length > 0}>
    <div className="workspace-stage">
      <div className="central-presentation" hidden={view !== 'central'}><div className="os-shell"><WorkspaceHeader title={windows.active ?? 'Início'} theme={theme} onMaterial={() => setColorTheme(theme === 'dark' ? 'light' : 'dark')} onMenu={() => setMenuRequest(value => value + 1)} onOpen={open}/><main className="os-main"><div className="central-content" inert={regular}><MeridianHome theme={theme} onOpen={open} onExample={setExample} onPrompt={text => dispatch({ type:'open', title:'Aura', prompt:text })}/></div></main></div></div>
      <div className="desktop-presentation" hidden={view !== 'desktop'}><Desktop onCentral={() => changeView('central')} dispatch={dispatch}/></div>
    </div>
    <div className="compact-reservation" aria-hidden="true"/>
    <WorkspaceNavigation menuRequest={menuRequest} onSidebarChange={next => setSidebarMode(resolveSidebarMode(view, next))} state={windows} dispatch={dispatch} view={view} onToggleView={() => changeView(view === 'central' ? 'desktop' : 'central')} onCentral={() => changeView('central')}/>
    <WindowLayer state={windows} dispatch={dispatch} onCentral={() => { dispatch({type:'show-desktop'}); changeView('central'); }}/>
    <Dialog open={example !== null} onOpenChange={open => {if(!open)setExample(null);}}><DialogContent><DialogHeader><DialogTitle>{example}</DialogTitle><DialogDescription>Prévia de um recurso planejado</DialogDescription></DialogHeader><p>Este exemplo mantém a proposta visual e o lugar deste recurso no sistema. Ainda não há dados, serviço ou execução conectados. Vamos evoluir esta parte por etapas.</p><p className="meridian-example-note">Mock visual · nenhum arquivo, dispositivo ou compromisso real é alterado.</p></DialogContent></Dialog>
  </div>;
}
