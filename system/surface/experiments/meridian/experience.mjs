import { shell } from './views/shell.mjs';
import { central } from './views/central.mjs';
import { explore } from './views/explore.mjs';
import { intelligence } from './views/intelligence.mjs';
import { desktop } from './views/desktop.mjs';
import { panelMarkup } from './views/panels.mjs';
import { sections } from './catalog.mjs';
import { presentationDestination } from '../../workspace/presentation.mjs';
/** Mount an explicitly opted-in visual study. source is a presentation-only
 * source, never a Runtime/Identity/Memory/Action Gateway port. No persistence,
 * device access, fetching, installs or real application execution occurs here. */
export function mountMeridianExperience(root,source,options={}){
 if(!root||!source?.getSnapshot||!source?.subscribe||!source?.dispatch)throw new TypeError('Meridian requires an explicit presentation source.');
 const life=new AbortController();let destroyed=false,toastTimer=0;
 // Unsent form text belongs to this preview session and its Space/conversation.
 // It is neither Memory nor a persisted document.
 const formDrafts=new Map();
 const draftKey=(form,field)=>JSON.stringify([root.dataset.space,form.dataset.form,form.dataset.conversation??form.dataset.file??'',field.name,field.id]);
 function rememberForms(){for(const form of root.querySelectorAll('[data-form]'))for(const field of form.querySelectorAll('input[name],textarea[name]'))if(!field.dataset.draft)formDrafts.set(draftKey(form,field),field.value);}
 function restoreForms(){for(const form of root.querySelectorAll('[data-form]'))for(const field of form.querySelectorAll('input[name],textarea[name]')){const key=draftKey(form,field);if(!field.dataset.draft&&formDrafts.has(key))field.value=formDrafts.get(key);}}
 const ui={route:'central',presentation:'central',tab:'day',material:'paper',panel:null,prompt:'',windows:[],activeWindow:null,compactActive:null,compactCollapsed:false,drafts:{},replies:{},musicPlaying:false,largeText:false,reduceMotion:false,brightness:100,volume:45,returnFocus:null};
 if(options.presentation==='desktop')ui.presentation='desktop';
 if(options.material==='ink')ui.material='ink';
 if(sections.some(item=>item.id===options.route))ui.route=options.route;
 function render(resetScroll=false){
  if(destroyed)return;
  rememberForms();const previousSpace=root.dataset.space;
  const data=source.getSnapshot();
  const previous=root.querySelector('.md-main');const scroll=resetScroll?0:previous?.scrollTop??0;
  const focused=document.activeElement;const focusId=root.contains(focused)?focused?.id:null;
  const focusAction=root.contains(focused)?focused?.dataset?.action:null;
  const panelScroll=root.querySelector('.md-panel-body')?.scrollTop??0;
  const selection=focused?.tagName==='TEXTAREA'||focused?.tagName==='INPUT'?{start:focused.selectionStart,end:focused.selectionEnd,value:focused.value}:null;
  root.dataset.meridian='';root.dataset.space=data.activeSpace;root.dataset.material=ui.material;root.dataset.presentation=ui.presentation;
  root.dataset.focus=String(data.focus);root.dataset.largeText=String(ui.largeText);root.dataset.reduceMotion=String(ui.reduceMotion);
  root.style.setProperty('--md-preview-brightness',String(ui.brightness/100));
  const view=ui.presentation==='desktop'?desktop(data,ui):ui.route==='central'?central(data,ui):ui.route==='intelligence'?intelligence(data,ui):explore(data,ui);
  root.innerHTML=shell(data,ui,view);root.querySelector('.md-main').scrollTop=scroll;
  if(ui.panel){root.querySelector('.md-panel-root').innerHTML=panelMarkup(ui.panel,data,ui);const dialog=root.querySelector('dialog');dialog.showModal();dialog.querySelector('.md-panel-body').scrollTop=panelScroll;if(ui.panel.type==='search')dialog.querySelector('input')?.focus();}
  restoreForms();
  if(previousSpace===data.activeSpace&&(focusId||focusAction)){const restored=focusId?root.querySelector(`#${CSS.escape(focusId)}`):root.querySelector(`[data-action="${CSS.escape(focusAction)}"]`);if(restored&&(!ui.panel||restored.closest('dialog'))){restored.focus({preventScroll:true});if(selection){restored.value=selection.value;try{restored.setSelectionRange(selection.start,selection.end);}catch{/* Search/number inputs need no text selection restoration. */}}}}
 }
 function toast(message){clearTimeout(toastTimer);const el=root.querySelector('dialog .md-panel-feedback')??root.querySelector('.md-toast');if(!el)return;el.textContent=message;el.classList.add('is-visible');toastTimer=setTimeout(()=>el.classList.remove('is-visible'),4500);}
 function closePanel(){
  rememberForms();ui.panel=null;const dialog=root.querySelector('dialog');dialog?.close();dialog?.remove();
  const origin=ui.returnFocus;ui.returnFocus=null;
  const candidates=origin?.id?root.querySelectorAll(`#${CSS.escape(origin.id)}`):origin?.action?root.querySelectorAll(`[data-action="${CSS.escape(origin.action)}"]`):[];
  const target=[...candidates].find(node=>node.getClientRects().length);
  (target??root.querySelector('.md-main'))?.focus({preventScroll:true});
 }
 function openPanel(type,id,more={}){if(!ui.panel){const focused=document.activeElement;ui.returnFocus=root.contains(focused)?{id:focused.id,action:focused.dataset.action}:null;}ui.panel={type,id,...more};render();}
 function navigate(route){if(!sections.some(item=>item.id===route))return;ui.route=route;ui.presentation='central';ui.panel=null;render(true);root.querySelector('.md-main')?.focus({preventScroll:true});}
 function ask(prompt){ui.prompt=String(prompt).trim().slice(0,1000);ui.route='intelligence';ui.presentation='central';ui.panel=null;render(true);}
 function openApp(id,fileId){const app=source.getSnapshot().apps.find(item=>item.id===id);if(!app)return;let win=ui.windows.find(item=>item.id===id);if(win){win.minimized=false;if(fileId)win.fileId=fileId;}else{win={id,title:app.name,fileId,mode:'expanded',minimized:false,x:24,y:24};ui.windows.push(win);}ui.windows=ui.windows.filter(item=>item.id!==id).concat(win);ui.activeWindow=id;if(win.mode==='compact'){ui.compactActive=id;ui.compactCollapsed=false;}ui.presentation='desktop';ui.panel=null;render();}
 function windowAction(action,id){const win=ui.windows.find(item=>item.id===id);if(!win)return;
  if(action==='window-close')ui.windows=ui.windows.filter(item=>item!==win);
  if(action==='window-minimize')win.minimized=true;
  if(action==='window-expand'){ui.activeWindow=id;win.mode=win.mode==='expanded'?'floating':'expanded';win.minimized=false;}
  if(action==='window-compact'){ui.activeWindow=id;win.mode=win.mode==='compact'?'expanded':'compact';win.minimized=false;if(win.mode==='compact'){ui.compactActive=id;ui.compactCollapsed=false;}}
  if(action==='window-focus'){ui.windows=ui.windows.filter(item=>item!==win).concat(win);ui.activeWindow=id;}
  const compact=ui.windows.filter(item=>item.mode==='compact'&&!item.minimized);if(!compact.some(item=>item.id===ui.compactActive))ui.compactActive=compact.at(-1)?.id??null;
  if(!ui.windows.some(item=>item.id===ui.activeWindow&&!item.minimized))ui.activeWindow=ui.windows.filter(item=>!item.minimized).at(-1)?.id??null;
  render();
 }
 function resume(projectId='atlas'){const data=source.getSnapshot();const project=data.projects.find(item=>item.id===projectId);if(!project)return;ui.panel=null;source.dispatch({type:'space',id:project.space});const file=data.files.find(item=>item.project===projectId);if(file){openApp('notes',file.id);const notes=ui.windows.find(item=>item.id==='notes');notes.mode='compact';ui.compactActive='notes';ui.compactCollapsed=false;}openApp(projectId==='lume'?'editor':projectId==='atlas'?'studio':'intelligence');toast('Contexto de demonstração preparado.');}
 function filter(scope){const query=(scope.querySelector('[data-search]')?.value??'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');const category=scope.dataset.category??'Todos';let shown=0;for(const el of scope.querySelectorAll('[data-search-item]')){const text=(el.dataset.searchItem??'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');el.hidden=!(text.includes(query)&&(category==='Todos'||el.dataset.category===category));if(!el.hidden)shown++;}const empty=scope.querySelector('.md-search-empty');if(empty)empty.hidden=shown>0;}
 root.addEventListener('cancel',event=>{if(event.target.matches('dialog')){event.preventDefault();closePanel();}},{capture:true,signal:life.signal});
 root.addEventListener('click',event=>{
  if(event.target.matches('dialog')){const box=event.target.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closePanel();return;}
  const trigger=event.target.closest('[data-action]');if(!trigger||!root.contains(trigger))return;
  const raw=trigger.dataset.action;const index=raw.indexOf(':');const action=index<0?raw:raw.slice(0,index);const id=index<0?'':raw.slice(index+1);
  if(action.startsWith('window-')){windowAction(action,id);return;}
  switch(action){
   case 'route':navigate(id);break;
   case 'panel':id==='close'?closePanel():openPanel(id);break;
   case 'tab':ui.tab=id;ui.route='central';ui.presentation='central';ui.panel=null;render(true);break;
   case 'presentation':ui.presentation=presentationDestination(ui.presentation).target;ui.panel=null;render();break;
   case 'ask':ask(id);break;
   case 'app':openApp(id);break;
   case 'file':{const file=source.getSnapshot().files.find(item=>item.id===id);if(file)openApp(file.kind==='Coleção'?'internet':file.kind==='Modelo 3D'?'editor':'notes',id);break;}
   case 'project':case 'space':case 'profile':case 'store':case 'device':case 'message':case 'automation-detail':openPanel(action,id);break;
   case 'select-space':ui.windows=[];ui.activeWindow=null;ui.compactActive=null;ui.panel=null;ui.route='central';ui.presentation='central';source.dispatch({type:'space',id});break;
   case 'install':source.dispatch({type:'install',id});toast('Adicionado somente à demonstração deste Space.');break;
   case 'activate-profile':ui.panel=null;source.dispatch({type:'profile',id});toast('Perfil aplicado ao Space de exemplo.');break;
   case 'capability':{const [device,...label]=id.split(':');const item=source.getSnapshot().devices.find(d=>d.id===device);if(!item?.online){toast('Este dispositivo de exemplo está desconectado.');break;}openPanel('capability',device,{label:label.join(':')});break;}
   case 'resume':resume(id);break;
   case 'scene':ui.panel=null;ui.presentation='central';ui.route='central';source.dispatch({type:'scenario',id});break;
   case 'focus':case 'privacy':case 'sync':source.dispatch({type:action});break;
   case 'task':case 'automation':case 'read':source.dispatch({type:action,id});break;
   case 'read-all':source.dispatch({type:'read-all'});break;
   case 'material':ui.material=id==='ink'?'ink':'paper';render();break;
   case 'text-size':ui.largeText=!ui.largeText;render();break;
   case 'motion':ui.reduceMotion=!ui.reduceMotion;render();break;
   case 'music':ui.musicPlaying=!ui.musicPlaying;render();break;
   case 'filter':{const scope=trigger.closest('.md-page');if(!scope)break;scope.dataset.category=id;scope.querySelectorAll('[data-action^="filter:"]').forEach(btn=>{const selected=btn===trigger;btn.classList.toggle('is-active',selected);btn.setAttribute('aria-pressed',String(selected));});filter(scope);break;}
   case 'compact-select':ui.compactActive=id;ui.compactCollapsed=false;render();break;
   case 'compact-toggle':ui.compactCollapsed=!ui.compactCollapsed;render();break;
   case 'demo':toast(id);break;
  }
 },{signal:life.signal});
 root.addEventListener('input',event=>{const target=event.target;if(target.matches('[data-search]'))filter(target.closest('dialog')??target.closest('.md-page'));if(target.dataset.draft)ui.drafts[target.dataset.draft]=target.value;if(target.dataset.range==='brightness'){ui.brightness=Number(target.value);root.style.setProperty('--md-preview-brightness',String(ui.brightness/100));}if(target.dataset.range==='volume')ui.volume=Number(target.value);},{signal:life.signal});
 root.addEventListener('submit',event=>{const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();const values=new FormData(form);
  if(['new-space','new-project'].includes(form.dataset.form)&&!String(values.get('name')??'').trim()){form.querySelector('[name=name]')?.focus();toast('Escolha um nome para continuar.');return;}
  if(['ask','reply'].includes(form.dataset.form)&&!String(values.get(form.dataset.form==='ask'?'prompt':'reply')??'').trim())return;
  if(['ask','reply','new-space','new-project'].includes(form.dataset.form)){for(const field of form.querySelectorAll('input[name],textarea[name]'))formDrafts.delete(draftKey(form,field));form.reset();}
  switch(form.dataset.form){
   case 'ask':ask(values.get('prompt'));break;
   case 'new-space':ui.panel=null;ui.route='spaces';source.dispatch({type:'create-space',value:values.get('name')});toast('Space criado somente nesta demonstração.');break;
   case 'new-project':ui.panel=null;source.dispatch({type:'create-project',value:values.get('name')});openPanel('project',source.getSnapshot().projects.at(-1).id);break;
   case 'save-note':source.dispatch({type:'file-draft',id:form.dataset.file,value:values.get('body')});toast('Rascunho guardado apenas nesta sessão de demonstração.');break;
   case 'reply':{const reply=String(values.get('reply')??'').trim().slice(0,1000);if(!reply)break;const id=form.dataset.conversation;ui.replies[id]=[...(ui.replies[id]??[]),reply];render();const input=root.querySelector('#md-reply');if(input){input.value='';input.focus();}break;}
  }
 },{signal:life.signal});
 document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openPanel('search');}},{signal:life.signal});
 root.addEventListener('pointerdown',event=>{const handle=event.target.closest('[data-drag-window]');if(!handle||event.button!==0||event.target.closest('.md-window-controls'))return;const win=ui.windows.find(item=>item.id===handle.dataset.dragWindow);if(win?.mode!=='floating')return;const el=handle.closest('[data-window]');const area=root.querySelector('.md-desktop-primary');const start={x:event.clientX,y:event.clientY,left:win.x??24,top:win.y??24};handle.setPointerCapture(event.pointerId);
  const move=e=>{win.x=Math.max(0,Math.min(Math.max(0,area.clientWidth-el.clientWidth),start.left+e.clientX-start.x));win.y=Math.max(0,Math.min(Math.max(0,area.clientHeight-el.clientHeight),start.top+e.clientY-start.y));el.style.setProperty('--window-x',`${win.x}px`);el.style.setProperty('--window-y',`${win.y}px`);};
  const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);};handle.addEventListener('pointermove',move,{signal:life.signal});handle.addEventListener('pointerup',end,{signal:life.signal});handle.addEventListener('pointercancel',end,{signal:life.signal});
 },{signal:life.signal});
 const unsubscribe=source.subscribe(()=>render());render();
 return {destroy(){if(destroyed)return;destroyed=true;clearTimeout(toastTimer);life.abort();unsubscribe();formDrafts.clear();root.replaceChildren();},source};
}
