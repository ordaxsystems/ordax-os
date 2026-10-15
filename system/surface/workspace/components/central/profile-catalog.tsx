import { useEffect, useState } from 'react';
import { useProfileCatalogReader, type ProfileEntry } from './profile-catalog-context';
import { Panel } from './primitives';

export function ProfileCatalogPanel() {
  const readCatalog = useProfileCatalogReader();
  const [entries, setEntries] = useState<readonly ProfileEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    if (!readCatalog) { setFailed(true); return () => controller.abort(); }
    void readCatalog(controller.signal).then(value => {
      if (!controller.signal.aborted) setEntries(value);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt, readCatalog]);
  return <Panel title="Perfis profissionais">
    <span className="meridian-mock-badge">Planejado · mock visual preservado</span>
    <h3>Ferramentas que acompanham seu trabalho.</h3>
    <p className="service-state">Este destino permanece à vista para implementação gradual. Nenhum perfil, pacote ou permissão é ativado nesta demonstração.</p>
    <section aria-label="Catálogo de perfis do sistema" className="meridian-profile-catalog">
      <h3>Perfis publicados no sistema</h3>
      <p>Consulta aos manifests desta versão do OrdaX. A composição declarada abaixo não significa que os aplicativos ou templates estejam instalados.</p>
      {failed ? <div role="alert"><p>Não foi possível consultar o catálogo. A visão planejada permanece disponível.</p><button onClick={() => setAttempt(value => value + 1)}>Tentar consultar novamente</button></div>
        : entries === null ? <p role="status">Consultando perfis…</p>
        : entries.length === 0 ? <p>Nenhum perfil ativo publicado nesta versão.</p>
        : entries.map(entry => <article key={`${entry.slug}@${entry.version}`}>
          <h4>{entry.title} <small>versão {entry.version}</small></h4>
          <p>Composição declarada · consulta</p>
          <details><summary>Aplicativos e templates previstos</summary>
            <h5>Aplicativos referenciados</h5><ul>{entry.apps.map((app: string) => <li key={app}>{app}</li>)}</ul>
            <h5>Templates referenciados</h5><ul>{entry.templates.map((template: string) => <li key={template}>{template}</li>)}</ul>
          </details>
          <p className="service-state">Aplicar este perfil ao Space pelo Web ainda não está conectado. A ativação não é realizada por esta consulta.</p>
        </article>)}
    </section>
  </Panel>;
}
