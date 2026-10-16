// Presentation-only metadata. These fixtures never enter the official catalog port.
import { catalog, kindMeta } from '../../../lib/store/catalog.ts';
export { kindMeta };
const sample = {
  studio: { version:'0.6.0', installedVersion:'0.6.0', size:'38 MB', date:'2026-10-10', license:'Licença OrdaX · exemplo', channel:'Beta', icon:'terminal', tone:'clay', screenshots:'studio', featured:true, collection:'create', changes:['Componentes visuais organizados por projeto.', 'Melhor navegação entre arquivos e referências.'] },
  files: { version:'0.5.2', installedVersion:'0.5.1', size:'8,4 MB', date:'2026-10-12', license:'Licença OrdaX · exemplo', channel:'Beta', icon:'folder', tone:'sage', screenshots:'files', featured:true, collection:'daily', changes:['Visualização de arquivos com origem e contexto.', 'Ajustes de leitura em telas pequenas.'] },
  notes: { version:'0.4.2', installedVersion:'0.4.1', size:'4,8 MB', date:'2026-10-11', license:'Licença OrdaX · exemplo', channel:'Beta', icon:'file', tone:'amber', screenshots:'notes', featured:true, collection:'daily', changes:['Organização das notas por projeto.', 'A atualização deste exemplo falha para demonstrar a preservação da versão anterior.'] },
  media: { version:'0.3.0', installedVersion:null, size:'12 MB', date:'2026-10-09', license:'Licença OrdaX · exemplo', channel:'Beta', icon:'play', tone:'rose', newItem:true, collection:'daily', changes:['Controles de reprodução e biblioteca local.'] },
  'llama-8b': {icon:'aura',tone:'sage',featured:true,collection:'ai'},
  'qwen-7b': {icon:'aura',tone:'blue',collection:'ai'},
  'phi-mini': {icon:'aura',tone:'amber',collection:'ai'},
  github: {icon:'terminal',tone:'slate',featured:true,collection:'create'},
  notion: {icon:'book',tone:'clay',collection:'daily'},
  dropbox: {icon:'folder',tone:'blue'},
  slack: {icon:'message',tone:'rose'},
  aurora: {version:'0.2.0',size:'2,1 MB',date:'2026-10-08',icon:'sun',tone:'clay',collection:'personal',featured:true},
  'pt-pt': {version:'0.2.0',size:'1,2 MB',date:'2026-10-06',icon:'globe',tone:'sage',collection:'personal'},
  'startup-tpl': {version:'0.1.0',size:'840 KB',date:'2026-10-07',icon:'folder',tone:'blue',collection:'create'},
  'lint-tools': {version:'0.2.1',installedVersion:'0.2.0',size:'3,2 MB',date:'2026-10-12',icon:'terminal',tone:'sage',changes:['Análise do projeto com resultados agrupados.'],permissionChange:['Leitura dos arquivos do projeto escolhido']},
};
const tones={violet:'clay',blue:'blue',cyan:'sage',green:'sage',amber:'amber',pink:'rose'};
const glyphs={app:'apps',model:'aura',provider:'globe',agent:'flow',connector:'link',plugin:'cube',package:'sun'};
export const items=catalog.map(item=>({...item,preview:{ icon:glyphs[item.kind],tone:tones[item.tone]??'slate',...sample[item.id] }}));
export const sections=[
  {id:'discover',label:'Descobrir',icon:'store',group:'explore'},
  {id:'essentials',label:'Essenciais',icon:'aura',group:'explore'},
  {id:'apps',label:'Aplicativos',icon:'apps',group:'catalog'},
  {id:'models',label:'Modelos de IA',icon:'aura',group:'catalog'},
  {id:'connectors',label:'Conectores',icon:'link',group:'catalog'},
  {id:'extensions',label:'Extensões',icon:'cube',group:'catalog'},
  {id:'packages',label:'Personalização',icon:'sun',group:'catalog'},
  {id:'library',label:'Minha biblioteca',icon:'book',group:'manage'},
  {id:'installed',label:'Instalados',icon:'desktop',group:'manage'},
  {id:'updates',label:'Atualizações',icon:'clock',group:'manage'},
];
export const copy={
  discover:['DESCUBRIR','Novas peças para o seu mundo.','Ferramentas para criar, organizar e ir um pouco além.'],
  essentials:['ESSENCIAIS','Um bom começo, todos os dias.','Uma seleção de ferramentas para o seu primeiro passo.'],
  apps:['APLICATIVOS','O que você precisa, à mão.','Encontre o aplicativo certo para o que você quer fazer.'],
  models:['MODELOS DE IA','Inteligência no seu ritmo.','Conheça modelos locais, seus requisitos e possibilidades.'],
  connectors:['CONECTORES','Seu trabalho encontra novas conexões.','Serviços externos com acesso escolhido por você.'],
  extensions:['EXTENSÕES','Um pouco mais em cada ferramenta.','Recursos que complementam aplicativos e o Intelligence.'],
  packages:['PERSONALIZAÇÃO','Um OrdaX com a sua cara.','Temas, idiomas e templates. Pequenas escolhas, novas perspectivas.'],
  library:['MINHA BIBLIOTECA','O que você quer por perto.','Seus recursos, favoritos e descobertas recentes.'],
  installed:['INSTALADOS','Seu OrdaX, em boa companhia.','Aplicativos e extensões que fazem parte desta demonstração.'],
  updates:['ATUALIZAÇÕES','Espaço para evoluir.','Veja o que muda e acompanhe cada etapa da atualização.'],
};
// Named stages are visual fixtures; different resource types do not share one lifecycle.
export function operationSteps(op, item) {
  if(op==='install'||op==='update')return ['Solicitação','Aquisição','Verificação','Staging','Ativação','Health check','Promoção','Resultado'];
  if(op==='remove')return ['Solicitação','Validar remoção','Remover aplicativo','Preservar dados','Resultado'];
  if(op==='connect')return ['Solicitação','Revisar autorização','Confirmar serviço','Conectado'];
  if(op==='disconnect')return ['Solicitação','Revogar acesso','Desconectado'];
  if(op==='enable')return ['Solicitação','Verificar dependências','Revisar permissões','Habilitado'];
  if(op==='disable')return ['Solicitação','Desabilitar agente','Desabilitado'];
  if(op==='apply')return item?.packageType==='Idioma'
    ? ['Solicitação','Validar pacote','Preparar idioma','Reinício pendente']
    : item?.packageType==='Template'
      ? ['Solicitação','Validar template','Disponível em novos projetos']
      : ['Solicitação','Validar pacote','Aplicar aparência','Aplicado'];
  return ['Solicitação','Resultado'];
}
