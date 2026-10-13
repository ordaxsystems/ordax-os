import { ArrowUpRight, FolderKanban, Layers3, Monitor, ShieldCheck, Bell, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppTile, PanelHeading } from './primitives';
import { IntelligenceSurface } from '@/components/intelligence/surface';
import { getWebApp, type WebAppId } from '@/lib/web/model';

export function WorkspaceHome({ onOpen, onLauncher }: { onOpen: (id: WebAppId) => void; onLauncher: () => void }) {
  return <div className="web-home">
    <header className="web-welcome">
      <div>
        <span className="web-overline">SEU AMBIENTE DE TRABALHO</span>
        <h1>Bem-vindo ao seu OrdaX.</h1>
        <p>Seus aplicativos, projetos e atividades. Tudo em um só lugar.</p>
      </div>
      <Button variant="outline" className="web-home-space" onClick={() => onOpen('spaces')}>
        <Layers3/><span>Sem Space ativo</span><ChevronDown/>
      </Button>
    </header>

    <div className="web-home-overview">
      <section className="web-home-ai" aria-label="Intelligence no Início">
        <IntelligenceSurface presentation="compact" onExpand={() => onOpen('assistant')}/>
      </section>
      <section className="web-home-environment" aria-label="Seu ambiente">
        <h2>Seu ambiente</h2>
        <p>Contextos, aparência e preferências.</p>
        <div className="web-environment-actions">
          <Button variant="ghost" onClick={() => onOpen('spaces')}>
            <Layers3/><strong>Spaces</strong><small>Não conectado</small>
          </Button>
          <Button variant="ghost" onClick={() => onOpen('settings')}>
            <Monitor/><strong>Aparência</strong><small>Nesta sessão</small>
          </Button>
          <Button variant="ghost" asChild>
            <a href="/conta/"><ShieldCheck/><strong>Minha conta</strong><small>Gerenciar perfil</small></a>
          </Button>
        </div>
        <Button variant="ghost" className="web-environment-settings" onClick={() => onOpen('settings')}>
          Ajustes do ambiente <ArrowUpRight/>
        </Button>
      </section>
    </div>

    <section className="web-featured" aria-label="Seus aplicativos">
      <PanelHeading title="Seus aplicativos" onOpen={onLauncher}/>
      <div className="web-featured-apps">
        {(['studio', 'files', 'internet', 'image-viewer', 'notes', 'settings'] as const).map(id => <AppTile key={id} id={id} onOpen={onOpen}/>)}
      </div>
    </section>

    <div className="web-home-continuity">
      <section className="web-recent" aria-label="Projetos recentes">
        <PanelHeading title="Continue de onde parou" onOpen={() => onOpen('projects')}/>
        <div className="web-recent-empty">
          <FolderKanban/>
          <div><h3>Seu próximo projeto começa aqui.</h3><p>{getWebApp('projects').service}</p></div>
          <Button variant="ghost" size="icon" title="Abrir Projetos" aria-label="Abrir Projetos" onClick={() => onOpen('projects')}><ArrowUpRight/></Button>
        </div>
      </section>
      <section className="web-home-activity" aria-label="Atividade do ambiente">
        <PanelHeading title="Atividade" onOpen={() => onOpen('activity')}/>
        <div className="web-activity-empty"><Bell/><p>{getWebApp('activity').service}</p></div>
      </section>
    </div>
  </div>;
}
