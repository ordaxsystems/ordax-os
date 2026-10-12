import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { validateSpace, validateSpacesSnapshot } from '../../../../contracts/spaces.mjs';
import type { validateIdentitySessionSnapshot } from '../../../../contracts/identity-session.mjs';
import type { validateIdentityActionsSnapshot } from '../../../../contracts/identity-actions.mjs';
import { deriveAuthorizedSpaces } from '../../../../services/spaces/authorized-view.mjs';

// The Surface depends on neutral ports, never on the Web composition that
// creates and owns their concrete adapters. Types confer no runtime authority.
type SnapshotPort<T> = {
  getSnapshot: () => T;
  subscribe: (notify: () => void) => () => void;
};
type AccountSession = {
  identity: SnapshotPort<ReturnType<typeof validateIdentitySessionSnapshot>>;
  actions: SnapshotPort<ReturnType<typeof validateIdentityActionsSnapshot>> & {
    execute: (action: 'sign-in' | 'sign-out') => Promise<unknown>;
  };
  spaces: SnapshotPort<ReturnType<typeof validateSpacesSnapshot>>;
  refresh: () => Promise<unknown>;
};
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
  const authorized: { ready: boolean; visibleSpaces: readonly ReturnType<typeof validateSpace>[] } = deriveAuthorizedSpaces(identity, catalog);
  const displayName = identity.state === 'signed-in' ? (identity.displayName ?? 'Sua conta')
    : identity.state === 'signed-out' ? 'Entrar na conta' : 'Conta não conectada';
  const initials = identity.state === 'signed-in'
    ? displayName.trim().split(/\s+/).slice(0, 2).map((part: string) => Array.from(part)[0] ?? '').join('').toLocaleUpperCase('pt-BR')
    : null;
  return { session, identity, actions, catalog, authorized, displayName, initials };
}
