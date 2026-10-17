import { UsersRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { validateSpaceActorCapability } from '../../../../contracts/space-actor-capability.mjs';
import type { validateSpaceMembersPage } from '../../../../contracts/space-members.mjs';
import { createUuidIdempotencyKey } from '../../../../services/idempotency/uuid.mjs';
import { useWebAccount } from './account-context';
import './space-members-panel.css';

type SpaceMember = ReturnType<typeof validateSpaceMembersPage>['members'][number];
type ActorCapability = ReturnType<typeof validateSpaceActorCapability>;
type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type AssignableRole = 'admin' | 'member' | 'viewer';
type MemberAction = 'change-role' | 'suspend' | 'reactivate' | 'remove';

const assignableRoles: readonly AssignableRole[] = Object.freeze(['admin', 'member', 'viewer']);
const roleLabels: Readonly<Record<string, string>> = Object.freeze({
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  viewer: 'Visualizador',
});
const stateLabels: Readonly<Record<string, string>> = Object.freeze({ active: 'Ativo', suspended: 'Suspenso' });

function mutationSignature(spaceId: string, member: SpaceMember, action: MemberAction, role?: AssignableRole) {
  return [spaceId, member.userId, action, role ?? ''].join(':');
}

export function SpaceMembersPanel() {
  const { authorized, members, actorCapability, membershipActions, offline } = useWebAccount();
  const spaceId = authorized.activeSpace?.id ?? null;
  const activeSpaceName = authorized.activeSpace?.name ?? null;
  const currentSpace = useRef<string | null>(spaceId);
  const retryKeys = useRef(new Map<string, string>());
  const [items, setItems] = useState<readonly SpaceMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [capability, setCapability] = useState<ActorCapability | null>(null);
  const [capabilityState, setCapabilityState] = useState<LoadState>('idle');
  const [roleDrafts, setRoleDrafts] = useState<Readonly<Record<string, AssignableRole>>>({});
  const [busySignature, setBusySignature] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<{ userId: string; message: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SpaceMember | null>(null);

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

  async function readActorCapability(targetSpaceId: string) {
    setCapabilityState('loading');
    try {
      const next = await actorCapability.read({ spaceId: targetSpaceId });
      if (currentSpace.current !== targetSpaceId) return;
      setCapability(next);
      setCapabilityState('ready');
    } catch {
      if (currentSpace.current !== targetSpaceId) return;
      setCapability(null);
      setCapabilityState('error');
    }
  }

  useEffect(() => {
    currentSpace.current = spaceId;
    retryKeys.current.clear();
    setItems([]);
    setNextCursor(null);
    setCapability(null);
    setRoleDrafts({});
    setMutationError(null);
    setBusySignature(null);
    setRemoveTarget(null);
    if (spaceId === null || offline) {
      setLoadState('idle');
      setCapabilityState('idle');
      return;
    }
    void readPage(spaceId, null, false);
    void readActorCapability(spaceId);
  }, [spaceId, offline, members, actorCapability]);

  if (spaceId === null) return null;
  const targetSpaceId = spaceId;

  const adminPresentation = capability?.canManageMembers === true;
  const initialLoading = loadState === 'loading' && items.length === 0;
  const loadingMore = loadState === 'loading' && items.length > 0;

  function idempotencyKeyFor(signature: string) {
    const existing = retryKeys.current.get(signature);
    if (existing) return existing;
    const created = createUuidIdempotencyKey();
    retryKeys.current.set(signature, created);
    return created;
  }

  async function refreshAuthority(targetSpaceId: string) {
    setItems([]);
    setNextCursor(null);
    setCapability(null);
    await Promise.all([readPage(targetSpaceId, null, false), readActorCapability(targetSpaceId)]);
  }

  async function runMemberAction(member: SpaceMember, action: MemberAction, role?: AssignableRole) {
    if (!adminPresentation || currentSpace.current !== targetSpaceId) return;
    const signature = mutationSignature(targetSpaceId, member, action, role);
    if (busySignature !== null) return;
    setBusySignature(signature);
    setMutationError(null);
    try {
      const key = idempotencyKeyFor(signature);
      if (action === 'change-role') {
        if (!role) throw new Error('Assignable role is required');
        await membershipActions.changeMemberRole(targetSpaceId, member.userId, role, key);
      } else if (action === 'suspend') {
        await membershipActions.suspendMember(targetSpaceId, member.userId, key);
      } else if (action === 'reactivate') {
        await membershipActions.reactivateMember(targetSpaceId, member.userId, key);
      } else {
        await membershipActions.removeMember(targetSpaceId, member.userId, key);
      }
      retryKeys.current.delete(signature);
      if (currentSpace.current !== targetSpaceId) return;
      setRoleDrafts(previous => {
        const next = { ...previous };
        delete next[member.userId];
        return next;
      });
      if (action === 'remove') setRemoveTarget(null);
      if (currentSpace.current === targetSpaceId) await refreshAuthority(targetSpaceId);
    } catch {
      if (currentSpace.current === targetSpaceId) {
        setMutationError({ userId: member.userId, message: 'A ação não foi confirmada pelo serviço. Tente novamente.' });
      }
    } finally {
      if (currentSpace.current === targetSpaceId) setBusySignature(null);
    }
  }

  const removeError = removeTarget && mutationError && mutationError.userId === removeTarget.userId ? mutationError.message : null;

  return <section className="meridian-space-members" aria-labelledby="space-members-title">
    <header>
      <span className="meridian-space-symbol"><UsersRound aria-hidden="true"/></span>
      <div><small>MEMBROS DO SPACE</small><h3 id="space-members-title">{activeSpaceName}</h3><p>Leitura autorizada da Conta OrdaX. Nenhum membro é persistido no navegador.</p></div>
    </header>
    {!offline && capabilityState === 'loading' && <p className="meridian-space-members-capability" role="status">Confirmando suas permissões para este Space.</p>}
    {!offline && capabilityState === 'error' && <p className="meridian-space-members-capability" role="alert">A lista continua disponível, mas as ações administrativas ficam ocultas até o serviço confirmar sua permissão.</p>}
    {!offline && capabilityState === 'ready' && capability && !capability.canManageMembers && <p className="meridian-space-members-capability" role="status">Sua participação permite consultar membros; o serviço não liberou a gestão de membros.</p>}
    {offline ? <div className="meridian-space-members-state" role="status"><strong>Sem conexão</strong><span>Reconecte para consultar os membros deste Space.</span></div>
      : initialLoading ? <div className="meridian-space-members-state" role="status"><strong>Consultando membros...</strong><span>A lista vem do serviço autorizado da sua conta.</span></div>
      : loadState === 'error' && items.length === 0 ? <div className="meridian-space-members-state" role="alert"><strong>Não foi possível consultar os membros.</strong><span>O Space continua selecionado, mas a lista não será simulada.</span><Button variant="outline" onClick={() => void readPage(targetSpaceId, null, false)}>Tentar novamente</Button></div>
      : <>
        {items.length > 0 ? <div className="meridian-space-members-list" role="list" aria-label="Membros carregados">{items.map(member => {
          const memberRole = String(member.role);
          const memberState = String(member.state);
          const canOperate = adminPresentation && memberRole !== 'owner';
          const selectedRole = roleDrafts[member.userId] ?? (assignableRoles.includes(member.role as AssignableRole) ? member.role as AssignableRole : 'member');
          const roleSignature = mutationSignature(targetSpaceId, member, 'change-role', selectedRole);
          const stateAction: MemberAction = memberState === 'suspended' ? 'reactivate' : 'suspend';
          const stateSignature = mutationSignature(targetSpaceId, member, stateAction);
          const removeSignature = mutationSignature(targetSpaceId, member, 'remove');
          const rowError = mutationError && mutationError.userId === member.userId ? mutationError.message : null;
          return <article key={member.userId} role="listitem" className="meridian-space-member-row" data-state={memberState}>
            <span className="meridian-space-member-avatar" aria-hidden="true"><UsersRound/></span>
            <div className="meridian-space-member-identity"><strong>{member.userId}</strong><small>Identificador da Conta OrdaX</small></div>
            <span className="meridian-space-member-role">{roleLabels[memberRole] ?? 'Função não reconhecida'}</span>
            <span className="meridian-space-member-state">{stateLabels[memberState] ?? 'Estado não reconhecido'}</span>
            {canOperate && <div className="meridian-space-member-actions" aria-label={'Ações para ' + member.userId}>
              <label><span>Função</span><select aria-label={'Nova função de ' + member.userId} value={selectedRole} disabled={busySignature !== null} onChange={event => setRoleDrafts(previous => ({ ...previous, [member.userId]: event.target.value as AssignableRole }))}>{assignableRoles.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
              <Button size="sm" variant="outline" disabled={busySignature !== null || selectedRole === memberRole} onClick={() => void runMemberAction(member, 'change-role', selectedRole)}>{busySignature === roleSignature ? 'Salvando...' : 'Alterar função'}</Button>
              <Button size="sm" variant="outline" disabled={busySignature !== null} onClick={() => void runMemberAction(member, stateAction)}>{busySignature === stateSignature ? 'Salvando...' : memberState === 'suspended' ? 'Reativar' : 'Suspender'}</Button>
              <Button size="sm" variant="destructive" disabled={busySignature !== null} onClick={() => { setMutationError(null); setRemoveTarget(member); }}>{busySignature === removeSignature ? 'Removendo...' : 'Remover'}</Button>
            </div>}
            {rowError && <p className="meridian-space-member-error" role="alert">{rowError}</p>}
          </article>;
        })}</div>
          : <div className="meridian-space-members-state" role="status"><strong>Nenhum membro retornado.</strong><span>Esta é a resposta real do serviço para o Space selecionado.</span></div>}
        <footer><span>{items.length} {items.length === 1 ? 'membro carregado' : 'membros carregados'}{nextCursor ? ' - há mais resultados' : ''}</span>{nextCursor && <Button variant="outline" disabled={loadingMore || busySignature !== null} onClick={() => void readPage(targetSpaceId, nextCursor, true)}>{loadingMore ? 'Carregando...' : 'Carregar mais'}</Button>}{loadState === 'error' && items.length > 0 && <Button variant="outline" disabled={busySignature !== null} onClick={() => void readPage(targetSpaceId, nextCursor, true)}>Tentar página novamente</Button>}</footer>
      </>}
    <Dialog open={removeTarget !== null} onOpenChange={open => { if (!open && busySignature === null) setRemoveTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Remover membro do Space?</DialogTitle><DialogDescription>Esta ação usa o serviço real da Conta OrdaX. A autorização final continua no servidor.</DialogDescription></DialogHeader>
        {removeTarget && <p className="meridian-space-member-remove-target">Conta: <strong>{removeTarget.userId}</strong></p>}
        {removeError && <p className="meridian-space-member-error" role="alert">{removeError}</p>}
        <DialogFooter><Button variant="outline" disabled={busySignature !== null} onClick={() => setRemoveTarget(null)}>Cancelar</Button>{removeTarget && <Button variant="destructive" disabled={busySignature !== null} onClick={() => void runMemberAction(removeTarget, 'remove')}>{busySignature === mutationSignature(targetSpaceId, removeTarget, 'remove') ? 'Removendo...' : 'Remover membro'}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
