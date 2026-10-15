import test from 'node:test';
import assert from 'node:assert/strict';
import {newStoryboard,moveStoryboard,previousStoryboard,storyboardKey} from '../system/surface/experiments/meridian/journeys/navigation.mjs';
import {storyboards} from '../system/surface/experiments/meridian/demo/storyboards.mjs';

test('returning to a review requires a fresh point-in-time confirmation',()=>{
 const d=storyboards.intelligence;
 let s={...newStoryboard(d),step:'review',fields:{'confirm:review':true}};
 s=moveStoryboard(d,s,'running');
 s=previousStoryboard(s);
 assert.equal(s.step,'review');
 assert.equal(s.fields['confirm:review'],false);
 assert.equal(moveStoryboard(d,s,'running'),s);
});
test('a completed package removal cannot navigate back to its installed receipt',()=>{
 const d=storyboards.store;
 let s={...newStoryboard(d),step:'complete',receipt:'available'};
 s=moveStoryboard(d,s,'remove');
 s.fields['confirm:remove']=true;
 s=moveStoryboard(d,s,'removed');
 assert.equal(s.receipt,'removed');
 assert.equal(previousStoryboard(s),s);
 s=moveStoryboard(d,s,'details');
 assert.equal(s.receipt,'removed');
 assert.notEqual(s.step,'complete');
});
test('blocked verification cannot jump directly to activation',()=>{
 for(const kind of ['store','profile','update']){
  const d=storyboards[kind],step=kind==='update'?'invalid':'blocked';
  const s={...newStoryboard(d),step};
  assert.equal(moveStoryboard(d,s,'activate'),s);
  assert.equal(moveStoryboard(d,s,'health'),s);
 }
});
test('retry navigation is bounded while subject and Space keys remain distinct',()=>{
 const d=storyboards.update;
 let s=newStoryboard(d);
 for(let i=0;i<200;i++)s=moveStoryboard(d,s,s.step==='checking'?'current':'checking');
 assert.ok(s.trail.length<=64);
 assert.notEqual(storyboardKey('intelligence','lia','studio',''),storyboardKey('intelligence','other','studio',''));
 assert.notEqual(storyboardKey('intelligence','lia','studio',''),storyboardKey('intelligence','lia','personal',''));
});


test('account recovery links use only explicitly allowed screen transitions',()=>{
 const definition=storyboards.identity;
 const initial=newStoryboard(definition);
 const recovery=moveStoryboard(definition,initial,'recover');
 assert.equal(recovery.step,'recover');
 assert.equal(previousStoryboard(recovery).step,'sign-in');
 assert.equal(moveStoryboard(definition,initial,'other'),initial);
 assert.equal(moveStoryboard(definition,initial,'logout'),initial);
 assert.equal(moveStoryboard(definition,initial,'overview').step,'overview');
});
test('setup retains offline continuation and network failure retry without skipping steps',()=>{
 const definition=storyboards.setup;
 let state={...newStoryboard(definition),step:'network'};
 assert.equal(moveStoryboard(definition,state,'security').step,'security');
 state=moveStoryboard(definition,state,'network-connecting');
 state=moveStoryboard(definition,state,'network-error');
 assert.equal(moveStoryboard(definition,state,'network').step,'network');
 assert.equal(moveStoryboard(definition,state,'security').step,'security');
 assert.equal(moveStoryboard(definition,state,'complete'),state);
});


test('settings apply remains confirmed and returning to review invalidates approval',()=>{
 const definition=storyboards.settings;
 let state={...newStoryboard(definition,'network'),step:'pending',fields:{network:'offline'}};
 assert.equal(moveStoryboard(definition,state,'complete'),state);
 state={...state,fields:{...state.fields,'confirm:pending':true}};
 const applied=moveStoryboard(definition,state,'complete');
 assert.equal(applied.step,'complete');
 const review=previousStoryboard(applied);
 assert.equal(review.fields['confirm:pending'],false);
 assert.equal(moveStoryboard(definition,review,'complete'),review);
 assert.equal(moveStoryboard(definition,applied,'undo').step,'undo');
});
