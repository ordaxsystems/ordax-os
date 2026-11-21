import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowRight, ShieldCheck, Monitor, Folder, Clock3, Layers3, ShoppingBag } from 'lucide-react';
import { useWebAccount } from './account-context';
import { StoreCatalogSummary } from '../store/catalog-summary';
import { HomeSpacePicker } from './home-space-picker';
import { meridianHomeContextKey } from '../../../ui/meridian-home-context.mjs';
import { useWebPreferences } from './preferences-context';
import { resolveRegionalTimeZone } from '../../../../services/preferences/regional.mjs';
import { resolveHomeScene } from '../../../../services/surface/home-scene.mjs';
import { translateSurfaceMessage, SURFACE_SOURCE_LOCALE } from '../../../../services/i18n/surface.mjs';
import dayWallpaper from '@/assets/alpine-day.jpg';
import nightWallpaper from '@/assets/alpine-night.jpg';

type Props = {theme:'light'|'dark'; onOpen:(title:string)=>void; onExample:(title:string)=>void};
const ecosystems = [{name:'Spaces',note:'Contextos diferentes. O mesmo fio.',icon:Layers3,target:'Espaços'},{name:'Dispositivos',note:'Cada tela pode fazer mais.',icon:Monitor,target:'Dispositivos'},{name:'Descobrir',note:'Novas peças para o seu mundo.',icon:ShoppingBag,target:'Loja'}];
const homeCopy = (messageId:string) => translateSurfaceMessage(SURFACE_SOURCE_LOCALE, messageId);
// A keyed island removes presentation-only drafts *before* the next identity
// or authorized Space is rendered. Network heartbeat alone does not reset it.
export function MeridianHome(props:Props) {
  const {identity,authorized}=useWebAccount();
  return <MeridianHomeContext
    key={meridianHomeContextKey(identity, authorized.activeSpace)}
    {...props}
  />;
}

function MeridianHomeContext({onOpen}:Props) {
  const {identity,displayName,authorized,sidebarAccount}=useWebAccount();
  const {snapshot:preferences}=useWebPreferences();
  const timeZone=resolveRegionalTimeZone(preferences);
  const [tab,setTab]=useState<'day'|'work'|'ecosystem'>('day');
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),60000);return()=>window.clearInterval(timer);},[]);
  const scene=resolveHomeScene(now,timeZone);
  const greeting=homeCopy(scene.greetingId).replace(/\.$/,'');
  const date=new Intl.DateTimeFormat('pt-BR',{timeZone,weekday:'long',day:'numeric',month:'long'}).format(now);
  return <div className="meridian-home">
    <div className="meridian-page">
      <section className="meridian-welcome"><div><p className="meridian-eyebrow"><time dateTime={now.toISOString()}>{date}</time><span>·</span>{authorized.activeSpace?.name??'Seu espaço'}</p><h1>{greeting}{identity.state==='signed-in'?', '+displayName:''}.</h1><p>{homeCopy('shell.home.tagline')}</p></div><HomeSpacePicker onManage={()=>onOpen('Espaços')}/></section>
      <section className="meridian-hero" aria-label={homeCopy('shell.home.hero.aria')}><img src={scene.period==='night'?nightWallpaper:dayWallpaper} alt={scene.period==='night'?'Lago alpino sob a luz da lua':'Lago alpino ao amanhecer'} width={1920} height={768}/><div><p className="meridian-eyebrow">{homeCopy('shell.home.hero.label')}</p><h2>{homeCopy('shell.home.hero.title.first')}<br/>{homeCopy('shell.home.hero.title.second')}</h2><p>{homeCopy('shell.home.hero.description.first')}<br/>{homeCopy('shell.home.hero.description.second')}</p><button onClick={()=>setTab('work')}>Encontre seu próximo passo <ArrowRight size={17}/></button></div><span className="meridian-hero-caption">OrdaX · Central</span></section>
      <div className="meridian-session-strip" aria-label="Estado da sessão"><span><Monitor size={15}/>Web · sessão do navegador</span><button onClick={()=>onOpen('Minha conta')}><ShieldCheck size={15}/>Conta · {sidebarAccount.status}</button><button onClick={()=>onOpen('Loja')}><ShoppingBag size={15}/>Loja e recursos</button><button className="meridian-integration-status" onClick={()=>onOpen('Configurações')}>Recursos pendentes · consultar Ajustes</button></div>
      <nav className="meridian-tabs" aria-label="Perspectivas da Central">{[{id:'day' as const,label:'Visão do dia'},{id:'work' as const,label:'Seu trabalho'},{id:'ecosystem' as const,label:'Ecossistema'}].map(item=><button key={item.id} aria-pressed={tab===item.id} onClick={()=>setTab(item.id)}>{item.label}</button>)}</nav>
      {tab==='ecosystem'?<section className="meridian-ecosystem"><div><p className="meridian-eyebrow">UM SISTEMA. MUITAS POSSIBILIDADES.</p><h2>O seu jeito de fazer,<br/>com as ferramentas certas.</h2><p>Cada Space reúne seu contexto e a composição profissional.<br/>Seus dispositivos completam a experiência.</p></div><div>{ecosystems.map(item=><button key={item.name} onClick={()=>onOpen(item.target)}><item.icon size={27}/><span><strong>{item.name}</strong><small>{item.note}</small></span><ArrowUpRight size={19}/></button>)}</div></section>:<div className="meridian-columns"><div>
        <section className="meridian-section">
          <header><h2>{tab==='work'?'Seus projetos':'Retome o fio.'}</h2><button onClick={()=>onOpen('Projetos')}>Abrir Projetos<ArrowUpRight size={15}/></button></header>
          <div className="meridian-activity" role="status"><Folder size={18}/><p>Nenhum projeto disponível nesta sessão.<small>O registro de projetos ainda não está conectado. Nenhum projeto demonstrativo é apresentado como seu.</small></p></div>
        </section>
        <section className="meridian-section">
          <header><h2>Arquivos e documentos</h2><button onClick={()=>onOpen('Arquivos')}>Abrir Arquivos<ArrowUpRight size={15}/></button></header>
          <div className="meridian-activity" role="status"><Folder size={18}/><p>Arquivos ainda não conectados.<small>O acesso a arquivos depende de um dispositivo e de uma autorização real.</small></p></div>
        </section>
        <section className="meridian-section" aria-label="Aplicativos do catálogo oficial">
          <header><h2>Aplicativos do dispositivo</h2><button onClick={()=>onOpen('Loja')}>Ver na Loja<ArrowUpRight size={15}/></button></header>
          <StoreCatalogSummary limit={4}/>
        </section>
        <section className="meridian-section">
          <header><h2>O que se moveu</h2><button onClick={()=>onOpen('Atividades')}>Atividade<ArrowUpRight size={15}/></button></header>
          <div className="meridian-activity"><Clock3 size={18}/><p>Sua atividade, no seu contexto.<small>O histórico de atividades ainda não está conectado nesta sessão.</small></p></div>
        </section>
      </div><aside className="meridian-day" aria-label="Seu dia e dispositivos">
        <section><header><h2>No seu horizonte</h2></header><div className="meridian-activity" role="status"><Clock3 size={18}/><p>Nenhum compromisso disponível.<small>Não há uma agenda autorizada conectada nesta sessão.</small></p></div></section>
        <section><header><h2>Dispositivos</h2></header><button className="meridian-phone" onClick={()=>onOpen('Dispositivos')}><Monitor size={58}/><span><strong>Seus dispositivos.</strong><small>Consulte a disponibilidade pelo serviço oficial. Nenhum dispositivo foi presumido como conectado.</small></span></button></section>
      </aside></div>}
      <footer className="meridian-page-footer">OrdaX <span>A Central apresenta apenas o que está disponível ou identificado como não conectado.</span><button onClick={()=>onOpen('Loja')}>Explorar a Loja<ArrowRight size={15}/></button></footer>
    </div>
  </div>;
}
