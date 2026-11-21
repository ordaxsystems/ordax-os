import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useWebAccount } from './account-context';
import { SpaceMembersPanel } from './space-members-panel';
import { SpaceProfileAppsPanel } from './space-profile-apps';

// The operational Spaces view must never substitute a fictitious collection
// for the authorized account or imply that example members are real.
export function SpacesExperience({ children, onOpen }: { children: ReactNode; onOpen: (title: string) => void }) {
  const { authorized, identity, catalog, offline } = useWebAccount();
  const accountStateLabel = offline ? 'Sem conexão. Reconecte para consultar seus espaços.'
    : identity.state === 'signed-out' ? 'Entre na conta para consultar seus espaços.'
    : authorized.ready ? 'Catálogo confirmado pelo serviço da conta.'
    : identity.state === 'signed-in' ? (catalog.state === 'loading' ? 'Conta conectada · consultando seus espaços…' : 'Conta conectada · consulta de espaços indisponível.')
    : 'Consulta real · conexão ainda não confirmada.';

  return <div className="meridian-spaces-experience">
    <div className="meridian-spaces-context">
      <span><strong>Espaços da minha conta</strong><small>{accountStateLabel}</small></span>
      {!authorized.ready && <div className="meridian-spaces-context-actions">
        <Button variant="outline" onClick={() => onOpen('Minha conta')}>Abrir minha conta</Button>
      </div>}
    </div>
    {children}
    <SpaceProfileAppsPanel/>
    <SpaceMembersPanel/>
    <details className="meridian-integration-note"><summary><span className="meridian-integration-status">Parcialmente conectado</span> Integrações pendentes</summary><p>A lista e a gestão de membros do Space selecionado usam contratos reais da Conta OrdaX. Os aplicativos referenciados são projetados em leitura a partir do Profile Pack exato e do estado oficial da Loja; esta consulta não instala nem autoriza execução. A Surface só apresenta ações de membros quando a capability do servidor autoriza a sessão; o servidor continua sendo a autoridade final. Capas, indicadores operacionais, atividade, templates e criação ainda aguardam contratos compatíveis de Surface.</p></details>
  </div>;
}
