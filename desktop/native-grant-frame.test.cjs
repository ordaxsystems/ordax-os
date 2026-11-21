'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isTrustedNativeRequest,isNativeStateRoute}=require('./native-grant-frame.cjs');
const allowedOrigin='http://127.0.0.1:43210';
const doc=allowedOrigin+'/system/composition/native/index.html';
function fixture(overrides={}){
  const mainFrame={url:doc};
  return {details:{
    webContentsId:7,frame:mainFrame,url:allowedOrigin+'/__ordax/native/session',
  },contentsId:7,mainFrame,activeUrl:doc,allowedOrigin,...overrides};
}
test('canonical main frame may request Native session on its own listener',()=>{
  assert.equal(isTrustedNativeRequest(fixture()),true);
});
test('trusted main frame may request Product Surface state and receipt',()=>{
  for(const route of ['desktop-surface-state','desktop-surface-command','desktop-surface-receipt']){
    const f=fixture();f.details.url=allowedOrigin+'/__ordax/native/'+route;
    assert.equal(isTrustedNativeRequest(f),true,route);
  }
});
test('cross-origin iframe in the same WebContents never receives Native grant',()=>{
  const f=fixture();f.details.frame={url:'https://external.invalid/embed'};
  assert.equal(isTrustedNativeRequest(f),false);
});
test('same-origin iframe is not the owner main frame',()=>{
  const f=fixture();f.details.frame={url:doc};
  assert.equal(isTrustedNativeRequest(f),false);
});
test('browser tabs cannot inherit the main Surface principal',()=>{
  const f=fixture();f.details.webContentsId=8;
  assert.equal(isTrustedNativeRequest(f),false);
});
test('external target is not authorized even from the trusted frame',()=>{
  const f=fixture();f.details.url='https://external.invalid/__ordax/native/session';
  assert.equal(isTrustedNativeRequest(f),false);
});
test('other loopback port is a different owner',()=>{
  const f=fixture();f.details.url='http://127.0.0.1:43211/__ordax/native/session';
  assert.equal(isTrustedNativeRequest(f),false);
});
test('redirected or error-page main WebContents loses all Native grants',()=>{
  const f=fixture();f.activeUrl='data:text/html,unavailable';
  assert.equal(isTrustedNativeRequest(f),false);
  f.activeUrl='https://external.invalid';
  assert.equal(isTrustedNativeRequest(f),false);
});
test('requesting main frame must still have approved origin',()=>{
  const f=fixture();f.mainFrame.url='https://external.invalid';
  assert.equal(isTrustedNativeRequest(f),false);
});
test('inaccessible or destroyed frame cannot receive a grant',()=>{
  for(const missing of [null,undefined]){
    const f=fixture();f.details.frame=missing;
    assert.equal(isTrustedNativeRequest(f),false);
  }
});
test('malformed URL or missing details fails closed',()=>{
  const f=fixture();f.details.url='not a URL';
  assert.equal(isTrustedNativeRequest(f),false);
  assert.equal(isTrustedNativeRequest(fixture({details:null})),false);
});
test('valid route remains allowed with query string',()=>{
  const f=fixture();f.details.url=allowedOrigin+'/__ordax/native/files?path=%2F';
  assert.equal(isTrustedNativeRequest(f),true);
});
test('canonical Native sync persistence uses only the trusted Electron state grant',()=>{
  for(const path of [
    '/__ordax/native/first-run',
    '/__ordax/native/preferences',
    '/__ordax/native/first-run-cursor',
    '/__ordax/native/sync-checkpoint',
    '/__ordax/native/sync-state',
  ]){
    assert.equal(isNativeStateRoute(path),true,path);
    const f=fixture();f.details.url=allowedOrigin+path;
    assert.equal(isTrustedNativeRequest(f),true,path);
    f.details.frame={url:doc};
    assert.equal(isTrustedNativeRequest(f),false,path+' iframe');
  }
  for(const path of [
    '/__ordax/native/sync-checkpoint/other',
    '/__ordax/native/sync-state-other',
    '/__ordax/native/session',
    '/__ordax/native/files',
    'https://attacker.invalid/__ordax/native/sync-state',
    '',
    null,
  ])assert.equal(isNativeStateRoute(path),false,String(path));
});
