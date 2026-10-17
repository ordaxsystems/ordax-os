import { UsersRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { validateSpaceMembersPage } from '../../../../contracts/space-members.mjs';
import { useWebAccount } from './account-context';
import './space-members-panel.css';

type SpaceMember = ReturnType<typeof validateSpaceMembersPage>['members'][number];
type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const roleLabels = Object.freeze({
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador',
});
const stateLabels = Object.freeze({ active: 'Ativo', suspended: 'Suspenso' });

export function SpaceMembersPanel() {
  const { authorized, members, offline } = useWebAccount();
  const spaceId = authorized.activeSpace?.id ?? null;
  const activeSpaceName = authorized.activeSpace?.name ?? null;
  const currentSpace = useRef<string | null>(spaceId);
  const [items, setItems] = useState<readonly SpaceMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');

  async function readPage(targetSpaceId: string, cursor: string | null, append: boolean) {
    setLoadState('loading');
    try {
      const page = await members.list({ spaceId: targetSpaceId, cursor });
      if (currentSpace.current !== targetSpaceId) return;
      setItems(previous => append ? [...previous, ...page.members] : page.members);
      setNextCursor(page.nextCursor);
      setLoadState('ready');
    } catch {
      if (currentSpace.current !== targetSpaceId) return;
      setLoadState('error');
    }
  }

  useEffect(() => {
    currentSpace.current = spaceId;
    setItems([]);
    setNextCursor(null);
    if (spaceId === null || offline) {
      setLoadState('idle');
      return;
    }
    void readPage(spaceId, null, false);
  }, [spaceId, offline, members]);

  if (spaceId === null) return null;

  const initialLoading = loadState === 'loading' && items.length === 0;
  const loadingMore = loadState === 'loading' && items.length > 0;
  return <section className="meridian-space-members" aria-labelledby="space-members-title">
    <header>
      <span className="meridian-space-symbol"><UsersRound aria-hidden="true"/></span>
      <div><small>MEMBROS DO SPACE</small><h3 id="space-members-title">{activeSpaceName}</h3><p>Leitura autorizada da Conta OrdaX. Nenhum membro é persistido no navegador.</p></div>
    </header>
    {offline ? <div className="meridian-space-members-state" role="status"><strong>Sem conexão</strong><span>Reconecte para consultar os membros deste Space.</span></div>
      : initialLoading ? <div className="meridian-space-members-state" role="status"><strong>Consultando membros…</strong><span>A lista vem do serviço autorizado da sua conta.</span></div>
      : loadState === 'error' && items.length === 0 ? <div className="meridian-space-members-state" role="alert"><strong>Não foi possível consultar os membros.</strong><span>O Space continua selecionado, mas a lista não será simulada.</span><Button variant="outline" onClick={() => void readPage(spaceId, null, false)}>Tentar novamente</Button></div>
      : <>
        {items.length > 0 ? <div className="meridian-space-members-list" role="list" aria-label="Membros carregados">{items.map(member => <article key={member.userId} role="listitem" className="meridian-space-member-row" data-state={member.state}>
          <span className="meridian-space-member-avatar" aria-hidden="true"><UsersRound/></span>
          <div className="meridian-space-member-identity"><strong>{member.userId}</strong><small>Identificador da Conta OrdaX</small></div>
          <span className="meridian-space-member-role">{roleLabels[member.role]}</span>
          <span className="meridian-space-member-state">{stateLabels[member.state]}</span>
        </article>)}</div>
          : <div className="meridian-space-members-state" role="status"><strong>Nenhum membro retornado.</strong><span>Esta é a resposta real do serviço para o Space selecionado.</span></div>}
        <footer><span>{items.length} {items.length === 1 ? 'membro carregado' : 'membros carregados'}{nextCursor ? ' · há mais resultados' : ''}</span>{nextCursor && <Button variant="outline" disabled={loadingMore} onClick={() => void readPage(spaceId, nextCursor, true)}>{loadingMore ? 'Carregando…' : 'Carregar mais'}</Button>}{loadState === 'error' && items.length > 0 && <Button variant="outline" onClick={() => void readPage(spaceId, nextCursor, true)}>Tentar página novamente</Button>}</footer>
      </>}
  </section>;
}
