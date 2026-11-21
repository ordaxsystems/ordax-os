'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {watchHostAfterReady}=require('./host.cjs');
function child(){
  const c=new EventEmitter();
  c.exitCode=null;
  c.signalCode=null;
  return c;
}
function watch(c,options={}){
  const events=[];
  const state={current:c,stopping:false,...options};
  const disarm=watchHostAfterReady(c,{
    isCurrent:active=>active===state.current,
    isStopping:()=>state.stopping,
    onUnexpectedExit:reason=>events.push(reason),
  });
  return {events,state,disarm};
}
test('Native host crash after ready is reported exactly once',()=>{
  const c=child(),m=watch(c);
  c.exitCode=1;
  c.emit('exit',1,null);
  c.emit('exit',1,null);
  assert.deepEqual(m.events,[{code:1,signal:null}]);
  m.disarm();
});
test('native host signal termination is recognized without fabricating an exit code',()=>{
  const c=child(),m=watch(c);
  c.signalCode='SIGTERM';
  c.emit('exit',null,'SIGTERM');
  assert.deepEqual(m.events,[{code:null,signal:'SIGTERM'}]);
  m.disarm();
});
test('deliberate application shutdown cannot trigger relaunch callback',()=>{
  const c=child(),m=watch(c);
  m.state.stopping=true;
  c.exitCode=0;
  c.emit('exit',0,null);
  assert.deepEqual(m.events,[]);
  m.disarm();
});
test('replaced or rollback host cannot recover a stale Native child',()=>{
  const c=child(),m=watch(c);
  m.state.current=child();
  c.exitCode=1;
  c.emit('exit',1,null);
  assert.deepEqual(m.events,[]);
  m.disarm();
});
test('removed watcher is inert even when the OS process exits afterward',()=>{
  const c=child(),m=watch(c);
  m.disarm();
  c.exitCode=1;
  c.emit('exit',1,null);
  assert.deepEqual(m.events,[]);
  assert.equal(c.listenerCount('exit'),0);
});
test('host which exited between HTTP-ready and registration is still detected',async()=>{
  const c=child();
  c.exitCode=1;
  const m=watch(c);
  assert.deepEqual(m.events,[]);
  await Promise.resolve();
  assert.deepEqual(m.events,[{code:1,signal:null}]);
  m.disarm();
});
test('late exit check does not duplicate an already emitted exit',async()=>{
  const c=child(),m=watch(c);
  c.exitCode=42;
  c.emit('exit',42,null);
  await Promise.resolve();
  assert.deepEqual(m.events,[{code:42,signal:null}]);
  m.disarm();
});
test('watcher rejects missing child or unguarded callback',()=>{
  const c=child();
  assert.throws(()=>watchHostAfterReady(null,{}),/requires/);
  assert.throws(()=>watchHostAfterReady(c,{isCurrent:()=>true}),/requires/);
});
const {canAutoRelaunchHost}=require('./host.cjs');
test('packaged Desktop without Product identity may perform one Native recovery',()=>{
  assert.equal(canAutoRelaunchHost({
    packaged:true,alreadyRetried:false,productIdentityPresent:false,
  }),true);
});
test('second crash cannot cause an Electron relaunch loop',()=>{
  assert.equal(canAutoRelaunchHost({
    packaged:true,alreadyRetried:true,productIdentityPresent:false,
  }),false);
});
test('possible orphaned Product Runtime prevents duplicate agent startup',()=>{
  assert.equal(canAutoRelaunchHost({
    packaged:true,alreadyRetried:false,productIdentityPresent:true,
  }),false);
});
test('development Electron never automatically relaunches',()=>{
  assert.equal(canAutoRelaunchHost({
    packaged:false,alreadyRetried:false,productIdentityPresent:false,
  }),false);
});