import test from 'node:test';
import assert from 'node:assert/strict';
import {shell} from '../system/surface/experiments/meridian/views/shell.mjs';
import {demoData} from '../system/surface/experiments/meridian/demo/data.mjs';
import {filterSpaces,isSpaceFavorite,spacesView} from '../system/surface/experiments/meridian/views/spaces.mjs';
const data={...demoData,presentationSubject:'lia',activeSpace:'studio',networkOnline:true};
test('spaces search is accent insensitive and combines with the category',()=>{
 assert.deepEqual(filterSpaces(data,{spacesQuery:'operacao',spacesCategory:'Desenvolvimento'}),[]);
 assert.deepEqual(filterSpaces(data,{spacesQuery:'pizzaria',spacesCategory:'Operação'}).map(s=>s.id),['pizza']);
 assert.deepEqual(filterSpaces(data,{spacesQuery:'impressao'}).map(s=>s.id),['workshop','stlforge']);
});
test('favorites are reversible, scoped by subject and bounded by visible memberships',()=>{
 const pizza=data.spaces.find(s=>s.id==='pizza');
 const ui={spacesCategory:'Favoritos',spaceFavorites:{[JSON.stringify(['lia','pizza'])]:true}};
 assert.equal(isSpaceFavorite(data,ui,pizza),true);
 assert.equal(isSpaceFavorite({...data,presentationSubject:'guest'},ui,pizza),false);
 assert.ok(filterSpaces(data,ui).some(s=>s.id==='pizza'));
 ui.spaceFavorites[JSON.stringify(['lia','pizza'])]=false;
 assert.ok(!filterSpaces(data,ui).some(s=>s.id==='pizza'));
 assert.deepEqual(filterSpaces({...data,spaces:data.spaces.filter(s=>s.id==='personal')},ui),[]);
});
test('sorting never mutates the source and all original spaces remain available',()=>{
 const original=data.spaces.map(s=>s.id);
 const ordered=filterSpaces(data,{spacesSort:'name'});
 assert.deepEqual(ordered.map(s=>s.name),[...ordered].map(s=>s.name).sort((a,b)=>a.localeCompare(b,'pt-BR')));
 assert.deepEqual(data.spaces.map(s=>s.id),original);
 for(const id of ['studio','personal','workshop'])assert.ok(original.includes(id));
});
test('local-only subject cannot render other spaces metrics, alerts or activity',()=>{
 const local={...data,presentationSubject:'guest',activeSpace:'personal',spaces:data.spaces.filter(s=>s.id==='personal')};
 const html=spacesView(local,{});
 assert.ok(!html.includes('Pizzaria Bella Napoli'));
 assert.ok(!html.includes('PLA preto'));
 assert.ok(!html.includes('pedido #1083'));
 assert.ok(html.includes('Seu ritmo. Seu espaço.'));
});

test('Spaces extends the single global sidebar without adding page navigation',()=>{
 const ui={presentation:'central',route:'spaces',subject:'lia',windows:[],dismissed:[],read:[],spaceFavorites:{}};
 const body=spacesView(data,ui);
 const html=shell({...data,read:[]},ui,body);
 assert.equal((html.match(/aria-label="Navegação principal"/g)??[]).length,1);
 assert.ok(!body.includes('Navegação de Espaços'));
 for(const action of ['route:files','route:calendar','route:tasks','route:messages','panel:notifications','select-space:pizza'])assert.ok(html.includes('data-action="'+action+'"'));
});
