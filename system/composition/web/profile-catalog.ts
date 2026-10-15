import catalogUrl from '../../profile-packs/catalog.json?url';
import { loadBundledProfilePacks } from '../../services/profile-packs/bundled-source.mjs';
import { createProfilePackCatalogFromPacks } from '../../services/profile-packs/catalog.mjs';

// Package canonical source assets with this Web build; no remote endpoint or inventory.
const manifests = import.meta.glob<string>('../../profile-packs/*/v*/manifest.json', { query: '?url', import: 'default', eager: true });
const assets: Record<string, string> = { '/system/profile-packs/catalog.json': catalogUrl };
for (const [path, url] of Object.entries(manifests)) assets[path.replace('../..', '/system')] = url;

export async function readWebProfileCatalog(signal: AbortSignal) {
  const source = await loadBundledProfilePacks({ fetchImpl: (path: RequestInfo | URL, options?: RequestInit) => {
    if (typeof path !== 'string') throw new Error('Canonical Profile path must be a string');
    const asset = assets[path];
    if (!asset) throw new Error('Canonical bundled Profile asset is absent');
    return fetch(asset, { ...options, signal });
  }});
  // Shared JS infers the empty default as never[]; the loader validates every pack.
  // @ts-expect-error validated immutable packs satisfy the runtime contract
  return createProfilePackCatalogFromPacks({ packs: source.packs }).list();
}
