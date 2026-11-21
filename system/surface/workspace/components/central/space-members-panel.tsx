import { UsersRound } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createScopedMemberActionAttempts } from '../../../../services/spaces/member-action-attempts.mjs';
import { createMemberPageAnchors } from '../../../../services/spaces/member-page-anchors.mjs';
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
    return role !== undefined && role !== member.role && member.actions.canChangeRole && member.actions.assignableRoles.includes(role);
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
  // A committed view context, not a second membership or capability cache.
  // Layout effects invalidate old async completions before the next view paints.
  const currentContext = useRef({ subjectId, spaceId, offline, members, actorCapability, membershipActions });
  const membersReadGeneration = useRef(0);
  const membersReadInFlight = useRef<{ spaceId: string; cursor: string | null; append: boolean } | null>(null);
  const capabilityReadGeneration = useRef(0);
  const attempts = useRef(createScopedMemberActionAttempts(() => crypto.randomUUID()));
  const pageAnchors = useRef(createMemberPageAnchors());
  const lastKnownSubject = useRef<string | null>(subjectId);
  const actionGeneration = useRef(0);
  const pendingAction = useRef(false);
  const [items, setItems] = useState<readonly SpaceMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [windowCursor, setWindowCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [capabilityState, setCapabilityState] = useState<LoadState>('idle');
  const [capability, setCapability] = useState<ActorCapability | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  async function readPage(targetSpaceId: string, cursor: string | null, append: boolean) {
    const pending = membersReadInFlight.current;
    if (pending?.spaceId === targetSpaceId && pending.cursor === cursor && pending.append === append) return;
    const generation = ++membersReadGeneration.current;
    const isCurrent = () => {
      const current = currentContext.current;
      return current.subjectId === subjectId
        && current.spaceId === targetSpaceId
        && !current.offline
        && current.members === members
        && membersReadGeneration.current === generation;
    };
    membersReadInFlight.current = { spaceId: targetSpaceId, cursor, append };
    setLoadState('loading');
    try {
      const page = await members.list({ spaceId: targetSpaceId, cursor });
      if (!isCurrent()) return;
      pageAnchors.current.record({ cursor, members: page.members, append });
      setItems(previous => append ? [...previous, ...page.members] : page.members);
      setNextCursor(page.nextCursor);
      setLoadState('ready');
    } catch {
      if (!isCurrent()) return;
      setLoadState('error');
    } finally {
      if (isCurrent()) membersReadInFlight.current = null;
    }
  }

  async function readCapability(targetSpaceId: string) {
    const generation = ++capabilityReadGeneration.current;
    const isCurrent = () => {
      const current = currentContext.current;
      return current.subjectId === subjectId
        && current.spaceId === targetSpaceId
        && !current.offline
        && current.actorCapability === actorCapability
        && capabilityReadGeneration.current === generation;
    };
    setCapabilityState('loading');
    setCapability(null);
    try {
      const value = await actorCapability.read({ spaceId: targetSpaceId });
      if (!isCurrent()) return;
      setCapability(value);
      setCapabilityState('ready');
    } catch {
      if (!isCurrent()) return;
      setCapabilityState('error');
    }
  }

  async function reloadRemoteState(targetSpaceId: string, cursor: string | null = null) {
    // Re-query only this page window. Never mix pre-mutation rows with fresh results.
    membersReadGeneration.current += 1;
    membersReadInFlight.current = null;
    pageAnchors.current.reset();
    setWindowCursor(cursor);
    setItems([]);
    setNextCursor(null);
    await Promise.all([
      readPage(targetSpaceId, cursor, false),
      readCapability(targetSpaceId),
    ]);
  }

  async function runAction(action: ActionKind, member: SpaceMember, role?: ActionRole) {
    if (spaceId === null || subjectId === null || offline || identity.state !== 'signed-in'
      || authorized.activeSpace?.id !== spaceId || capabilityState !== 'ready'
      || capability?.spaceId !== spaceId || capability.userId !== subjectId
      || capability.state !== 'active' || !capability.canManageMembers
      || pendingAction.current || actionPending !== null
      || !isProjectedActionAllowed(member, action, role)) return;
    const generation = actionGeneration.current;
    const isCurrent = () => {
      const current = currentContext.current;
      return current.subjectId === subjectId
        && current.spaceId === spaceId
        && !current.offline
        && current.membershipActions === membershipActions
        && current.actorCapability === actorCapability
        && actionGeneration.current === generation;
    };
    const returnCursor = pageAnchors.current.cursorFor(member.userId);
    const key = [action, member.userId, role ?? null].join(':');
    pendingAction.current = true;
    setActionPending(key);
    setActionError(null);
    setActionNotice(null);
    // The capability displayed when the page was loaded may have been revoked.
    // Re-read the existing Account port immediately before any mutation. A
    // failed authorization read cannot create an idempotency attempt or write.
    setCapabilityState('loading');
    let mutationStarted = false;
    try {
      const verified = await actorCapability.read({ spaceId });
      if (!isCurrent()) return;
      if (verified.spaceId !== spaceId || verified.userId !== subjectId) {
        setCapability(null);
        setCapabilityState('error');
        setActionError('Não foi possível confirmar a permissão da conta atual. Nenhuma alteração foi enviada.');
        return;
      }
      setCapability(verified);
      setCapabilityState('ready');
      if (verified.state !== 'active' || !verified.canManageMembers) {
        setActionError('A permissão de gerenciar membros foi revogada ou suspensa. Nenhuma alteração foi enviada.');
        return;
      }
      // The server remains the final authority if row-level grants changed
      // after this check. Retain the original idempotency key for uncertain
      // attempts, and never submit automatically.
      const attempt = attempts.current.begin({ subjectId, spaceId, action, targetUserId: member.userId, role: role ?? null });
      mutationStarted = true;
      if (action === 'change-role' && role) await membershipActions.changeMemberRole(spaceId, member.userId, role, attempt.idempotencyKey);
      else if (action === 'suspend') await membershipActions.suspendMember(spaceId, member.userId, attempt.idempotencyKey);
      else if (action === 'reactivate') await membershipActions.reactivateMember(spaceId, member.userId, attempt.idempotencyKey);
      else if (action === 'remove') await membershipActions.removeMember(spaceId, member.userId, attempt.idempotencyKey);
      attempt.confirm();
      if (isCurrent()) {
        await reloadRemoteState(spaceId, returnCursor);
        if (isCurrent()) setActionNotice('Ação confirmada pelo servidor. O trecho da lista foi consultado novamente; se a leitura falhar, tente novamente.');
      }
    } catch {
      if (isCurrent()) {
        if (!mutationStarted) {
          setCapability(null);
          setCapabilityState('error');
          setActionError('Não foi possível revalidar suas permissões. Nenhuma alteração foi enviada.');
        } else {
          setActionError('A ação não foi confirmada pelo servidor. Você pode tentar novamente; a mesma tentativa reutilizará a chave de idempotência.');
          await readCapability(spaceId);
        }
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
  useLayoutEffect(() => {
    if (identity.state === 'signed-out'
      || (subjectId !== null && lastKnownSubject.current !== null && lastKnownSubject.current !== subjectId)) {
      attempts.current.clear();
    }
    if (identity.state === 'signed-out') lastKnownSubject.current = null;
    else if (subjectId !== null) lastKnownSubject.current = subjectId;
  }, [identity.state, subjectId]);
  useLayoutEffect(() => {
    currentContext.current = { subjectId, spaceId, offline, members, actorCapability, membershipActions };
    membersReadGeneration.current += 1;
    membersReadInFlight.current = null;
    pageAnchors.current.reset();
    capabilityReadGeneration.current += 1;
    actionGeneration.current += 1;
    pendingAction.current = false;
    setItems([]);
    setNextCursor(null);
    setWindowCursor(null);
    setCapability(null);
    setActionError(null);
    setActionNotice(null);
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
  }, [spaceId, subjectId, offline, members, actorCapability, membershipActions]);

  if (spaceId === null) return null;

  const initialLoading = loadState === 'loading' && items.length === 0;
  const loadingMore = loadState === 'loading' && items.length > 0;
  // The actor capability is advisory UI data; only the current signed-in subject
  // and authorized Space can enable actions, and the server remains authoritative.
  const capabilityCurrent = capabilityState === 'ready' && capability?.spaceId === spaceId
    && capability.userId === subjectId && identity.state === 'signed-in' && !offline;
  const canManageMembers = capabilityCurrent && capability.state === 'active' && capability.canManageMembers === true;
  return <section className="meridian-space-members" aria-labelledby="space-members-title">
    <header>
      <span className="meridian-space-symbol"><UsersRound aria-hidden="true"/></span>
      <div><small>MEMBROS DO SPACE</small><h3 id="space-members-title">{activeSpaceName}</h3><p>Leitura autorizada da Conta OrdaX. Nenhum membro é persistido no navegador.</p></div>
    </header>
    {!offline && <div className="meridian-space-members-capability" data-state={capabilityState}>
      {capabilityState === 'loading' ? <span>Verificando permissões no servidor…</span>
        : capabilityState === 'error' ? <><span>Não foi possível confirmar permissões administrativas.</span><Button variant="outline" onClick={() => void readCapability(spaceId)}>Tentar novamente</Button></>
        : capabilityCurrent ? <span>Sua função: <strong>{roleLabels[capability.role] ?? 'Função não reconhecida'}</strong>. {canManageMembers ? 'Gestão de membros autorizada pelo servidor para esta sessão.' : capability.state === 'suspended' ? 'Acesso suspenso; ações de gestão indisponíveis.' : 'Modo somente leitura; sem permissão para gerenciar membros.'}</span>
        : capabilityState === 'ready' ? <span>Não foi possível validar suas permissões para esta conta e Space. Nenhuma ação habilitada.</span> : null}
    </div>}
    {actionError && <div className="meridian-space-members-action-error" role="alert">{actionError}</div>}
    {actionNotice && <p className="meridian-space-members-confirmation" role="status">{actionNotice}</p>}
    {offline ? <div className="meridian-space-members-state" role="status"><strong>Sem conexão</strong><span>Reconecte para consultar os membros deste Space.</span></div>
      : initialLoading ? <div className="meridian-space-members-state" role="status"><strong>Consultando membros…</strong><span>A lista vem do serviço autorizado da sua conta.</span></div>
      : loadState === 'error' && items.length === 0 ? <div className="meridian-space-members-state" role="alert"><strong>Não foi possível consultar os membros.</strong><span>O Space continua selecionado, mas a lista não será simulada.</span><Button variant="outline" onClick={() => void readPage(spaceId, windowCursor, false)}>Tentar novamente</Button>{windowCursor !== null && <Button variant="outline" onClick={() => { setActionNotice(null); void reloadRemoteState(spaceId); }}>Voltar ao início</Button>}</div>
      : <>
        {items.length > 0 ? <div className="meridian-space-members-list" role="list" aria-label="Membros carregados">{items.map(member => {
          const memberRole = String(member.role);
          const memberState = String(member.state);
          const actions = member.actions;
          // The current role is displayed separately. A change selector must
          // never pretend that a current, non-assignable role is its first option.
          const assignableRoles = actions.assignableRoles.filter((role: ActionRole) => role !== member.role);
          const editable = canManageMembers && ((actions.canChangeRole && assignableRoles.length > 0) || actions.canSuspend || actions.canReactivate || actions.canRemove);
          return <article key={member.userId} role="listitem" className="meridian-space-member-row" data-state={memberState}>
            <span className="meridian-space-member-avatar" aria-hidden="true"><UsersRound/></span>
            <div className="meridian-space-member-identity"><strong>{member.userId}</strong><small>Identificador da Conta OrdaX</small></div>
            <span className="meridian-space-member-role">{roleLabels[memberRole] ?? 'Função não reconhecida'}</span>
            <span className="meridian-space-member-state">{stateLabels[memberState] ?? 'Estado não reconhecido'}</span>
            {editable && <div className="meridian-space-member-actions" aria-label={`Ações para ${member.userId}`}>
              {actions.canChangeRole && assignableRoles.length > 0 && <label><span>Alterar função</span><select value="" disabled={actionPending !== null} aria-label={`Alterar função de ${member.userId}`} onChange={event => void runAction('change-role', member, event.currentTarget.value as ActionRole)}><option value="" disabled>Escolha uma função</option>{assignableRoles.map((role: ActionRole) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>}
              {actions.canSuspend && <Button variant="outline" disabled={actionPending !== null} onClick={() => void runAction('suspend', member)}>Suspender</Button>}
              {actions.canReactivate && <Button variant="outline" disabled={actionPending !== null} onClick={() => void runAction('reactivate', member)}>Reativar</Button>}
              {actions.canRemove && <Button variant="outline" disabled={actionPending !== null} onClick={() => { if (window.confirm('Remover este membro do Space?')) void runAction('remove', member); }}>Remover</Button>}
            </div>}
          </article>;
        })}</div>
          : <div className="meridian-space-members-state" role="status"><strong>{windowCursor === null ? 'Nenhum membro retornado.' : 'Nenhum membro neste trecho.'}</strong><span>Esta é a resposta real do serviço para o trecho consultado. Você pode voltar ao início.</span></div>}
        <footer>
          <span>{items.length} {items.length === 1 ? 'membro carregado' : 'membros carregados'}{nextCursor ? ' · há mais resultados' : ''}</span>
          {windowCursor !== null && <span className="meridian-space-members-window">Trecho da lista consultado após a última alteração.</span>}
          {loadState === 'error' && items.length > 0 && <span role="alert">Não foi possível carregar a próxima página. Os membros já carregados foram preservados.</span>}
          {nextCursor && <Button variant="outline" disabled={loadingMore || actionPending !== null} onClick={() => void readPage(spaceId, nextCursor, true)}>{loadingMore ? 'Carregando…' : loadState === 'error' ? 'Tentar página novamente' : 'Carregar mais'}</Button>}
          {loadState !== 'loading' && <Button variant="outline" disabled={actionPending !== null} onClick={() => { if (!membersReadInFlight.current && !pendingAction.current) { setActionNotice(null); void reloadRemoteState(spaceId, windowCursor); } }}>{windowCursor === null ? 'Atualizar lista' : 'Atualizar trecho'}</Button>}
          {windowCursor !== null && loadState !== 'loading' && <Button variant="outline" disabled={actionPending !== null} onClick={() => { if (!membersReadInFlight.current && !pendingAction.current) { setActionNotice(null); void reloadRemoteState(spaceId); } }}>Voltar ao início</Button>}
        </footer>
      </>}
  </section>;
}
