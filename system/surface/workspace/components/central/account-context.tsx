import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { validateIdentitySessionSnapshot } from '../../../../contracts/identity-session.mjs';
import type { validateIdentityActionsSnapshot } from '../../../../contracts/identity-actions.mjs';
import type { validateSpace, validateSpacesSnapshot } from '../../../../contracts/spaces.mjs';
import type { validateSpaceSelectionSnapshot } from '../../../../contracts/space-selection.mjs';
import { deriveAuthorizedSpaces } from '../../../../services/spaces/authorized-view.mjs';

// Surface receives existing ports through composition; it does not import the composition itself.
type SnapshotPort<T> = Readonly<{
  getSnapshot(): T;
  subscribe(listener: (snapshot: T) => void): () => void;
}>;
type AccountSession = Readonly<{
  identity: SnapshotPort<ReturnType<typeof validateIdentitySessionSnapshot>>;
  actions: SnapshotPort<ReturnType<typeof validateIdentityActionsSnapshot>> & {
    execute(action: 'sign-in' | 'register' | 'sign-out'): Promise<void>;
  };
  spaces: SnapshotPort<ReturnType<typeof validateSpacesSnapshot>>;
  selection: SnapshotPort<ReturnType<typeof validateSpaceSelectionSnapshot>> & {
    select(spaceId: string): unknown;
    clear(): unknown;
  };
  refresh(): Promise<unknown>;
}>;
const AccountSessionContext = createContext<AccountSession | null>(null);

export function WebAccountProvider({ session, children }: { session: AccountSession; children: ReactNode }) {
  return <AccountSessionContext.Provider value={session}>{children}</AccountSessionContext.Provider>;
}

export function useWebAccount() {
  const session = useContext(AccountSessionContext);
  if (session === null) throw new Error('Web account composition is missing');
  const identity = useSyncExternalStore(session.identity.subscribe, session.identity.getSnapshot, session.identity.getSnapshot);
  const actions = useSyncExternalStore(session.actions.subscribe, session.actions.getSnapshot, session.actions.getSnapshot);
  const catalog = useSyncExternalStore(session.spaces.subscribe, session.spaces.getSnapshot, session.spaces.getSnapshot);
  const selection = useSyncExternalStore(session.selection.subscribe, session.selection.getSnapshot, session.selection.getSnapshot);
  const authorized: { ready: boolean; visibleSpaces: readonly ReturnType<typeof validateSpace>[]; activeSpace: ReturnType<typeof validateSpace> | null } = deriveAuthorizedSpaces(identity, catalog, selection);
  const displayName = identity.state === 'signed-in' ? (identity.displayName ?? 'Sua conta')
    : identity.state === 'signed-out' ? 'Entrar na conta' : 'Conta não conectada';
  const initials = identity.state === 'signed-in'
    ? displayName.trim().split(/\s+/).slice(0, 2).map((part: string) => Array.from(part)[0] ?? '').join('').toLocaleUpperCase('pt-BR')
    : null;
  return { session, identity, actions, catalog, selection, authorized, displayName, initials };
}
