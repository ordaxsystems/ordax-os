// Preview navigation, not an installation or application authority.
export const sections = Object.freeze([
 {id:'central',label:'Central',sidebarLabel:'Início',icon:'central',group:'principal'},
 {id:'intelligence',label:'Intelligence',icon:'aura',group:'principal'},
 {id:'spaces',label:'Spaces',icon:'spaces',group:'principal'},
 {id:'apps',label:'Aplicativos',icon:'apps',group:'ecossistema'},
 {id:'profiles',label:'Perfis',icon:'profiles',group:'ecossistema'},
 {id:'devices',label:'Dispositivos',icon:'desktop',group:'ecossistema'},
 {id:'store',label:'Descobrir',icon:'store',group:'ecossistema'},
 {id:'activity',label:'Continuidade',icon:'clock',group:'contexto'},
 {id:'messages',label:'Conversas',icon:'message',group:'contexto'},
 {id:'automations',label:'Automações',icon:'flow',group:'contexto'},
 {id:'files',label:'Arquivos',icon:'folder',group:'contexto'},
 {id:'settings',label:'Ajustes',icon:'settings',group:'sistema'},
]);
export const findSection = id => sections.find(item => item.id === id) ?? sections[0];
export const sceneOptions = Object.freeze([
 {id:'connected',label:'Com conta',description:'Contexto pessoal e dispositivos de exemplo.'},
 {id:'guest',label:'Sem conta',description:'O dispositivo continua útil e o trabalho fica local.'},
 {id:'offline',label:'Offline',description:'Continuidade local e sincronização pausada.'},
 {id:'empty',label:'Primeiro dia',description:'Um Space novo, sem histórico.'},
 {id:'loading',label:'Carregando',description:'Estrutura preservada enquanto os dados chegam.'},
 {id:'error',label:'Serviço indisponível',description:'Recuperação com contexto local preservado.'},
]);

// One metadata source for app windows and Surface destinations in the preview.
export function windowTarget(data,id){
 const app=data.apps.find(item=>item.id===id);
 if(app)return {...app,route:id==='intelligence'?'intelligence':undefined};
 if(!id.startsWith('section:'))return null;
 const section=sections.find(item=>item.id===id.slice(8)&&item.id!=='central');
 return section?{id,name:section.label,icon:section.icon,tone:'slate',route:section.id}:null;
}
