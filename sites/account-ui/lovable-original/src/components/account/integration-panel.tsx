import { CircleDashed, PlugZap, ShieldCheck } from 'lucide-react';
import { sectionServices, type AccountPath } from '@/lib/account/model';
export function IntegrationPanel({ path }: { path: AccountPath }) {
  const service = sectionServices[path];
  if (!service) return null;
  const connected = service.status === 'connected';
  return <section className="integration-panel" aria-label="Prontidão da integração">
    <div className="integration-head">
      <span className="integration-icon"><PlugZap /></span>
      <div className="min-w-0"><small>FONTE OFICIAL DESTA SEÇÃO</small><h2>{service.owner}</h2></div>
      <span className={connected ? 'integration-status ok' : 'integration-status'}><span />{connected ? 'Conectado' : 'Não conectado'}</span>
    </div>
    <ul className="integration-caps">{service.capabilities.map(c => <li key={c}>{connected ? <ShieldCheck className="mint" /> : <CircleDashed />}<span>{c}</span><em>{connected ? 'Ativo' : 'Aguardando serviço'}</em></li>)}</ul>
  </section>;
}
