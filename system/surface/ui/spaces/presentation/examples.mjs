// Fictional, opt-in presentation examples. Never authorized account data.
export const spaceExamples=[
  {id:'studio',featuredApps:["studio", "notes", "files", "internet", "editor"],name:'Estúdio',icon:'aura',tone:'clay',description:'Ideias que ganham forma.',members:'Você + 2 pessoas',profile:'Criação & design',modules:['Studio','Arquivos','Quadro de referências'],permission:'Somente este Space',storage:'12,8 GB'},
  {id:'personal',featuredApps:["notes", "files", "calendar", "music", "intelligence"],name:'Pessoal',icon:'sun',tone:'sage',description:'Seu ritmo. Seu espaço.',members:'Só você',profile:'Pessoal',modules:['Notas','Agenda','Música'],permission:'Privado',storage:'4,2 GB'},
  {id:'workshop',featuredApps:["editor", "files", "notes", "intelligence"],name:'Oficina 3D',icon:'cube',tone:'blue',description:'Do primeiro esboço ao objeto.',members:'Você + 1 pessoa',profile:'Impressão 3D',modules:['Editor 3D','Fila de produção','Materiais'],permission:'Dispositivos selecionados',storage:'28,6 GB'},
  {id:'achegue',name:'Achegue-se',icon:'globe',tone:'sage',description:'Empresas, serviços e oportunidades locais.',members:'Você + 8 pessoas',profile:'Empresas',modules:['Empresas','Solicitações','Diretório'],permission:'Membros deste Space',storage:'8,6 GB'},
  {id:'pizza',name:'Pizzaria Bella Napoli',icon:'store',tone:'amber',description:'Sabor italiano no seu bairro.',members:'Você + 5 pessoas',profile:'Pizzaria',modules:['Pedidos','Mesas','Delivery'],permission:'Equipe da operação',storage:'3,1 GB'},
  {id:'development',name:'Desenvolvimento',icon:'terminal',tone:'slate',description:'Projetos, código e ferramentas em um lugar.',members:'Você + 2 pessoas',profile:'Desenvolvimento',modules:['Studio','Projetos','Repositórios'],permission:'Equipe de desenvolvimento',storage:'14,2 GB'},
  {id:'ordax-site',name:'OrdaX Site',icon:'globe',tone:'blue',description:'Site institucional e experiências públicas.',members:'Você + 1 pessoa',profile:'Site / Plataforma',modules:['Páginas','Conteúdo','Publicação'],permission:'Equipe do site',storage:'1,4 GB'},
  {id:'stlforge',name:'STLForge',icon:'cube',tone:'amber',description:'Um catálogo para dar forma às ideias.',members:'Você + 1 pessoa',profile:'Impressão 3D',modules:['Modelos','Catálogo','Coleções'],permission:'Equipe do catálogo',storage:'6,8 GB'},
  {id:'personal-projects',name:'Projetos pessoais',icon:'folder',tone:'rose',description:'Ideias e experimentos no seu tempo.',members:'Só você',profile:'Pessoal',modules:['Notas','Projetos','Referências'],permission:'Privado',storage:'2,4 GB'},
 ];
const spaceDashboards={
 studio:{primary:true,group:'Criação',recent:4,metrics:[['Projetos','2','Em andamento'],['Pessoas','3','No Space'],['Próximo encontro','14h','Revisão de referências']]},
 personal:{group:'Pessoal',recent:8,metrics:[['Notas','12','Suas ideias'],['Agenda','3','Hoje']]},
 workshop:{primary:true,group:'Operação',recent:3,favorite:true,location:'Salvador · BA',metrics:[['Pedidos','12','↑ 33% no período'],{label:'Impressoras',value:'4 / 6',detail:'67% em uso',progress:67},['Modelos','156','↑ 12% no período']],attention:{title:'Confira o material da oficina',detail:'PLA preto abaixo do estoque mínimo.',time:'Há 1 h'}},
 achegue:{group:'Operação',recent:1,location:'Salvador · BA',metrics:[['Usuários','12.480','↑ 18% no período'],['Empresas','1.263','↑ 24% no período'],['Solicitações','47','Para acompanhar']],attention:{title:'Empresas aguardando revisão',detail:'23 empresas precisam da sua atenção.',time:'Há 2 h'}},
 pizza:{primary:true,group:'Operação',recent:2,location:'Salvador · BA · Pituba',metrics:[['Pedidos hoje','28','↑ 12% no período'],{label:'Mesas ocupadas',value:'8 / 12',detail:'67% em uso',progress:67},['Faturamento hoje','R$ 1.842','↑ 18% no período'],['Delivery','6','Em andamento']],attention:{title:'Pedidos em atraso',detail:'3 pedidos aguardando conclusão.',time:'Há 18 min'}},
 development:{primary:true,group:'Desenvolvimento',recent:5,favorite:true,metrics:[['Projetos','4','Em andamento'],['PRs abertos','3','Para revisar'],{label:'Builds',value:'Em dia',detail:'Última execução concluída',tone:'positive'}]},
 'ordax-site':{group:'Operação',recent:6,metrics:[['Visitas / mês','2.846','Seu alcance']]},
 stlforge:{group:'Operação',recent:7,metrics:[['Modelos','1.320','No catálogo']]},
 'personal-projects':{group:'Pessoal',recent:9,metrics:[['Projetos','7','Ideias em construção']]},
};
for(const space of spaceExamples)space.dashboard=spaceDashboards[space.id];
export const spaceActivityExamples=[
 {space:'pizza',title:'Novo pedido #1083',time:'Há 12 min',icon:'store'},
 {space:'achegue',title:'Empresa aguardando revisão',time:'Há 28 min',icon:'briefcase'},
 {space:'workshop',title:'Impressão concluída',time:'Há 1 h',icon:'cube'},
 {space:'ordax-site',title:'Publicação concluída',time:'Há 2 h',icon:'globe'},
 {space:'stlforge',title:'Novo modelo publicado',time:'Há 3 h',icon:'cube'},
];
export const spaceTemplateExamples=[
 {id:'local-business',name:'Negócio local',icon:'store',tone:'amber'},
 {id:'commerce',name:'E-commerce',icon:'briefcase',tone:'rose'},
 {id:'printing',name:'Impressão 3D',icon:'cube',tone:'blue'},
 {id:'website',name:'Site / Plataforma',icon:'globe',tone:'sage'},
 {id:'software',name:'Desenvolvimento',icon:'terminal',tone:'slate'},
 {id:'personal',name:'Uso pessoal',icon:'folder',tone:'clay'},
];

const cityCover=new URL("../../../workspace/assets/demo-salvador-1.jpg",import.meta.url).href;
spaceExamples.find(space=>space.id==="achegue").cover=cityCover;
