import {settingsTopics} from './scenarios.mjs';
export {settingsTopics};
export const settingsJourneyTopics=[...settingsTopics,
 {id:'continuity',name:'Continuidade entre dispositivos',icon:'desktop',detail:'Escolha como seu trabalho acompanha você.',fields:[{id:'continuity',label:'Continuidade',value:'review',options:[{value:'local',label:'Somente neste dispositivo'},{value:'review',label:'Revisar antes de sincronizar'}]}]},
 {id:'memory',name:'Memória e permissões',icon:'shield',detail:'Revise quais informações podem acompanhar seu contexto.',fields:[{id:'memory',label:'Memória do contexto',value:'ask',options:[{value:'ask',label:'Consultar antes de guardar'},{value:'off',label:'Não guardar contexto'}]}]},
];
