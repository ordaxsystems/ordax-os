import { Camera, Mic, Monitor, Folder, FileText, Layers3, Clock3, Users, ShieldCheck, ArrowRight, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from './primitives';
import { IntegrationNote } from './integration-note';
import { unavailableServices } from './config';

const pages = {
  projects: { title: 'Projetos', subtitle: 'Ideias, arquivos e ferramentas no mesmo contexto.', icon: Folder, message: unavailableServices.projects, features: [['Contexto do projeto', 'Reúna referências e ferramentas para continuar seu trabalho.', Layers3], ['Continuidade', 'Retome o contexto entre seus ambientes autorizados.', Clock3], ['Colaboração', 'Trabalho em equipe preservado como recurso planejado.', Users]] },
  files: { title: 'Arquivos', subtitle: 'Seus documentos, com o contexto e o acesso certos.', icon: FileText, message: unavailableServices.files, features: [['Arquivos do dispositivo', 'Acesso por um dispositivo autorizado e conectado.', Folder], ['Arquivos recentes', 'Encontre o que você estava usando.', Clock3], ['Permissões de acesso', 'Cada recurso mantém suas próprias autorizações.', ShieldCheck]] },
  devices: { title: 'Dispositivos conectados', subtitle: 'Cada dispositivo pode ampliar seu espaço de trabalho.', icon: Monitor, message: unavailableServices.devices, features: [['Câmera', 'Use a câmera de um dispositivo com consentimento.', Camera], ['Áudio', 'Recursos de áudio com acesso autorizado.', Mic], ['Segunda tela', 'Amplie o trabalho em outro dispositivo.', Monitor]] },
  activity: { title: 'Atividades', subtitle: 'Os movimentos do seu trabalho, em um só lugar.', icon: Clock3, message: unavailableServices.activity, features: [['Projetos', 'Acompanhe o contexto dos seus projetos.', Folder], ['Arquivos', 'Consulte o histórico autorizado dos seus arquivos.', FileText], ['Ferramentas', 'Atividade das ferramentas conectadas ao seu espaço.', Layers3]] },
  continuity: { title: 'Continuidade', subtitle: 'Seu contexto acompanha o seu próximo passo.', icon: Layers3, message: 'A continuidade ainda não está conectada a esta sessão Web.', features: [['Contexto', 'Continuidade do contexto entre ambientes autorizados.', Layers3], ['Sincronização', 'Integração com o serviço de sincronização da conta.', Clock3], ['Controle de acesso', 'Identidade e permissões são verificadas em cada ambiente.', ShieldCheck]] },
} satisfies Record<string, {title:string;subtitle:string;icon:LucideIcon;message:string;features:[string,string,LucideIcon][]}>;

// Presentation of existing plans only. These cards never grant or execute a capability.
export function ServiceOverview({area,onOpen}:{area:keyof typeof pages;onOpen:(title:string)=>void}) {
  const page=pages[area];
  return <Panel title={page.title} className="meridian-service-page">
    <p className="meridian-service-intro">{page.subtitle}</p>
    <section className="meridian-service-state" aria-label="Disponibilidade do serviço"><span className="meridian-service-icon"><page.icon size={28}/></span><div><span className="meridian-integration-status">Integração pendente</span><h3>Este recurso ainda não está conectado ao Web</h3><p>{page.message}</p></div></section>
    <section aria-label="Recursos planejados"><header className="meridian-service-heading"><h3>O que você poderá fazer</h3><span className="meridian-mock-badge">Planejado</span></header><div className="meridian-capability-grid">{page.features.map(([title,description,Icon])=><article key={title}><Icon size={22} aria-hidden="true"/><h4>{title}</h4><p>{description}</p><small>Integração pendente</small></article>)}</div></section>
    <nav className="meridian-service-links" aria-label="Continuar no OrdaX"><Button variant="outline" onClick={()=>onOpen('Espaços')}>Meus espaços<ArrowRight size={16}/></Button><Button variant="ghost" onClick={()=>onOpen('Minha conta')}>Conta e identidade<ArrowRight size={16}/></Button></nav>
    <IntegrationNote area={area}/>
  </Panel>;
}
