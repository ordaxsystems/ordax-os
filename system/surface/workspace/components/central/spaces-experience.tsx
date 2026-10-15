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
 const {theme}=useWebPreferences();
 useEffect(()=>{
  if(!host.current)return;
  const root=host.current.shadowRoot??host.current.attachShadow({mode:'open'});
  root.innerHTML=`<style>${tokens}\n${styles}</style><div data-meridian><div class="md-page--spaces" data-spaces-page></div><dialog class="md-space-dialog" aria-label="Detalhes do exemplo de espaço"></dialog></div>`;
  const presentation=mountSpacesPresentation(root,{onNavigate:(title:string)=>navigate.current(title)});instance.current=presentation;
  return()=>{presentation.destroy();instance.current=null;};
 },[]);
 useEffect(()=>{instance.current?.setMaterial(theme==='dark'?'ink':'paper');},[theme]);
 return <div ref={host} className="meridian-spaces-presentation" aria-label="Exemplos de espaços"/>;
}
export function SpacesExperience({children,onOpen}:{children:ReactNode;onOpen:(title:string)=>void}){
 const {authorized}=useWebAccount();
 const [mode,setMode]=useState<'account'|'examples'>(()=>authorized.ready?'account':'examples');
 const [visited,setVisited]=useState(()=>!authorized.ready);
 return <div className="meridian-spaces-experience">
  <div className="meridian-spaces-context"><span><strong>{mode==='account'?'Espaços da minha conta':'Espaços · exemplos'}</strong><small>{mode==='account'?'Consulta autorizada nesta sessão.':'Dados fictícios. Nenhuma ação altera sua conta.'}</small></span><Button variant="outline" onClick={()=>{setVisited(true);setMode(mode==='account'?'examples':'account');}}>{mode==='account'?'Ver exemplos completos':'Consultar meus espaços'}</Button></div>
  <div hidden={mode!=='examples'}>{visited&&<SpacesPresentation onOpen={onOpen}/>}</div>
  {mode==='account'&&children}
  <details className="meridian-integration-note"><summary>Integrações pendentes</summary><p>Capas, indicadores operacionais, atividade, templates, criação e gestão de membros aguardam contratos e serviços compatíveis. Os exemplos completos ficam preservados; o catálogo real consulta somente os Spaces autorizados.</p></details>
 </div>;
}
