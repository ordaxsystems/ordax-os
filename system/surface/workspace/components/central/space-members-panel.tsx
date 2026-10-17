import { UsersRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { validateSpaceMembersPage } from '../../../../contracts/space-members.mjs';
import type { validateSpaceActorCapability } from '../../../../contracts/space-actor-capability.mjs';
import { useWebAccount } from './account-context';
import './space-members-panel.css';

type SpaceMember = ReturnType<typeof validateSpaceMembersPage>['members'][number];
type ActorCapability = ReturnType<typeof validateSpaceActorCapability>;
type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type ActionRole = 'admin' | 'member' | 'viewer';
type ActionKind = 'change-role' | 'suspend' | 'reactivate' | 'remove';

const roleLabels: Readonly<Record<string, string>> = Object.freeze({
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador',
});
const stateLabels: Readonly<Record<string, string>> = Object.freeze({ active: 'Ativo', suspended: 'Suspenso' });

function attemptKey(action: ActionKind, userId: string, role?: ActionRole) {
  return `${action}:${userId}:${role ?? ''}`;
}

export function SpaceMembersPanel() {
  const { authorized, members, actorCapability, membershipActions, offline } = useWebAccount();
  const spaceId = authorized.activeSpace?.id ?? null;
  const activeSpaceName = authorized.activeSpace?.name ?? null;
  const currentSpace = useRef<string | null>(spaceId);
  const membersReadGeneration = useRef(0);
  const capabilityReadGeneration = useRef(0);
  const idempotency = useRef(new Map<string, string>());
  const [items, setItems] = useState<readonly SpaceMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [capabilityState, setCapabilityState] = useState<LoadState>('idle');
  const [capability, setCapability] = useState<ActorCapability | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function readPage(targetSpaceId: string, cursor: string | null, append: boolean) {
    const generation = ++membersReadGeneration.current;
    setLoadState('loading');
    try {
      const page = await members.list({ spaceId: targetSpaceId, cursor });
      if (currentSpace.current !== targetSpaceId || membersReadGeneration.current !== generation) return;
      setItems(previous => append ? [...previous, ...page.members] : page.members);
      setNextCursor(page.nextCursor);
      setLoadState('ready');
    } catch {
      if (currentSpace.current !== targetSpaceId || membersReadGeneration.current !== generation) return;
      setLoadState('error');
    }
  }

  async function readCapability(targetSpaceId: string) {
    const generation = ++capabilityReadGeneration.current;
    setCapabilityState('loading');
    setCapability(null);
    try {
      const value = await actorCapability.read({ spaceId: targetSpaceId });
      if (currentSpace.current !== targetSpaceId || capabilityReadGeneration.current !== generation) return;
      setCapability(value);
      setCapabilityState('ready');
    } catch {
      if (currentSpace.current !== targetSpaceId || capabilityReadGeneration.current !== generation) return;
      setCapabilityState('error');
    }
  }

  async function reloadRemoteState(targetSpaceId: string) {
    setItems([]);
    setNextCursor(null);
    await Promise.all([
      readPage(targetSpaceId, null, false),
      readCapability(targetSpaceId),
    ]);
  }

  function getAttemptId(key: string) {
    const existing = idempotency.current.get(key);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    idempotency.current.set(key, generated);
    return generated;
  }

  async function runAction(action: ActionKind, member: SpaceMember, role?: ActionRole) {
    if (spaceId === null || !capability?.canManageMembers || actionPending !== null) return;
    const key = attemptKey(action, member.userId, role);
    const idempotencyKey = getAttemptId(key);
    setActionPending(key);
    setActionError(null);
    try {
      if (action === 'change-role' && role) await membershipActions.changeMemberRole(spaceId, member.userId, role, idempotencyKey);
      else if (action === 'suspend') await membershipActions.suspendMember(spaceId, member.userId, idempotencyKey);
      else if (action === 'reactivate') await membershipActions.reactivateMember(spaceId, member.userId, idempotencyKey);
      else if (action === 'remove') await membershipActions.removeMember(spaceId, member.userId, idempotencyKey);
      idempotency.current.delete(key);
      if (currentSpace.current === spaceId) await reloadRemoteState(spaceId);
    } catch {
      if (currentSpace.current === spaceId) {
        setActionError('A ação não foi confirmada pelo servidor. Você pode tentar novamente; a mesma tentativa reutilizará a chave de idempotência.');
        await readCapability(spaceId);
      }
    } finally {
      if (currentSpace.current === spaceId) setActionPending(null);
    }
  }

  useEffect(() => {
    currentSpace.current = spaceId;
    membersReadGeneration.current += 1;
    capabilityReadGeneration.current += 1;
    idempotency.current.clear();
    setItems([]);
    setNextCursor(null);
    setCapability(null);
    setActionError(null);
    setActionPending(null);
    if (spaceId === null || offline) {
      setLoadState('idle');
      setCapabilityState('idle');
      return;
    }
    void Promise.all([
      readPage(spaceId, null, false),
      readCapability(spaceId),
    ]);
  }, [spaceId, offline, members, actorCapability]);

  if (spaceId === null) return null;

  const initialLoading = loadState === 'loading' && items.length === 0;
  const loadingMore = loadState === 'loading' && items.length > 0;
  const canManageMembers = capabilityState === 'ready' && capability?.canManageMembers === true;
  return <section className="meridian-space-members" aria-labelledby="space-members-title">
    <header>
      <span className="meridian-space-symbol"><UsersRound aria-hidden="true"/></span>
      <div><small>MEMBROS DO SPACE</small><h3 id="space-members-title">{activeSpaceName}</h3><p>Leitura autorizada da Conta OrdaX. Nenhum membro é persistido no navegador.</p></div>
    </header>
    {!offline && <div className="meridian-space-members-capability" data-state={capabilityState}>
      {capabilityState === 'loading' ? <span>Verificando permissões no servidor…</span>
        : capabilityState === 'error' ? <><span>Não foi possível confirmar permissões administrativas.</span><Button variant="outline" onClick={() => void readCapability(spaceId)}>Tentar novamente</Button></>
        : canManageMembers ? <span>Gestão de membros autorizada pelo servidor para esta sessão.</span>
        : capabilityState === 'ready' ? <span>Modo somente leitura para esta sessão.</span> : null}
    </div>}
    {actionError && <div className="meridian-space-members-action-error" role="alert">{actionError}</div>}
    {offline ? <div className="meridian-space-members-state" role="status"><strong>Sem conexão</strong><span>Reconecte para consultar os membros deste Space.</span></div>
      : initialLoading ? <div className="meridian-space-members-state" role="status"><strong>Consultando membros…</strong><span>A lista vem do serviço autorizado da sua conta.</span></div>
      : loadState === 'error' && items.length === 0 ? <div className="meridian-space-members-state" role="alert"><strong>Não foi possível consultar os membros.</strong><span>O Space continua selecionado, mas a lista não será simulada.</span><Button variant="outline" onClick={() => void readPage(spaceId, null, false)}>Tentar novamente</Button></div>
      : <>
        {items.length > 0 ? <div className="meridian-space-members-list" role="list" aria-label="Membros carregados">{items.map(member => {
          const memberRole = String(member.role);
          const memberState = String(member.state);
          const editable = canManageMembers && memberRole !== 'owner';
          return <article key={member.userId} role="listitem" className="meridian-space-member-row" data-state={memberState}>
            <span className="meridian-space-member-avatar" aria-hidden="true"><UsersRound/></span>
            <div className="meridian-space-member-identity"><strong>{member.userId}</strong><small>Identificador da Conta OrdaX</small></div>
            <span className="meridian-space-member-role">{roleLabels[memberRole] ?? 'Função não reconhecida'}</span>
            <span className="meridian-space-member-state">{stateLabels[memberState] ?? 'Estado não reconhecido'}</span>
            {editable && <div className="meridian-space-member-actions" aria-label={`Ações para ${member.userId}`}>
              <label><span>Função</span><select value={memberRole} disabled={actionPending !== null} onChange={event => void runAction('change-role', member, event.currentTarget.value as ActionRole)}><option value="admin">Administrador</option><option value="member">Membro</option><option value="viewer">Visualizador</option></select></label>
              {memberState === 'active' ? <Button variant="outline" disabled={actionPending !== null} onClick={() => void runAction('suspend', member)}>Suspender</Button>
                : <Button variant="outline" disabled={actionPending !== null} onClick={() => void runAction('reactivate', member)}>Reativar</Button>}
              <Button variant="outline" disabled={actionPending !== null} onClick={() => { if (window.confirm('Remover este membro do Space?')) void runAction('remove', member); }}>Remover</Button>
            </div>}
          </article>;
        })}</div>
          : <div className="meridian-space-members-state" role="status"><strong>Nenhum membro retornado.</strong><span>Esta é a resposta real do serviço para o Space selecionado.</span></div>}
        <footer><span>{items.length} {items.length === 1 ? 'membro carregado' : 'membros carregados'}{nextCursor ? ' · há mais resultados' : ''}</span>{nextCursor && <Button variant="outline" disabled={loadingMore || actionPending !== null} onClick={() => void readPage(spaceId, nextCursor, true)}>{loadingMore ? 'Carregando…' : 'Carregar mais'}</Button>}{loadState === 'error' && items.length > 0 && <Button variant="outline" onClick={() => void readPage(spaceId, nextCursor, true)}>Tentar página novamente</Button>}</footer>
      </>}
  </section>;
}
