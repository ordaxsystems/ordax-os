import { projectSidebarAccount } from "../../../ui/sidebar-account.mjs";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { validateIdentitySessionSnapshot } from '../../../../contracts/identity-session.mjs';
import type { validateIdentityActionsSnapshot } from '../../../../contracts/identity-actions.mjs';
import type { validateSpace, validateSpacesSnapshot } from '../../../../contracts/spaces.mjs';
import type { validateSpaceMembersPage } from '../../../../contracts/space-members.mjs';
import type { validateSpaceActorCapability } from '../../../../contracts/space-actor-capability.mjs';
import type { validateSpaceMembershipActionResult } from '../../../../contracts/space-membership-actions.mjs';
import type { validateSpaceSelectionSnapshot } from '../../../../contracts/space-selection.mjs';
import type { validateSurfaceSnapshot } from '../../../../contracts/surface-host.mjs';
import { deriveAuthorizedSpaces } from '../../../../services/spaces/authorized-view.mjs';

// UI reads canonical public ports; the OS Web composition alone constructs them.
type SnapshotPort<T> = Readonly<{
  getSnapshot(): T;
  subscribe(listener: (snapshot: T) => void): () => void;
}>;
type MembershipResult = ReturnType<typeof validateSpaceMembershipActionResult>;
type AccountSession = Readonly<{
  identity: SnapshotPort<ReturnType<typeof validateIdentitySessionSnapshot>>;
  actions: SnapshotPort<ReturnType<typeof validateIdentityActionsSnapshot>> & {
    execute(action: 'sign-in' | 'register' | 'sign-out'): Promise<void>;
  };
  spaces: SnapshotPort<ReturnType<typeof validateSpacesSnapshot>>;
  members: Readonly<{
    list(request: { spaceId: string; cursor?: string | null }): Promise<ReturnType<typeof validateSpaceMembersPage>>;
  }>;
  actorCapability: Readonly<{
    read(request: { spaceId: string }): Promise<ReturnType<typeof validateSpaceActorCapability>>;
  }>;
  membershipActions: Readonly<{
    changeMemberRole(spaceId: string, targetUserId: string, role: 'admin' | 'member' | 'viewer', idempotencyKey: string): Promise<MembershipResult>;
    suspendMember(spaceId: string, targetUserId: string, idempotencyKey: string): Promise<MembershipResult>;
    reactivateMember(spaceId: string, targetUserId: string, idempotencyKey: string): Promise<MembershipResult>;
    removeMember(spaceId: string, targetUserId: string, idempotencyKey: string): Promise<MembershipResult>;
  }>;
  selection: SnapshotPort<ReturnType<typeof validateSpaceSelectionSnapshot>> & {
    select(spaceId: string): unknown;
    clear(): unknown;
  };
  surface: SnapshotPort<ReturnType<typeof validateSurfaceSnapshot>>;
  refresh(): Promise<unknown>;
}>;
const AccountSessionContext = createContext<AccountSession | null>(null);

export function WebAccountProvider({ session, children }: { session: AccountSession; children: ReactNode }) {
  return <AccountSessionContext.Provider value={session}>{children}</AccountSessionContext.Provider>;
}

export function useWebAccount(translate?: (id: string) => string) {
  const session = useContext(AccountSessionContext);
  if (session === null) throw new Error('Web account composition is missing');
  const identity = useSyncExternalStore(session.identity.subscribe, session.identity.getSnapshot, session.identity.getSnapshot);
  const actions = useSyncExternalStore(session.actions.subscribe, session.actions.getSnapshot, session.actions.getSnapshot);
  const catalog = useSyncExternalStore(session.spaces.subscribe, session.spaces.getSnapshot, session.spaces.getSnapshot);
  const selection = useSyncExternalStore(session.selection.subscribe, session.selection.getSnapshot, session.selection.getSnapshot);
  const surface = useSyncExternalStore(session.surface.subscribe, session.surface.getSnapshot, session.surface.getSnapshot);
  const offline = surface.connectivity === 'offline';
  const authorized: { ready: boolean; visibleSpaces: readonly ReturnType<typeof validateSpace>[]; activeSpace: ReturnType<typeof validateSpace> | null } = deriveAuthorizedSpaces(identity, catalog, selection);
  const sidebarAccount = projectSidebarAccount(identity, offline, translate);
  const { displayName, initials } = sidebarAccount;
  return { session, identity, actions, catalog, members: session.members, actorCapability: session.actorCapability, membershipActions: session.membershipActions, selection, surface, offline, authorized, displayName, initials, sidebarAccount };
}
