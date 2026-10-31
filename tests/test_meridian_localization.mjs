import assert from 'node:assert/strict';
import test from 'node:test';
import {MERIDIAN_SOURCE_MESSAGES,MERIDIAN_ENGLISH_MESSAGES} from '../system/services/i18n/catalog/meridian.mjs';
import {translateSurfaceMessage} from '../system/services/i18n/surface.mjs';
import {createJourneyScenarios} from '../system/surface/ui/journeys/scenarios.mjs';
import {createSettingsJourneyCatalog} from '../system/surface/ui/journeys/settings-catalog.mjs';
import {createJourneyView} from '../system/surface/ui/journeys/view.mjs';
import {newStoryboard,moveStoryboard} from '../system/surface/ui/journeys/navigation.mjs';
import {createSpaceExamples} from '../system/surface/ui/spaces/presentation/examples.mjs';
import {createSpacesView} from '../system/surface/ui/spaces/presentation/view.mjs';
import {mountSettingsJourneys} from '../system/surface/ui/journeys/settings-mount.mjs';

test('Meridian copy belongs to the existing exact bilingual Surface catalog',()=>{
 assert.deepEqual(Object.keys(MERIDIAN_ENGLISH_MESSAGES),Object.keys(MERIDIAN_SOURCE_MESSAGES));
 for(const [id,source] of Object.entries(MERIDIAN_SOURCE_MESSAGES)){
  assert.equal(translateSurfaceMessage('pt-BR',id),source,id);
  assert.equal(translateSurfaceMessage('en-US',id),MERIDIAN_ENGLISH_MESSAGES[id],id);
  assert.ok(MERIDIAN_ENGLISH_MESSAGES[id].trim(),id);
  assert.doesNotMatch(MERIDIAN_ENGLISH_MESSAGES[id],/[ãõç]|\b(?:nenhuma|somente|concluída|indisponível|continuar|configuração|dispositivo)\b/iu,id);
 }
});

test('localization preserves every scenario, transition, option identity and confirmation gate',()=>{
 const source=createJourneyScenarios('pt-BR').storyboards;
 const english=createJourneyScenarios('en-US').storyboards;
 assert.deepEqual(Object.keys(english),Object.keys(source));
 let confirmations=0;
 for(const [kind,definition] of Object.entries(source)){
  const translated=english[kind];
  assert.equal(translated.start,definition.start);
  assert.deepEqual(Object.keys(translated.screens),Object.keys(definition.screens));
  for(const [step,screen] of Object.entries(definition.screens)){
   const other=translated.screens[step];
   assert.equal(other.next,screen.next,`${kind}/${step}`);
   for(const list of ['actions','conditions','links']){
    assert.deepEqual((other[list]??[]).map(item=>[item.action,item.target]),(screen[list]??[]).map(item=>[item.action,item.target]),`${kind}/${step}/${list}`);
   }
   assert.deepEqual((other.fields??[]).map(field=>[field.id,field.type,field.options?.map(option=>option.value)]),(screen.fields??[]).map(field=>[field.id,field.type,field.options?.map(option=>option.value)]),`${kind}/${step}/fields`);
   assert.equal(Boolean(other.confirm),Boolean(screen.confirm));
   if(other.confirm&&other.next){
    confirmations++;
    const state={...newStoryboard(translated),step};
    assert.equal(moveStoryboard(translated,state,other.next),state,`${kind}/${step}: unconfirmed`);
    assert.equal(moveStoryboard(translated,{...state,fields:{[`confirm:${step}`]:true}},other.next).step,other.next);
   }
  }
 }
 assert.ok(confirmations>10,'review gates must remain exercised');
});

test('English rendering covers all journeys and retains unavailable and example states',()=>{
 const {storyboards,systemFixture}=createJourneyScenarios('en-US');
 const {settingsJourneyTopics}=createSettingsJourneyCatalog('en-US');
 const {journeyView,storyboardFields}=createJourneyView('en-US');
 const {spaceExamples}=createSpaceExamples('en-US');
 const example={id:'example',name:'Example resource',icon:'cube',tone:'sage',description:'Fictional resource'};
 const data={spaces:spaceExamples,activeSpace:'achegue',projects:[],files:[],devices:[example],profiles:[example],store:[example]};
 const ui={windows:[],pendingDraftCount:0,lab:{topics:settingsJourneyTopics,system:systemFixture}};
 let rendered=0;
 for(const [kind,definition] of Object.entries(storyboards))for(const step of Object.keys(definition.screens)){
  const entity=kind==='space'?'achegue':kind==='settings'?'network':['profile','store','device'].includes(kind)?'example':'';
  const state={...newStoryboard(definition,entity),step};
  for(const field of storyboardFields(definition,state,settingsJourneyTopics))state.fields[field.id]=field.value??'';
  const html=journeyView(kind,definition,state,data,ui);
  assert.ok(html.includes('md-story-title'),`${kind}/${step}`);
  assert.doesNotMatch(html,/meridian\.text\.|\b(?:nenhuma|somente|indisponível|continuar|configuração|dispositivo|itens|rascunhos)\b/iu,`${kind}/${step}`);
  rendered++;
 }
 assert.ok(rendered>100);
 const settings=storyboards.settings;
 assert.match(journeyView('settings',settings,{...newStoryboard(settings,'network')},data,ui),/Network and Wi-Fi/);
});

test('English Spaces preserve example identity, isolated favorites and escaped content',()=>{
 const original=createSpaceExamples('pt-BR').spaceExamples;
 const examples=createSpaceExamples('en-US').spaceExamples;
 assert.deepEqual(examples.map(space=>space.id),original.map(space=>space.id));
 const data={spaces:examples,activeSpace:'achegue',spaceActivity:[],spaceTemplates:[],presentationSubject:'examples'};
 const ui={spacesQuery:'',spacesCategory:'All',spacesSort:'recent',spaceFavorites:{}};
 const view=createSpacesView('en-US');
 const html=view.spacesView(data,ui);
 assert.match(html,/SPACE IN USE/);
 assert.match(html,/Create new space/);
 assert.match(html,/Your spaces/);
 assert.doesNotMatch(html,/meridian\.text\.|ESPAÇO EM USO|Criar novo espaço|Seus espaços/);
 const hostile={...examples[0],name:'<img src=x onerror=alert(1)>'};
 const escaped=view.spacesView({...data,spaces:[hostile],activeSpace:hostile.id},ui);
 assert.ok(!escaped.includes('<img src=x'));
 assert.ok(escaped.includes('&lt;img'));
});

test('Settings use the injected locale and never resurrect a disposed presentation',()=>{
 let locale='pt-BR';
 const listeners=new Set();
 const host={ownerDocument:{},addEventListener(type,listener){listeners.add(listener);},removeEventListener(type,listener){listeners.delete(listener);}};
 const mounted=mountSettingsJourneys(host,{getLocale:()=>locale});
 assert.match(mounted.overview(),/Jornadas completas de exemplo/);
 locale='en-US';
 assert.match(mounted.overview(),/Complete example journeys/);
 assert.equal(listeners.size,1);
 mounted.destroy();mounted.destroy();mounted.open('network');
 assert.equal(mounted.overview(),'');
 assert.equal(listeners.size,0);
});
