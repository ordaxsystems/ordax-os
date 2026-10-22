import { useEffect, useState } from 'react';
import { useProfileCatalogReader, type ProfileCatalogData } from './profile-catalog-context';
import { Panel } from './primitives';
import { useStoreCatalog } from '../store/catalog-context';
import { projectProfileStoreAppStatus } from '../../../../services/profile-packs/store-app-status.mjs';

export function ProfileCatalogPanel() {
  const readCatalog = useProfileCatalogReader();
  const storeSnapshot = useStoreCatalog();
  const [catalog, setCatalog] = useState<ProfileCatalogData | null>(null);
  const [category, setCategory] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    if (!readCatalog) { setFailed(true); return () => controller.abort(); }
    void readCatalog(controller.signal).then(value => {
      if (!controller.signal.aborted) { setCatalog(value); setCategory(''); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt, readCatalog]);
  const entries = catalog?.entries ?? null;
  const categories = catalog?.categories;
  type Category = NonNullable<ProfileCatalogData['categories']>['roots'][number];
  const flatten = (nodes: readonly Category[]): Category[] => nodes.flatMap(node => [node, ...flatten(node.children)]);
  const options = categories ? flatten(categories.roots).filter(node => node.profileCount > 0) : [];
  const visibleEntries = entries?.filter(entry => !category || entry.category === category || categories?.getCategory(entry.category)?.ancestorIds.includes(category));
  return <Panel title="Perfis profissionais" className="meridian-service-page">
    <span className="meridian-mock-badge">Planejado · mock visual preservado</span>
    <h3>Composições para organizar seus Spaces.</h3>
    <p className="service-state">Este destino permanece à vista para implementação gradual. Nenhum perfil, pacote ou permissão é ativado nesta demonstração.</p>
    <section aria-label="Catálogo de perfis do sistema" className="meridian-profile-catalog">
      <h3>Perfis publicados no sistema</h3>
      <p>O Space é o ambiente, o Profile Pack define apenas a composição e a Loja OrdaX distribui e atualiza os aplicativos. Referências abaixo não comprovam instalação, disponibilidade nem concedem permissões.</p>
      {entries && categories && <div className="meridian-profile-filter"><label htmlFor="profile-category">Categoria ou nicho</label><select id="profile-category" value={category} onChange={event => setCategory(event.target.value)}>
        <option value="">Todas as categorias ({entries.length})</option>
        {options.map(node => <option key={node.id} value={node.id}>{[...node.ancestorIds.map((id: string) => categories.getCategory(id)?.label), node.label].join(' / ')} ({node.profileCount})</option>)}
      </select><p role="status">{visibleEntries?.length} de {entries.length} perfis publicados</p></div>}
      {entries && !categories && <p role="status">Categorias indisponíveis. A lista de perfis continua disponível.</p>}
      {failed ? <div role="alert"><p>Não foi possível consultar o catálogo. A visão planejada permanece disponível.</p><button onClick={() => setAttempt(value => value + 1)}>Tentar consultar novamente</button></div>
        : entries === null ? <p role="status">Consultando perfis…</p>
        : entries.length === 0 ? <p>Nenhum perfil ativo publicado nesta versão.</p>
        : visibleEntries?.length === 0 ? <p>Nenhum perfil nesta categoria.</p>
        : visibleEntries?.map(entry => <article key={`${entry.slug}@${entry.version}`}>
          <h4>{entry.title} <small>versão {entry.version}</small></h4>
          <p>Composição declarada · consulta</p>
          <details><summary>Referências da composição</summary>
            <h5>IDs de aplicativos · Loja OrdaX</h5><ul>{projectProfileStoreAppStatus({ apps: entry.apps, storeSnapshot }).entries.map(app => <li key={app.appId}>{app.appId} — {({ unknown: 'Estado indisponível', 'not-listed': 'Não listado na Loja', installed: 'Instalado', 'update-available': 'Atualização disponível', available: 'Disponível na Loja', blocked: 'Bloqueado', 'failed-retained': 'Falha; versão preservada', 'in-progress': 'Operação em andamento', unavailable: 'Indisponível' } as Record<string, string>)[app.status] ?? 'Estado desconhecido'}{app.installedVersion ? ` · instalada ${app.installedVersion}` : ''}{app.availableVersion ? ` · catálogo ${app.availableVersion}` : ''}</li>)}</ul>
            <h5>Templates referenciados</h5><ul>{entry.templates.map((template: string) => <li key={template}>{template}</li>)}</ul>
          </details>
          <p className="service-state">Aplicar este perfil ao Space pelo Web ainda não está conectado. A ativação não é realizada por esta consulta.</p>
        </article>)}
    </section>
  </Panel>;
}
