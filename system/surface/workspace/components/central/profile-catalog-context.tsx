import { createContext, useContext, type ReactNode } from 'react';
import type { createProfilePackCatalogFromPacks } from '../../../../services/profile-packs/catalog.mjs';
export type ProfileEntry = ReturnType<ReturnType<typeof createProfilePackCatalogFromPacks>['list']>[number];
type ReadCatalog = (signal: AbortSignal) => Promise<readonly ProfileEntry[]>;
const ProfileCatalogContext = createContext<ReadCatalog | null>(null);
export function ProfileCatalogProvider({read, children}: {read: ReadCatalog; children: ReactNode}) {
  return <ProfileCatalogContext.Provider value={read}>{children}</ProfileCatalogContext.Provider>;
}
export function useProfileCatalogReader() { return useContext(ProfileCatalogContext); }
