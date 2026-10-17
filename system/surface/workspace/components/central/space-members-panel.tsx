import { UsersRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createScopedMemberActionAttempts } from '../../../../services/spaces/member-action-attempts.mjs';
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

function isProjectedActionAllowed(member: SpaceMember, action: ActionKind, role?: ActionRole) {
  if (action === 'change-role') {
    return role !== undefined && member.actions.canChangeRole && member.actions.assignableRoles.includes(role);
  }
  if (action === 'suspend') return member.actions.canSuspend;
  if (action === 'reactivate') return member.actions.canReactivate;
  return member.actions.canRemove;
}

export function SpaceMembersPanel() {
  const { authorized, identity, members, actorCapability, membershipActions, offline } = useWebAccount();
  const subjectId = identity.state === 'signed-in' ? identity.subjectId : null;
  const spaceId = authorized.activeSpace?.id ?? null;
  const activeSpaceName = authorized.activeSpace?.name ?? null;
  const currentSpace = useRef<string | null>(spaceId);
  const membersReadGeneration = useRef(0);
  const membersReadInFlight = useRef<{ spaceId: string; cursor: string | null; append: boolean } | null>(null);
  const capabilityReadGeneration = useRef(0);
  const attempts = useRef(createScopedMemberActionAttempts(() => crypto.randomUUID()));
  const lastKnownSubject = useRef<string | null>(subjectId);
  const actionGeneration = useRef(0);
  const pendingAction = useRef(false);
  const [items, setItems] = useState<readonly SpaceMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [capabilityState, setCapabilityState] = useState<LoadState>('idle');
  const [capability, setCapability] = useState<ActorCapability | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function readPage(targetSpaceId: string, cursor: string | null, append: boolean) {
    const pending = membersReadInFlight.current;
    if (pending?.spaceId === targetSpaceId && pending.cursor === cursor && pending.append === append) return;
    const generation = ++membersReadGeneration.current;
    membersReadInFlight.current = { spaceId: targetSpaceId, cursor, append };
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
    } finally {
      if (membersReadGeneration.current === generation) membersReadInFlight.current = null;
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
    // Full refresh supersedes an in-flight append, even for the same Space.
    membersReadGeneration.current += 1;
    membersReadInFlight.current = null;
    setItems([]);
    setNextCursor(null);
    await Promise.all([
      readPage(targetSpaceId, null, false),
      readCapability(targetSpaceId),
    ]);
  }

  async function runAction(action: ActionKind, member: SpaceMember, role?: ActionRole) {
    if (spaceId === null || subjectId === null || offline || !capability?.canManageMembers || pendingAction.current || actionPending !== null || !isProjectedActionAllowed(member, action, role)) return;
    const generation = actionGeneration.current;
    const isCurrent = () => currentSpace.current === spaceId && actionGeneration.current === generation;
    const attempt = attempts.current.begin({ subjectId, spaceId, action, targetUserId: member.userId, role: role ?? null });
    const key = [action, member.userId, role ?? null].join(':');
    pendingAction.current = true;
    setActionPending(key);
    setActionError(null);
    try {
      if (action === 'change-role' && role) await membershipActions.changeMemberRole(spaceId, member.userId, role, attempt.idempotencyKey);
      else if (action === 'suspend') await membershipActions.suspendMember(spaceId, member.userId, attempt.idempotencyKey);
      else if (action === 'reactivate') await membershipActions.reactivateMember(spaceId, member.userId, attempt.idempotencyKey);
      else if (action === 'remove') await membershipActions.removeMember(spaceId, member.userId, attempt.idempotencyKey);
      attempt.confirm();
      if (isCurrent()) await reloadRemoteState(spaceId);
    } catch {
      if (isCurrent()) {
        setActionError('A ação não foi confirmada pelo servidor. Você pode tentar novamente; a mesma tentativa reutilizará a chave de idempotência.');
        await readCapability(spaceId);
      }
    } finally {
      if (isCurrent()) {
        pendingAction.current = false;
        setActionPending(null);
      }
    }
  }

  // A lost connection is not a sign-out: retain uncertain retry keys in memory.
  // Forget keys on an explicit sign-out or a confirmed account change only.
  useEffect(() => {
    if (identity.state === 'signed-out'
      || (subjectId !== null && lastKnownSubject.current !== null && lastKnownSubject.current !== subjectId)) {
      attempts.current.clear();
    }
    if (identity.state === 'signed-out') lastKnownSubject.current = null;
    else if (subjectId !== null) lastKnownSubject.current = subjectId;
  }, [identity.state, subjectId]);
  useEffect(() => {
    currentSpace.current = spaceId;
    membersReadGeneration.current += 1;
    membersReadInFlight.current = null;
    capabilityReadGeneration.current += 1;
    actionGeneration.current += 1;
    pendingAction.current = false;
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
  }, [spaceId, subjectId, offline, members, actorCapability]);

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
          const actions = member.actions;
          const editable = canManageMembers && (actions.canChangeRole || actions.canSuspend || actions.canReactivate || actions.canRemove);
          return <article key={member.userId} role="listitem" className="meridian-space-member-row" data-state={memberState}>
            <span className="meridian-space-member-avatar" aria-hidden="true"><UsersRound/></span>
            <div className="meridian-space-member-identity"><strong>{member.userId}</strong><small>Identificador da Conta OrdaX</small></div>
            <span className="meridian-space-member-role">{roleLabels[memberRole] ?? 'Função não reconhecida'}</span>
            <span className="meridian-space-member-state">{stateLabels[memberState] ?? 'Estado não reconhecido'}</span>
            {editable && <div className="meridian-space-member-actions" aria-label={`Ações para ${member.userId}`}>
              {actions.canChangeRole && <label><span>Função</span><select value={memberRole} disabled={actionPending !== null} onChange={event => void runAction('change-role', member, event.currentTarget.value as ActionRole)}>{actions.assignableRoles.map((role: ActionRole) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>}
              {actions.canSuspend && <Button variant="outline" disabled={actionPending !== null} onClick={() => void runAction('suspend', member)}>Suspender</Button>}
              {actions.canReactivate && <Button variant="outline" disabled={actionPending !== null} onClick={() => void runAction('reactivate', member)}>Reativar</Button>}
              {actions.canRemove && <Button variant="outline" disabled={actionPending !== null} onClick={() => { if (window.confirm('Remover este membro do Space?')) void runAction('remove', member); }}>Remover</Button>}
            </div>}
          </article>;
        })}</div>
          : <div className="meridian-space-members-state" role="status"><strong>Nenhum membro retornado.</strong><span>Esta é a resposta real do serviço para o Space selecionado.</span></div>}
        <footer>
          <span>{items.length} {items.length === 1 ? 'membro carregado' : 'membros carregados'}{nextCursor ? ' · há mais resultados' : ''}</span>
          {loadState === 'error' && items.length > 0 && <span role="alert">Não foi possível carregar a próxima página. Os membros já carregados foram preservados.</span>}
          {nextCursor && <Button variant="outline" disabled={loadingMore || actionPending !== null} onClick={() => void readPage(spaceId, nextCursor, true)}>{loadingMore ? 'Carregando…' : loadState === 'error' ? 'Tentar página novamente' : 'Carregar mais'}</Button>}
          {loadState !== 'loading' && <Button variant="outline" disabled={actionPending !== null} onClick={() => { if (!membersReadInFlight.current && !pendingAction.current) void reloadRemoteState(spaceId); }}>Atualizar lista</Button>}
        </footer>
      </>}
  </section>;
}
