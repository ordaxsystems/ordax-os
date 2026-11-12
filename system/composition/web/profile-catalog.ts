import taxonomyUrl from '../../profile-packs/taxonomy.json?url';
import { loadBundledProfileTaxonomy } from '../../services/profile-packs/taxonomy-source.mjs';
import { createProfileTaxonomyView } from '../../services/profile-packs/taxonomy.mjs';
import catalogUrl from '../../profile-packs/catalog.json?url';
import { loadBundledProfilePacks } from '../../services/profile-packs/bundled-source.mjs';
import { createProfilePackCatalogFromPacks } from '../../services/profile-packs/catalog.mjs';

// Package canonical source assets with this Web build; no remote endpoint or inventory.
const manifests = import.meta.glob<string>('../../profile-packs/*/v*/manifest.json', { query: '?url', import: 'default', eager: true });
const assets: Record<string, string> = { '/system/profile-packs/catalog.json': catalogUrl, '/system/profile-packs/taxonomy.json': taxonomyUrl };
for (const [path, url] of Object.entries(manifests)) assets[path.replace('../..', '/system')] = url;

export async function readWebProfileCatalog(signal: AbortSignal, fetchImpl: typeof fetch = fetch) {
  const fetchAsset: typeof fetch = (path, options) => {
    if (typeof path !== 'string') throw new Error('Canonical Profile path must be a string');
    const asset = assets[path];
    if (!asset) throw new Error('Canonical bundled Profile asset is absent');
    return fetchImpl(asset, { ...options, signal });
  };
  // Taxonomy is optional navigation: a failed registry must not hide valid profiles.
  const [sourceResult, taxonomyResult] = await Promise.allSettled([
    loadBundledProfilePacks({ fetchImpl: fetchAsset }),
    loadBundledProfileTaxonomy({ fetchImpl: fetchAsset }),
  ]);
  if (sourceResult.status === 'rejected') throw sourceResult.reason;
  // Shared JS infers the empty default as never[]; the loader validates every pack.
  // @ts-expect-error validated immutable packs satisfy the runtime contract
  const catalog = createProfilePackCatalogFromPacks({ packs: sourceResult.value.packs });
  let categories: ReturnType<typeof createProfileTaxonomyView> | null = null;
  if (taxonomyResult.status === 'fulfilled') {
    try {
      // Shared JS inference omits required destructured inputs; service validates them.
      // @ts-expect-error canonical catalog and taxonomy satisfy the runtime contract
      categories = createProfileTaxonomyView({ catalogPort: catalog, taxonomy: taxonomyResult.value });
    }
    catch { /* Invalid registry or unknown membership preserves the validated catalog. */ }
  }
  return { entries: catalog.list(), categories };
}
