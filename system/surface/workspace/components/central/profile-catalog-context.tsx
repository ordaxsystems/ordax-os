import { createContext, useContext, type ReactNode } from 'react';
import type { createProfileTaxonomyView } from '../../../../services/profile-packs/taxonomy.mjs';
import type { createProfilePackCatalogFromPacks } from '../../../../services/profile-packs/catalog.mjs';
export type ProfileEntry = ReturnType<ReturnType<typeof createProfilePackCatalogFromPacks>['list']>[number];
export type ProfileCatalogData = {entries: readonly ProfileEntry[]; categories: ReturnType<typeof createProfileTaxonomyView> | null};
type ReadCatalog = (signal: AbortSignal) => Promise<ProfileCatalogData>;
const ProfileCatalogContext = createContext<ReadCatalog | null>(null);
export function ProfileCatalogProvider({read, children}: {read: ReadCatalog; children: ReactNode}) {
  return <ProfileCatalogContext.Provider value={read}>{children}</ProfileCatalogContext.Provider>;
}
export function useProfileCatalogReader() { return useContext(ProfileCatalogContext); }
