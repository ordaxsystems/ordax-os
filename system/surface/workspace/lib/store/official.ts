import { assertAppStoreCatalogPort, createUnavailableAppStoreCatalogPort, validateAppStoreCatalogSnapshot } from '../../../../contracts/app-store.mjs';
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE } from '../../../../services/local-ai/model-candidate.generated.mjs';
import type { StoreItem, ModelItem } from './catalog';
import type { ItemStatus } from './state';

export type StoreSnapshot = ReturnType<typeof validateAppStoreCatalogSnapshot>;
export type StoreEntry = StoreSnapshot['entries'][number];
export type ProductStatus = ItemStatus | 'installing' | 'updating' | 'removing' | 'staged' | 'blocked' | 'failed-retained';

/** React presentation cache for the existing authority-free port, not another catalog service. */
export function createStoreSnapshotSource(input: unknown) {
  const port = assertAppStoreCatalogPort(input);
  const unavailable = createUnavailableAppStoreCatalogPort('store-catalog-read-failed').getSnapshot();
  let snapshot: StoreSnapshot = unavailable;
  const read = (): StoreSnapshot => {
    try { snapshot = validateAppStoreCatalogSnapshot(port.getSnapshot()); }
    catch { snapshot = unavailable; }
    return snapshot;
  };
  read();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      let active = true;
      const release = port.subscribe(() => {
        if (!active) return;
        read();
        listener();
      });
      if (typeof release !== 'function') throw new TypeError('Store subscription must return cleanup');
      // Close the render/subscribe gap even when the port does not emit immediately.
      read();
      listener();
      return () => { active = false; release(); };
    },
  };
}

export function officialEntryStatus(entry: StoreEntry): ProductStatus {
  return entry.state === 'installed' && entry.updatable ? 'update-available' : entry.state;
}

export function projectOfficialStoreItems(snapshot: StoreSnapshot): StoreItem[] {
  const valid = validateAppStoreCatalogSnapshot(snapshot);
  const items: StoreItem[] = valid.entries.map((entry: StoreEntry) => ({
    kind: 'app', id: entry.appId, name: entry.title,
    tagline: entry.installedVersion === null ? 'Estado informado pelo catálogo oficial' : 'Versão instalada informada pelo host',
    description: 'Estado e versões fornecidos pelo catálogo oficial. A consulta não concede instalação, execução ou permissões.',
    developer: 'Desenvolvedor não informado pelo catálogo', tone: 'blue', monogram: entry.title.slice(0, 2).toLocaleUpperCase('pt-BR'),
    tags: [], category: 'Aplicativos', platforms: [],
    version: entry.availableVersion ?? entry.installedVersion ?? 'Não informada',
    permissions: [], requirements: [], changelog: [], official: true,
  }));
  const candidate = BUNDLED_LOCAL_AI_MODEL_CANDIDATE;
  const model: ModelItem = {
    kind: 'model', id: 'model:' + candidate.id, name: candidate.title,
    tagline: 'Candidato da release assinada do OrdaX OS',
    description: 'Modelo registrado no sistema. Instalação neste dispositivo, requisitos mínimos e desempenho ainda precisam de verificação.',
    developer: 'Desenvolvedor não informado pelo catálogo', tone: 'violet', monogram: 'Q',
    tags: ['Local', 'Candidato'], family: candidate.title, variant: candidate.quantization, modelId: candidate.id,
    tasks: [], engine: candidate.engine, format: candidate.modelFormat, quantization: candidate.quantization,
    artifactSize: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(candidate.modelBytes / (1024 ** 2)) + ' MiB',
    ram: null, vram: null, gpu: 'não homologado', license: candidate.license,
    languages: ['Não informados pelo catálogo'], offline: true,
  };
  return [...items, model];
}
