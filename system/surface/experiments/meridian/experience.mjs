import { newStoryboard, moveStoryboard, previousStoryboard, storyboardKey } from './journeys/navigation.mjs';
import { journeyView, journeyFrame, lockScreen, storyboardFields } from './journeys/view.mjs';
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
 const life=new AbortController();let destroyed=false,toastTimer=0,storyTimer=0;
 // Unsent form text belongs to this preview session and its Space/conversation.
 // It is neither Memory nor a persisted document.
 const formDrafts=new Map();
 const draftKey=(form,field)=>JSON.stringify([root.dataset.subject,root.dataset.space,form.dataset.form,form.dataset.conversation??form.dataset.file??'',field.name,field.id]);
 function rememberForms(){for(const form of root.querySelectorAll('[data-form]'))for(const field of form.querySelectorAll('input[name],textarea[name]'))if(!field.dataset.draft)formDrafts.set(draftKey(form,field),field.value);}
 function restoreForms(){for(const form of root.querySelectorAll('[data-form]'))for(const field of form.querySelectorAll('input[name],textarea[name]')){const key=draftKey(form,field);if(!field.dataset.draft&&formDrafts.has(key))field.value=formDrafts.get(key);}}
 const ui={route:'central',presentation:'central',tab:'day',material:'paper',panel:null,prompt:'',windows:[],activeWindow:null,compactActive:null,compactCollapsed:false,drafts:{},replies:{},musicPlaying:false,largeText:false,reduceMotion:false,brightness:100,volume:45,returnFocus:null,subject:'lia',locked:false,lockError:false,stage:false,currentStory:null,stories:new Map(),sessions:new Map(),notificationFilter:'unread',dismissed:[],dnd:false,read:[],privateMode:true,sync:true,spaceUnavailable:false,cloudExpired:false,lab:{definitions:options.lab?.storyboards??{},system:options.lab?.systemFixture??{},topics:options.lab?.settingsTopics??[]}};
 if(options.presentation==='desktop')ui.presentation='desktop';
 if(options.material==='ink')ui.material='ink';
 if(sections.some(item=>item.id===options.route))ui.route=options.route;
 function render(resetScroll=false){
  if(destroyed)return;
  rememberForms();const previousSpace=root.dataset.space;const previousSubject=root.dataset.subject;
  const data=readData();
  ui.pendingDraftCount=Object.values(ui.drafts).filter(value=>String(value).trim()).length+[...formDrafts].filter(([key,value])=>{const scope=JSON.parse(key);return scope[0]===contextSubject()&&scope[1]===String(data.activeSpace)&&value.trim();}).length;
  const previous=root.querySelector('.md-main');const scroll=resetScroll?0:previous?.scrollTop??0;
  const focused=document.activeElement;const focusId=root.contains(focused)?focused?.id:null;
  const focusAction=root.contains(focused)?focused?.dataset?.action:null;
  const panelScroll=root.querySelector('.md-panel-body')?.scrollTop??0;
  const selection=focused?.tagName==='TEXTAREA'||focused?.tagName==='INPUT'?{start:focused.selectionStart,end:focused.selectionEnd,value:focused.value}:null;
  root.dataset.meridian='';root.dataset.subject=contextSubject();root.dataset.stage=String(ui.stage||ui.locked);root.dataset.space=data.activeSpace;root.dataset.material=ui.material;root.dataset.presentation=ui.presentation;
  root.dataset.focus=String(data.focus);root.dataset.largeText=String(ui.largeText);root.dataset.reduceMotion=String(ui.reduceMotion);
  root.style.setProperty('--md-preview-brightness',String(ui.brightness/100));
  if(ui.locked){root.innerHTML=lockScreen(ui);root.querySelector('.md-stage')?.focus({preventScroll:true});return;}
  if(ui.stage&&ui.currentStory){const {kind,key}=ui.currentStory;const definition=ui.lab.definitions[kind];root.innerHTML=journeyFrame(definition.label,journeyView(kind,definition,ui.stories.get(key),data,ui),true);restoreForms();return;}
  const view=ui.presentation==='desktop'?desktop(data,ui):ui.route==='central'?central(data,ui):ui.route==='intelligence'?intelligence(data,ui):explore(data,ui);
  root.innerHTML=shell(data,ui,view);root.querySelector('.md-main').scrollTop=scroll;
  if(ui.panel){root.querySelector('.md-panel-root').innerHTML=ui.panel.type==='journey'?currentStoryMarkup(data):panelMarkup(ui.panel,data,ui);const dialog=root.querySelector('dialog');dialog.showModal();dialog.querySelector('.md-panel-body').scrollTop=panelScroll;if(ui.panel.type==='search')dialog.querySelector('input')?.focus();}
  restoreForms();
  if(previousSubject===contextSubject()&&previousSpace===data.activeSpace&&(focusId||focusAction)){const restored=focusId?root.querySelector(`#${CSS.escape(focusId)}`):root.querySelector(`[data-action="${CSS.escape(focusAction)}"]`);if(restored&&(!ui.panel||restored.closest('dialog'))){restored.focus({preventScroll:true});if(selection){restored.value=selection.value;try{restored.setSelectionRange(selection.start,selection.end);}catch{/* Search/number inputs need no text selection restoration. */}}}}
 }
 function toast(message){clearTimeout(toastTimer);const el=root.querySelector('dialog .md-panel-feedback')??root.querySelector('.md-toast');if(!el)return;el.textContent=message;el.classList.add('is-visible');toastTimer=setTimeout(()=>el.classList.remove('is-visible'),4500);}
 function closePanel(){
  rememberForms();clearTimeout(storyTimer);ui.currentStory=null;if(ui.stage){ui.stage=false;ui.panel=null;render();}ui.panel=null;const dialog=root.querySelector('dialog');dialog?.close();dialog?.remove();
  const origin=ui.returnFocus;ui.returnFocus=null;
  const candidates=origin?.id?root.querySelectorAll(`#${CSS.escape(origin.id)}`):origin?.action?root.querySelectorAll(`[data-action="${CSS.escape(origin.action)}"]`):[];
  const target=[...candidates].find(node=>node.getClientRects().length);
  (target??root.querySelector('.md-main'))?.focus({preventScroll:true});
 }
 function openPanel(type,id,more={}){
  const routes={account:'identity',login:'identity',signup:'identity',store:'store',profile:'profile',space:'space',pair:'device',device:'device',proposal:'intelligence','new-space':'space'};
  if(routes[type]){openJourney(routes[type],id||(type==='pair'?'phone':type==='new-space'?readData().activeSpace:''),type==='new-space'?'create':type==='login'?'sign-in':type==='signup'?'sign-up':type==='account'?'overview':null);return;}
if(!ui.panel){const focused=document.activeElement;ui.returnFocus=root.contains(focused)?{id:focused.id,action:focused.dataset.action}:null;}ui.panel={type,id,...more};render();}
 function navigate(route){clearTimeout(storyTimer);ui.currentStory=null;ui.stage=false;if(!sections.some(item=>item.id===route))return;ui.route=route;ui.presentation='central';ui.panel=null;render(true);root.querySelector('.md-main')?.focus({preventScroll:true});}
 function ask(prompt){invalidateStoryContext('intelligence');ui.currentStory=null;ui.stage=false;ui.prompt=String(prompt).trim().slice(0,1000);ui.route='intelligence';ui.presentation='central';ui.panel=null;render(true);}
 function openApp(id,fileId){if(!readData().activeSpace){openPanel('spaces');return;}const app=readData().apps.find(item=>item.id===id);if(!app)return;clearTimeout(storyTimer);ui.currentStory=null;ui.stage=false;let win=ui.windows.find(item=>item.id===id);if(win){win.minimized=false;if(fileId)win.fileId=fileId;}else{win={id,title:app.name,fileId,mode:'expanded',minimized:false,x:24,y:24};ui.windows.push(win);}ui.windows=ui.windows.filter(item=>item.id!==id).concat(win);ui.activeWindow=id;if(win.mode==='compact'){ui.compactActive=id;ui.compactCollapsed=false;}ui.presentation='desktop';ui.panel=null;render();}
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
 function resume(projectId='atlas'){const data=readData();const project=data.projects.find(item=>item.id===projectId);if(!project)return;ui.panel=null;selectSpace(project.space);const file=data.files.find(item=>item.project===projectId);if(file){openApp('notes',file.id);const notes=ui.windows.find(item=>item.id==='notes');notes.mode='compact';ui.compactActive='notes';ui.compactCollapsed=false;}openApp(projectId==='lume'?'editor':projectId==='atlas'?'studio':'intelligence');toast('Contexto de demonstração preparado.');}
 function filter(scope){const query=(scope.querySelector('[data-search]')?.value??'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');const category=scope.dataset.category??'Todos';let shown=0;for(const el of scope.querySelectorAll('[data-search-item]')){const text=(el.dataset.searchItem??'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');el.hidden=!(text.includes(query)&&(category==='Todos'||el.dataset.category===category));if(!el.hidden)shown++;}const empty=scope.querySelector('.md-search-empty');if(empty)empty.hidden=shown>0;}
 root.addEventListener('cancel',event=>{if(event.target.matches('dialog')){event.preventDefault();closePanel();}},{capture:true,signal:life.signal});
 root.addEventListener('click',event=>{
  if(event.target.matches('dialog')){const box=event.target.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closePanel();return;}
  const trigger=event.target.closest('[data-action]');if(!trigger||!root.contains(trigger))return;
  const raw=trigger.dataset.action;const index=raw.indexOf(':');const action=index<0?raw:raw.slice(0,index);const id=index<0?'':raw.slice(index+1);
  if(action.startsWith('window-')){windowAction(action,id);return;}
  if(ui.locked&&!['lab-unlock','lab-lock-error'].includes(action))return;
  switch(action){
   case 'journey':{const [kind,...entity]=id.split(':');openJourney(kind,entity.join(':'));break;}
   case 'journey-close':closePanel();break;
   case 'journey-desktop':finishStory('desktop');break;
   case 'story-next':case 'story-move':case 'story-back':advanceStory(action,id);break;
   case 'story-finish':finishStory();break;
   case 'story-reset':if(ui.currentStory){const {kind,key}=ui.currentStory;ui.stories.set(key,newStoryboard(ui.lab.definitions[kind],ui.stories.get(key).entity));render();}break;
   case 'lab-lock':ui.locked=true;ui.lockError=false;ui.currentStory=null;ui.stage=false;ui.panel=null;render();break;
   case 'lab-unlock':ui.locked=false;ui.lockError=false;render();root.querySelector('.md-main')?.focus();break;
   case 'lab-lock-error':ui.lockError=true;render();break;
   case 'notification-filter':ui.notificationFilter=id;render();break;
   case 'notification-dismiss':if(!ui.dismissed.includes(id))ui.dismissed.push(id);render();break;
   case 'notification-restore':ui.dismissed=ui.dismissed.filter(item=>item!==id);render();break;
   case 'notification-dnd':ui.dnd=!ui.dnd;render();break;

   case 'route':navigate(id);break;
   case 'panel':id==='close'?closePanel():openPanel(id);break;
   case 'tab':ui.tab=id;ui.route='central';ui.presentation='central';ui.panel=null;render(true);break;
   case 'presentation':ui.currentStory=null;ui.stage=false;ui.presentation=presentationDestination(ui.presentation).target;ui.panel=null;render();break;
   case 'ask':ask(id);break;
   case 'app':openApp(id);break;
   case 'file':{const file=readData().files.find(item=>item.id===id&&item.space===readData().activeSpace);if(file)openApp(file.kind==='Coleção'?'internet':file.kind==='Modelo 3D'?'editor':'notes',id);break;}
   case 'project':case 'space':case 'profile':case 'store':case 'device':case 'message':case 'automation-detail':openPanel(action,id);break;
   case 'select-space':openJourney('space',id);break;
   case 'resume':resume(id);break;
   case 'scene':ui.panel=null;ui.currentStory=null;ui.stage=false;ui.presentation='central';ui.route='central';if(id==='guest'){selectIdentity('guest');}else{if(ui.subject!=='lia')selectIdentity('lia');source.dispatch({type:'scenario',id});}break;
   case 'focus':source.dispatch({type:action});break;
   case 'privacy':ui.privateMode=!ui.privateMode;render();break;
   case 'sync':ui.sync=!ui.sync;render();break;
   case 'task':case 'automation':source.dispatch({type:action,id});break;
   case 'read':ui.read=[...new Set([...ui.read,id])];render();break;
   case 'read-all':ui.read=[...new Set([...ui.read,...readData().activity.map(item=>item.id)])];render();break;
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
  if(['new-project'].includes(form.dataset.form)&&!String(values.get('name')??'').trim()){form.querySelector('[name=name]')?.focus();toast('Escolha um nome para continuar.');return;}
  if(['ask','reply'].includes(form.dataset.form)&&!String(values.get(form.dataset.form==='ask'?'prompt':'reply')??'').trim())return;
  if(['ask','reply','new-project'].includes(form.dataset.form)){for(const field of form.querySelectorAll('input[name],textarea[name]'))formDrafts.delete(draftKey(form,field));form.reset();}
  switch(form.dataset.form){
   case 'ask':ask(values.get('prompt'));break;
   case 'new-project':ui.panel=null;source.dispatch({type:'create-project',value:values.get('name'),subject:contextSubject(),space:readData().activeSpace});openPanel('project',source.getSnapshot().projects.at(-1).id);break;
   case 'save-note':source.dispatch({type:'file-draft',id:form.dataset.file,value:values.get('body')});toast('Rascunho guardado apenas nesta sessão de demonstração.');break;
   case 'reply':{const reply=String(values.get('reply')??'').trim().slice(0,1000);if(!reply)break;const id=form.dataset.conversation;ui.replies[id]=[...(ui.replies[id]??[]),reply];render();const input=root.querySelector('#md-reply');if(input){input.value='';input.focus();}break;}
  }
 },{signal:life.signal});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&ui.stage&&!ui.locked){event.preventDefault();closePanel();return;}if(!ui.locked&&!ui.stage&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openPanel('search');}},{signal:life.signal});
 root.addEventListener('pointerdown',event=>{const handle=event.target.closest('[data-drag-window]');if(!handle||event.button!==0||event.target.closest('.md-window-controls'))return;const win=ui.windows.find(item=>item.id===handle.dataset.dragWindow);if(win?.mode!=='floating')return;const el=handle.closest('[data-window]');const area=root.querySelector('.md-desktop-primary');const start={x:event.clientX,y:event.clientY,left:win.x??24,top:win.y??24};handle.setPointerCapture(event.pointerId);
  const move=e=>{win.x=Math.max(0,Math.min(Math.max(0,area.clientWidth-el.clientWidth),start.left+e.clientX-start.x));win.y=Math.max(0,Math.min(Math.max(0,area.clientHeight-el.clientHeight),start.top+e.clientY-start.y));el.style.setProperty('--window-x',`${win.x}px`);el.style.setProperty('--window-y',`${win.y}px`);};
  const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);};handle.addEventListener('pointermove',move,{signal:life.signal});handle.addEventListener('pointerup',end,{signal:life.signal});handle.addEventListener('pointercancel',end,{signal:life.signal});
 },{signal:life.signal});

 function readData(){
  const raw=source.getSnapshot();
  const local=ui.subject!=='lia'||ui.cloudExpired;
  const spaces=local?raw.spaces.filter(item=>item.id==='personal'):raw.spaces;
  const requestedSpace=ui.spaceUnavailable?null:local?'personal':raw.activeSpace;
  const activeSpace=spaces.some(item=>item.id===requestedSpace)?requestedSpace:null;
  const packageStates=[...ui.stories.entries()].filter(([key])=>{const scope=JSON.parse(key);return scope[0]===contextSubject()&&scope[1]===activeSpace;});
  const update=ui.stories.get(storyboardKey('update',contextSubject(),'@device',''));
  const updateLabel=ui.lab.definitions.update?.screens[update?.step]?.statusLabel??'Atualização e recuperação';
  const installed=packageStates.filter(([key,state])=>JSON.parse(key)[2]==='store'&&state.receipt==='available').map(([,state])=>({id:state.entity,space:activeSpace}));
  return {...raw,activeSpace,spaces,installed,updateLabel,read:ui.read,privateMode:ui.privateMode,sync:ui.sync,networkOnline:raw.scenario!=='offline',
   automations:local||activeSpace!=='studio'?[]:raw.automations,
   person:ui.subject==='other'?{name:'Visitante de teste',firstName:'Visitante',initials:'VT',email:'visitante@example.test'}:raw.person,
   scenario:local?'guest':raw.scenario,
   projects:!activeSpace?[]:raw.projects.filter(item=>item.space===activeSpace&&(item.subject??'lia')===contextSubject()),files:local||ui.spaceUnavailable?[]:raw.files.filter(item=>item.space===activeSpace),
   apps:local?raw.apps.filter(item=>['notes','files','calendar','music','intelligence'].includes(item.id)):raw.apps,
   messages:local?[]:raw.messages.filter(item=>(item.space??'studio')===activeSpace),
   activity:local?[]:raw.activity.filter(item=>(item.space??'studio')===activeSpace),
   agenda:local||activeSpace!=='studio'?[]:raw.agenda,
   devices:raw.devices.map(item=>({...item,online:item.online&&(raw.scenario!=='offline'||item.id==='computer'||item.id==='mic'),status:raw.scenario==='offline'&&!['computer','mic'].includes(item.id)?'Indisponível offline':item.status}))
  };
 }
 function contextSubject(){return ui.cloudExpired?'expired-local':ui.subject;}
 function sessionKey(subject=contextSubject(),space=readData().activeSpace){return JSON.stringify([subject,space]);}
 function stashSession(){rememberForms();ui.sessions.set(sessionKey(),Object.fromEntries(['windows','activeWindow','compactActive','compactCollapsed','drafts','prompt','replies','dismissed','read','privateMode','sync','notificationFilter','dnd'].map(key=>[key,ui[key]])));}
 function restoreSession(subject,space){const saved=ui.sessions.get(sessionKey(subject,space));Object.assign(ui,saved??{windows:[],activeWindow:null,compactActive:null,compactCollapsed:false,drafts:{},prompt:'',replies:{},dismissed:[],read:[],privateMode:true,sync:true,notificationFilter:'unread',dnd:false});}

 // Invalidating a visual approval is not granting/revoking a real capability.
 function invalidateStoryContext(onlyKind=null){
  for(const [key,state] of ui.stories){
   const kind=JSON.parse(key)[2];if(onlyKind&&kind!==onlyKind)continue;
   const fields={...state.fields};for(const name of Object.keys(fields))if(name.startsWith('confirm:'))fields[name]=false;
   const reset=['intelligence','device','communication','space','store','profile'].includes(kind);
   const start=ui.lab.definitions[kind].start;
   ui.stories.set(key,{...state,fields,...(reset?{step:start,trail:[],visited:[start]}:{}),receipt:['store','profile'].includes(kind)?state.receipt:null});
  }
 }
 function selectSpace(id){
  if(!readData().spaces.some(item=>item.id===id))return;
  stashSession();invalidateStoryContext();ui.spaceUnavailable=false;restoreSession(contextSubject(),id);ui.panel=null;ui.currentStory=null;ui.stage=false;
  source.dispatch({type:'space',id});
 }
 function selectIdentity(subject){
  stashSession();invalidateStoryContext();if(!ui.cloudExpired&&ui.subject==='lia')ui.lastAccountSpace=readData().activeSpace;ui.subject=subject;ui.spaceUnavailable=false;ui.cloudExpired=false;
  const space=subject==='lia'?(ui.lastAccountSpace??'studio'):'personal';
  restoreSession(subject,space);ui.panel=null;ui.currentStory=null;ui.stage=false;
  source.dispatch({type:'space',id:space});source.dispatch({type:'scenario',id:subject==='lia'?'connected':'guest'});
 }
 function openJourney(kind,entity='',step=null){clearTimeout(storyTimer);
  const definition=ui.lab.definitions[kind];if(!definition){toast('Jornada indisponível neste estudo.');return;}
  const data=readData();
  if(!entity)entity=kind==='space'?data.activeSpace:kind==='device'?'phone':kind==='settings'?'network':kind==='store'?'sketch':kind==='profile'?'design':'';
  const context=['setup','update','recovery','identity','power','storage','settings'].includes(kind)?'@device':data.activeSpace;
  const key=storyboardKey(kind,contextSubject(),context,entity);
  if(!ui.stories.has(key))ui.stories.set(key,newStoryboard(definition,entity));
  if(step&&definition.screens[step])ui.stories.set(key,{...ui.stories.get(key),step,trail:[],visited:[step]});
  if(!ui.panel){const el=document.activeElement;ui.returnFocus=root.contains(el)?{id:el.id,action:el.dataset.action}:null;}
  seedStoryFields(definition,ui.stories.get(key));
  ui.currentStory={kind,key};ui.stage=!!definition.fullscreen;ui.panel=ui.stage?null:{type:'journey'};render();root.querySelector('#md-story-title')?.focus({preventScroll:true});if(kind==='intelligence'&&ui.stories.get(key).step==='stream')animateStoryText(key);
 }
 function currentStoryMarkup(data){
  if(!ui.currentStory)return '';
  const {kind,key}=ui.currentStory;const definition=ui.lab.definitions[kind];
  return journeyFrame(definition.label,journeyView(kind,definition,ui.stories.get(key),data,ui));
 }
 function seedStoryFields(definition,state){for(const spec of storyboardFields(definition,state,ui.lab.topics))if(!(spec.id in state.fields))state.fields[spec.id]=spec.value??'';}
 function advanceStory(action,target){clearTimeout(storyTimer);
  if(!ui.currentStory)return;
  const {kind,key}=ui.currentStory;const definition=ui.lab.definitions[kind];const state=ui.stories.get(key);
  if(kind==='intelligence'&&state.step==='stream'&&action==='story-next'&&(state.fields.streamLength??0)<definition.screens.stream.text.length)return;
  const next=action==='story-back'?previousStoryboard(state):moveStoryboard(definition,state,action==='story-next'?definition.screens[state.step].next:target);
  if(next!==state&&action!=='story-back'&&kind==='setup'){
   if(next.step==='privacy')next.fields.accountChoice=['sign-in','sign-up'].includes(state.step)?'connected':'local';
   if(next.step==='security')next.fields.networkChoice=state.step==='network-connecting'?'connected':'offline';
  }
  if(next!==state&&kind==='identity'&&next.step==='expired'&&!ui.cloudExpired){stashSession();invalidateStoryContext();ui.lastAccountSpace=readData().activeSpace;ui.cloudExpired=true;restoreSession(contextSubject(),'personal');}
  if(kind==='files'&&next.step==='create')next.fields.fileAction='create';
  if(kind==='intelligence'&&next.step==='source-denied'){
   next.revokedSources=[...new Set([...(next.revokedSources??[]),...readData().files.map(file=>file.id)])];
   for(const id of next.revokedSources)next.fields['source:'+id]=false;
   for(const field of Object.keys(next.fields))if(field.startsWith('confirm:'))next.fields[field]=false;
  }
  if(kind==='settings'&&next.step==='complete')next.editing=false;
  if(kind==='settings'&&next.step==='undo'){next.fields={...next.fields,...next.beforeEdit};next.editing=false;}
  seedStoryFields(definition,next);if(kind==='intelligence'&&next.step==='stream')next.fields.streamLength=0;ui.stories.set(key,next);render();if(kind==='intelligence'&&next.step==='stream')animateStoryText(key);
  const scroll=root.querySelector('.md-panel-body')??root.querySelector('.md-stage');if(scroll)scroll.scrollTop=0;
  root.querySelector('#md-story-title')?.focus({preventScroll:true});
 }
 function animateStoryText(key){
  if(destroyed||!ui.currentStory||ui.currentStory.key!==key)return;
  const state=ui.stories.get(key);if(state.step!=='stream')return;
  const node=root.querySelector('[data-story-stream]');if(!node)return;
  const text=ui.lab.definitions.intelligence.screens.stream.text;
  state.fields.streamLength=Math.min(text.length,(state.fields.streamLength??0)+8);
  node.textContent=text.slice(0,state.fields.streamLength);
  const next=root.querySelector('[data-action="story-next"]');if(next)next.disabled=state.fields.streamLength<text.length;
  if(state.fields.streamLength<text.length)storyTimer=setTimeout(()=>animateStoryText(key),65);
 }
 function finishStory(destination='central'){clearTimeout(storyTimer);
  if(!ui.currentStory)return;
  const {kind,key}=ui.currentStory;const state=ui.stories.get(key);const frame=ui.lab.definitions[kind].screens[state.step];
  if(!frame.finish)return;
  if(frame.effect==='space-selected'){selectSpace(state.entity);render();return;}
  if(frame.effect==='space-unavailable'){stashSession();invalidateStoryContext();ui.spaceUnavailable=true;Object.assign(ui,{windows:[],activeWindow:null,compactActive:null,drafts:{},prompt:'',replies:{}});ui.currentStory=null;ui.stage=false;ui.panel=null;ui.route='central';render();openPanel('spaces');return;}
  if(frame.effect?.startsWith('identity-')){selectIdentity({'identity-connected':'lia','identity-guest':'guest','identity-other':'other'}[frame.effect]??'guest');return;}
  if(kind==='setup'){
   const signedIn=state.fields.accountChoice==='connected';
   selectIdentity(signedIn?'lia':'guest');
   if(state.fields.networkChoice==='offline')source.dispatch({type:'scenario',id:'offline'});
   ui.presentation=destination==='desktop'?'desktop':'central';ui.route='central';render();return;
  }
  closePanel();
 }
 function updateStoryField(target){
  if(!ui.currentStory)return;
  const {kind,key}=ui.currentStory;const state=ui.stories.get(key);const frame=ui.lab.definitions[kind].screens[state.step];
  const field=target.dataset.storyField;
  const specs=storyboardFields(ui.lab.definitions[kind],state,ui.lab.topics);
  const spec=specs.find(item=>item.id===field);
  const sourceField=frame.sources&&readData().files.some(file=>file.space===readData().activeSpace&&field==='source:'+file.id&&!state.revokedSources?.includes(file.id));
  const confirmation=frame.confirm&&field==='confirm:'+state.step;
  if(!spec&&!sourceField&&!confirmation)return;
  const value=target.type==='checkbox'?target.checked:String(target.value).slice(0,spec?.max??128);
  if(spec?.options&&!spec.options.some(item=>item.value===value))return;
  if(kind==='settings'&&frame.topicFields&&!state.editing){state.beforeEdit=Object.fromEntries(specs.map(item=>[item.id,state.fields[item.id]??item.value??'']));state.editing=true;}
  state.fields[field]=value;
  if(!confirmation&&frame.confirm){state.fields['confirm:'+state.step]=false;const box=root.querySelector('[data-story-field="confirm:'+state.step+'"]');if(box)box.checked=false;const next=root.querySelector('[data-action="story-next"]');if(next)next.disabled=true;}
  if(confirmation){const next=root.querySelector('[data-action="story-next"]');if(next)next.disabled=!value;}
 }
 root.addEventListener('input',event=>{if(event.target.dataset.storyField)updateStoryField(event.target);},{signal:life.signal});
 root.addEventListener('change',event=>{if(event.target.dataset.storyField)updateStoryField(event.target);},{signal:life.signal});

 const unsubscribe=source.subscribe(()=>render());render();if(options.journey&&ui.lab.definitions[options.journey])openJourney(options.journey);
 return {destroy(){if(destroyed)return;destroyed=true;clearTimeout(toastTimer);clearTimeout(storyTimer);life.abort();unsubscribe();formDrafts.clear();ui.stories.clear();ui.sessions.clear();root.replaceChildren();},source};
}
