import { demoData } from './data.mjs';
import { sceneOptions } from '../catalog.mjs';
/** A session-only presentation source. This is not an OrdaX domain port.
 * @typedef {{getSnapshot:()=>object, subscribe:(listener:Function)=>Function,
 * dispatch:(event:{type:string,id?:string,value?:unknown,subject?:string,space?:string})=>void, destroy:()=>void}} MeridianPreviewSource
 */
export function createMeridianDemoSource() {
 let snapshot = {...structuredClone(demoData),scenario:'connected',activeSpace:'studio',focus:false};
 const listeners = new Set();
 const publish = next => { snapshot = next; for(const listener of listeners) listener(snapshot); };
 return {
  getSnapshot:()=>snapshot,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  dispatch(event){
   switch(event.type){
    case 'scenario': if(sceneOptions.some(item=>item.id===event.id))publish({...snapshot,scenario:event.id}); break;
    case 'space': if(snapshot.spaces.some(item=>item.id===event.id))publish({...snapshot,activeSpace:event.id}); break;
    case 'create-project': {
     const name=String(event.value??'').trim().slice(0,64);const space=event.space??snapshot.activeSpace;if(!name||!snapshot.spaces.some(item=>item.id===space))return;
     publish({...snapshot,scenario:snapshot.scenario==='empty'?'connected':snapshot.scenario,projects:[...snapshot.projects,{id:`preview-project-${snapshot.projects.length+1}`,name,description:'Uma ideia em construção.',category:'Novo projeto',updated:'Agora',tone:'clay',progress:0,space,subject:event.subject??'lia'}]});break;
    }
    case 'task': publish({...snapshot,tasks:snapshot.tasks.map(item=>item.id===event.id?{...item,done:!item.done}:item)});break;
    case 'automation': publish({...snapshot,automations:snapshot.automations.map(item=>item.id===event.id?{...item,enabled:!item.enabled}:item)});break;
    case 'focus': publish({...snapshot,focus:!snapshot.focus});break;
    case 'file-draft': publish({...snapshot,files:snapshot.files.map(item=>item.id===event.id?{...item,body:String(event.value??'').slice(0,20000)}:item)});break;
   }
  },
  destroy(){listeners.clear();}
 };
}
