import { demoData } from './data.mjs';
import { sceneOptions } from '../catalog.mjs';
/** A session-only presentation source. This is not an OrdaX domain port.
 * @typedef {{getSnapshot:()=>object, subscribe:(listener:Function)=>Function,
 * dispatch:(event:{type:string,id?:string,value?:unknown})=>void, destroy:()=>void}} MeridianPreviewSource
 */
export function createMeridianDemoSource() {
 let snapshot = {...structuredClone(demoData),scenario:'connected',activeSpace:'studio',installed:[],read:[],focus:false,privateMode:true,sync:true};
 const listeners = new Set();
 const publish = next => { snapshot = next; for(const listener of listeners) listener(snapshot); };
 return {
  getSnapshot:()=>snapshot,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  dispatch(event){
   switch(event.type){
    case 'scenario': if(sceneOptions.some(item=>item.id===event.id))publish({...snapshot,scenario:event.id}); break;
    case 'space': if(snapshot.spaces.some(item=>item.id===event.id))publish({...snapshot,activeSpace:event.id}); break;
    case 'create-space': {
     const name=String(event.value??'').trim().slice(0,64); if(!name)return;
     const id=`preview-space-${snapshot.spaces.length+1}`;
     publish({...snapshot,activeSpace:id,spaces:[...snapshot.spaces,{id,name,icon:'spaces',tone:'slate',description:'Um espaço para começar.',members:'Só você',profile:'Pessoal',modules:['Arquivos','Notas'],permission:'Privado',storage:'0 GB'}]});break;
    }
    case 'create-project': {
     const name=String(event.value??'').trim().slice(0,64);if(!name)return;
     publish({...snapshot,scenario:snapshot.scenario==='empty'?'connected':snapshot.scenario,projects:[...snapshot.projects,{id:`preview-project-${snapshot.projects.length+1}`,name,description:'Uma ideia em construção.',category:'Novo projeto',updated:'Agora',tone:'clay',progress:0,space:snapshot.activeSpace}]});break;
    }
    case 'install': if(snapshot.store.some(item=>item.id===event.id)&&!snapshot.installed.some(item=>item.id===event.id&&item.space===snapshot.activeSpace))publish({...snapshot,installed:[...snapshot.installed,{id:event.id,space:snapshot.activeSpace}]});break;
    case 'read': publish({...snapshot,read:[...new Set([...snapshot.read,event.id])]});break;
    case 'read-all': publish({...snapshot,read:snapshot.activity.map(item=>item.id)});break;
    case 'task': publish({...snapshot,tasks:snapshot.tasks.map(item=>item.id===event.id?{...item,done:!item.done}:item)});break;
    case 'automation': publish({...snapshot,automations:snapshot.automations.map(item=>item.id===event.id?{...item,enabled:!item.enabled}:item)});break;
    case 'profile': {
     const profile=snapshot.profiles.find(item=>item.id===event.id);if(!profile)return;
     publish({...snapshot,spaces:snapshot.spaces.map(item=>item.id===snapshot.activeSpace?{...item,profile:profile.name}:item)});break;
    }
    case 'focus': publish({...snapshot,focus:!snapshot.focus});break;
    case 'privacy': publish({...snapshot,privateMode:!snapshot.privateMode});break;
    case 'sync': publish({...snapshot,sync:!snapshot.sync});break;
    case 'file-draft': publish({...snapshot,files:snapshot.files.map(item=>item.id===event.id?{...item,body:String(event.value??'').slice(0,20000)}:item)});break;
   }
  },
  destroy(){listeners.clear();}
 };
}
