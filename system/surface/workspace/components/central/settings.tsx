import {useEffect,useRef,useState,useMemo} from 'react';
import {Wifi,Volume2,Monitor,Keyboard,Clock3,Battery,HardDrive,Users,ShieldCheck,RefreshCw,Accessibility,Check,ArrowUpRight,type LucideIcon} from 'lucide-react';
import {createSettingsJourneyCatalog} from '../../../ui/journeys/settings-catalog.mjs';
import {REGIONAL_LOCALE_PREFERENCE_ID} from '../../../../services/preferences/regional.mjs';
import {mountSettingsJourneys} from '../../../ui/journeys/settings-mount.mjs';
import '../../../ui/journeys/styles.css';
import {COLOR_THEME_OPTIONS} from '../../../../services/preferences/color-palette.mjs';
import {accessibilityContrastPreference,accessibilityMotionPreference,accessibilityTextScalePreference} from '../../../../services/preferences/accessibility.mjs';
import {useWebPreferences} from './preferences-context';
import './settings-meridian.css';

const topicIcons:Record<string,LucideIcon>={network:Wifi,audio:Volume2,display:Monitor,keyboard:Keyboard,region:Clock3,battery:Battery,storage:HardDrive,users:Users,privacy:ShieldCheck,security:ShieldCheck,updates:RefreshCw,accessibility:Accessibility};

const accessibility=[accessibilityContrastPreference,accessibilityMotionPreference,accessibilityTextScalePreference];

export function WebSettings({onOpen}:{onOpen?:(title:string)=>void}){
 const {colorTheme,setColorTheme,snapshot,setPreference,persistence}=useWebPreferences();
 const locale=String(snapshot[REGIONAL_LOCALE_PREFERENCE_ID]??'pt-BR');
 const topics=useMemo(()=>createSettingsJourneyCatalog(locale).settingsTopics.map(item=>({...item,icon:topicIcons[item.id]})),[locale]);
 const examplesHost=useRef<HTMLDivElement>(null);
 const examples=useRef<ReturnType<typeof mountSettingsJourneys>|null>(null);
 const navigate=useRef(onOpen);
 useEffect(()=>{navigate.current=onOpen;},[onOpen]);
 useEffect(()=>{if(!examplesHost.current)return;const instance=mountSettingsJourneys(examplesHost.current,{mode:'web',locale,onAccount:()=>navigate.current?.('Minha conta')});examples.current=instance;return()=>{instance.destroy();examples.current=null;};},[locale]);
 const [mock,setMock]=useState<Record<string,boolean>>({privacy:true,sync:false,focus:false});
 const accessibilityPanel=useRef<HTMLElement>(null);
 function choose(item:{id:string}){if(item.id==='accessibility'){accessibilityPanel.current?.scrollIntoView({block:'start'});accessibilityPanel.current?.focus({preventScroll:true});return;}examples.current?.open(item.id);}
 function mockSwitch(id:string,title:string,description:string){return <button type="button" className="wm-setting-row" role="switch" aria-checked={!!mock[id]} onClick={()=>{setMock(value=>({...value,[id]:!value[id]}));if(id!=='focus')examples.current?.open(id==='sync'?'continuity':'privacy');}}><span><strong>{title}<small className="wm-mock-label">Exemplo</small></strong><small>{description}</small></span><i className="wm-switch" aria-hidden="true"/></button>;}
 return <section className="web-settings wm-settings" data-app-extension="settings-overview" data-ordax-settings-overview-view>
  <header className="wm-settings-heading"><p>SEU ORDAX, DO SEU JEITO</p><h1>Espaço para escolher.</h1><span>Aparência, privacidade e contexto com controles claros.</span></header>
  <nav className="wm-topic-grid" aria-label="Categorias de ajustes">{topics.map(item=><button type="button" className="wm-topic-card" key={item.id} onClick={()=>choose(item)}><span className="wm-topic-icon"><item.icon size={23}/></span><span><strong>{item.name}</strong><small>{item.detail}</small>{item.id!=='accessibility'&&<em className="wm-topic-status">{item.id==='users'?'Conta real + recursos planejados':'Conexão pendente'}</em>}</span><ArrowUpRight size={14} aria-hidden="true"/></button>)}</nav>
  <div className="wm-settings-grid">
   <section className="wm-settings-panel"><h2>Aparência</h2><p>Escolha a atmosfera do seu OrdaX. O trabalho, os contextos e as janelas continuam no mesmo lugar.</p><div className="wm-material-options" role="group" aria-label="Material e aparência">{COLOR_THEME_OPTIONS.map(option=><button type="button" className="wm-material-option" data-color-theme={option.value} key={option.value} aria-pressed={colorTheme===option.value} onClick={()=>setColorTheme(option.value)}><span className="wm-material-swatch" data-material-preview={option.value==='light'?'paper':'ink'} aria-hidden="true"><span className="wm-mini-rail"><i/><i/><i/></span><span className="wm-mini-page"><i/><span/><div><i/><i/></div></span></span><span className="wm-material-name"><strong>{option.label}</strong>{colorTheme===option.value&&<Check size={16}/>}</span><small>{option.value==='light'?'Clareza, calor e espaço para criar.':option.value==='dark'?'Uma atmosfera calma para se concentrar.':'A opção nativa do sistema, preservada.'}</small></button>)}</div><p className="wm-settings-status" role="status">{persistence==='session-only'?'O navegador não permitiu salvar. Preferências válidas apenas nesta sessão.':'Preferências salvas neste navegador. Sincronização entre dispositivos ainda não está conectada.'}</p></section>
   <section className="wm-settings-panel"><h2>Privacidade & contexto</h2>{mockSwitch('privacy','Contexto sob revisão','Peça uma revisão antes de propor ações com dados do Space.')}{mockSwitch('sync','Continuidade entre dispositivos','Escolha como seu trabalho acompanha você.')}<button className="wm-settings-link" type="button" onClick={()=>examples.current?.open('memory')}><ShieldCheck size={17}/>Revisar memória e permissões<ArrowUpRight size={14}/></button><p className="wm-settings-note">Controles de exemplo nesta sessão; não alteram permissões nem ativam sincronização.</p></section>
   <section className="wm-settings-panel" ref={accessibilityPanel} tabIndex={-1} aria-labelledby="wm-accessibility-heading"><h2 id="wm-accessibility-heading">Um ambiente mais tranquilo</h2>{mockSwitch('focus','Modo foco','Uma proposta para reduzir distrações na Central.')}{accessibility.map(preference=><div className="wm-preference" key={preference.id}><h3>{preference.title}</h3><p>{preference.description}</p><div className="wm-choice-options" role="group" aria-label={preference.title}>{preference.options.map((option:{value:string;label:string})=><button type="button" key={option.value} data-preference-id={preference.id} aria-pressed={snapshot[preference.id]===option.value} onClick={()=>setPreference(preference.id,option.value)}>{option.label}{snapshot[preference.id]===option.value&&<Check size={14}/>}</button>)}</div></div>)}</section>
   <section className="wm-settings-panel"><h2>A experiência completa</h2><button className="wm-settings-link" type="button" onClick={()=>onOpen?.('Minha conta')}><Users size={18}/>Conta e identidade<ArrowUpRight size={14}/></button><button className="wm-settings-link" type="button" onClick={()=>examples.current?.open('power')}><Monitor size={18}/>Estado do sistema<ArrowUpRight size={14}/></button><details className="wm-settings-note"><summary>Conexões e recursos planejados</summary><p>Aparência, contraste, movimento e tamanho do texto usam as preferências reais do Web. Rede, áudio, tela física, teclado, região, energia, armazenamento, privacidade, atualização e recuperação permanecem como exemplos, sem comandos no computador.</p></details></section>
  </div>
  <div ref={examplesHost}/>
 </section>;
}
