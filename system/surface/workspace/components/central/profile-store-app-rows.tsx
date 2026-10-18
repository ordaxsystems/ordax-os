import type { projectProfileStoreAppStatus } from '../../../../services/profile-packs/store-app-status.mjs';

type AppStatusEntries = ReturnType<typeof projectProfileStoreAppStatus>['entries'];
const labels: Readonly<Record<string, string>> = Object.freeze({
  unknown: 'Estado indisponível',
  'not-listed': 'Não listado na Loja',
  installed: 'Instalado no dispositivo',
  'update-available': 'Atualização disponível no dispositivo',
  available: 'Disponível na Loja',
  blocked: 'Bloqueado',
  'failed-retained': 'Falha; versão preservada',
  'in-progress': 'Operação em andamento',
  unavailable: 'Indisponível',
});

// Shared presentation for Profile catalog and selected Space; not a Store state cache.
export function ProfileStoreAppRows({ entries }: { entries: AppStatusEntries }) {
  return <ul className="meridian-profile-store-app-list">{entries.map(app => <li key={app.appId}>
    <strong>{app.appId}</strong> — {labels[app.status] ?? 'Estado desconhecido'}
    {app.installedVersion ? ` · instalada ${app.installedVersion}` : ''}
    {app.availableVersion ? ` · catálogo ${app.availableVersion}` : ''}
  </li>)}</ul>;
}
