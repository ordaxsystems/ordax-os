import {REGIONAL_LOCALE_PREFERENCE_ID} from '../../../../services/preferences/regional.mjs';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {useWebAccount} from './account-context';
import {useWebPreferences} from './preferences-context';
import {mountSpacesPresentation} from '../../../ui/spaces/presentation/mount.mjs';
import styles from '../../../ui/spaces/presentation/styles.css?inline';
import tokens from '../../../ui/meridian.tokens.css?inline';

function SpacesPresentation({onOpen}:{onOpen:(title:string)=>void}){
 const host=useRef<HTMLDivElement>(null);
 const navigate=useRef(onOpen);
 useEffect(()=>{navigate.current=onOpen;},[onOpen]);
 const instance=useRef<ReturnType<typeof mountSpacesPresentation>|null>(null);
 const {theme,snapshot}=useWebPreferences();
 const locale=String(snapshot[REGIONAL_LOCALE_PREFERENCE_ID]??'pt-BR');
 useEffect(()=>{
  if(!host.current)return;
  const root=host.current.shadowRoot??host.current.attachShadow({mode:'open'});
  const sheet=new CSSStyleSheet();
  sheet.replaceSync(`${tokens}\n${styles}`);
  root.adoptedStyleSheets=[sheet];
  root.innerHTML=`<div data-meridian><div class="md-page--spaces" data-spaces-page></div><dialog class="md-space-dialog" aria-label="Detalhes do exemplo de espaço"></dialog></div>`;
  const presentation=mountSpacesPresentation(root,{locale,onNavigate:(title:string)=>navigate.current(title)});instance.current=presentation;
  return()=>{presentation.destroy();instance.current=null;};
 },[locale]);
 useEffect(()=>{instance.current?.setMaterial(theme==='dark'?'ink':'paper');},[theme,locale]);
 return <div ref={host} className="meridian-spaces-presentation" aria-label="Exemplos de espaços"/>;
}
export function SpacesExperience({children,onOpen}:{children:ReactNode;onOpen:(title:string)=>void}){
 const {authorized,identity,catalog,offline}=useWebAccount();
 const accountStateLabel = offline ? "Sem conexão. Reconecte para consultar seus espaços."
  : identity.state === "signed-out" ? "Entre na conta para consultar seus espaços."
  : authorized.ready ? "Catálogo confirmado pelo serviço da conta."
  : identity.state === "signed-in" ? (catalog.state === "loading" ? "Conta conectada · consultando seus espaços…" : "Conta conectada · consulta de espaços indisponível.")
  : "Consulta real · conexão ainda não confirmada.";
 const [mode,setMode]=useState<'account'|'examples'>('account');
 const [visited,setVisited]=useState(false);
 return <div className="meridian-spaces-experience">
  <div className="meridian-spaces-context"><span><strong>{mode==='account'?'Espaços da minha conta':'Espaços · exemplos'}</strong><small>{mode==='account'?accountStateLabel:'Dados fictícios. Nenhuma ação altera sua conta.'}</small></span><div className="meridian-spaces-context-actions">{mode==='account'&&!authorized.ready&&<Button variant="outline" onClick={()=>onOpen('Minha conta')}>Abrir minha conta</Button>}<Button variant="outline" onClick={()=>{setVisited(true);setMode(mode==='account'?'examples':'account');}}>{mode==='account'?'Ver exemplos completos':'Consultar meus espaços'}</Button></div></div>
  <div hidden={mode!=='examples'}>{visited&&<SpacesPresentation onOpen={onOpen}/>}</div>
  {mode==='account'&&children}
  <details className="meridian-integration-note"><summary><span className="meridian-integration-status">Backend pendente</span> Integrações pendentes</summary><p>Capas, indicadores operacionais, atividade, templates, criação e gestão de membros aguardam contratos e serviços compatíveis. Os exemplos completos ficam preservados; o catálogo real consulta somente os Spaces autorizados.</p></details>
 </div>;
}
