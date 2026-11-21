'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createDesktopBrowserHost,safeWebUrl,safeDownloadName,viewportBounds}=require('./browser-host.cjs');

class WC extends EventEmitter {
  constructor(){super();this.url='';this.title='Page';this.navigationHistory={canGoBack:()=>false,canGoForward:()=>false};this.session=null;}
  setWindowOpenHandler(fn){this.popupHandler=fn;}
  getURL(){return this.url;}
  getTitle(){return this.title;}
  isLoadingMainFrame(){return Boolean(this.loading);}
  isCurrentlyAudible(){return Boolean(this.audible);}
  isDestroyed(){return false;}
  async loadURL(url){this.url=url;this.emit('did-navigate');}
  reload(){}
  close(){this.closed=true;}
  async executeJavaScript(){return 'selected web text';}
  findInPage(){this.emit('found-in-page',{}, {matches:1});}
  stopFindInPage(){}
}
class View {
  constructor(options){this.options=options;this.webContents=new WC();this.boundsCalls=0;this.visibleCalls=0;View.all.push(this);}
  setBounds(value){this.bounds=value;this.boundsCalls++;}
  setVisible(value){this.visible=value;this.visibleCalls++;}
}
View.all=[];
function fixture(){
  View.all=[];
  const ui=new EventEmitter();
  ui.sent=[];
  ui.send=(key,value)=>ui.sent.push({key,value});
  ui.isDestroyed=()=>false;
  ui.url='http://127.0.0.1:43123/system/composition/native/index.html';
  ui.getURL=()=>ui.url;
  ui.mainFrame={};
  const window=new EventEmitter();
  window.webContents=ui;
  window.isDestroyed=()=>false;
  window.getContentBounds=()=>({width:1000,height:700});
  window.contentView={views:[],addChildView(v){this.views.push(v);},removeChildView(v){this.views=this.views.filter(x=>x!==v);}};
  const ipcMain=new EventEmitter();
  const browserSession=new EventEmitter();
  browserSession.setPermissionRequestHandler=(fn)=>{browserSession.permission=fn;};
  browserSession.setPermissionCheckHandler=(fn)=>{browserSession.check=fn;};
  const session={fromPartition(name){assert.equal(name,'persist:ordax-desktop-internet');return browserSession;}};
  const dialog={showSaveDialog:async()=>({canceled:true})};
  const host=createDesktopBrowserHost({window,ipcMain,WebContentsView:View,session,dialog});
  host.setTrustedOrigin('http://127.0.0.1:43123');
  const post=payload=>ipcMain.emit('ordax:desktop-browser:command',
    {sender:ui,senderFrame:ui.mainFrame},JSON.stringify(payload));
  return {window,ui,host,post,browserSession,ipcMain,dialog};
}

test('explicit browser teardown releases the owning window listener and session IPC',()=>{
  const f=fixture();
  assert.equal(f.window.listenerCount('closed'),1);
  assert.equal(f.window.listenerCount('resize'),1);
  assert.equal(f.ipcMain.listenerCount('ordax:desktop-browser:command'),1);
  f.host.dispose();
  assert.equal(f.window.listenerCount('closed'),0,
    'failed Native startup must not retain a disposed browser through the live window');
  assert.equal(f.window.listenerCount('resize'),0);
  assert.equal(f.ipcMain.listenerCount('ordax:desktop-browser:command'),0);
  assert.equal(f.browserSession.listenerCount('will-download'),0);
  f.host.dispose(); // A duplicate teardown cannot remove another owner's listeners.
});

test('Browser URL validation rejects privileged schemes, credentials and oversized data',()=>{
  assert.equal(safeWebUrl('https://example.com/x'),'https://example.com/x');
  assert.equal(safeWebUrl('http://example.org/'),'http://example.org/');
  assert.equal(safeWebUrl('javascript:alert(1)'),null);
  assert.equal(safeWebUrl('file:///C:/secret'),null);
  assert.equal(safeWebUrl('https://bob:pass@example.com'),null);
  assert.equal(safeWebUrl('',{blank:true}),'about:blank');
  assert.equal(safeDownloadName('..\\..\\test<script>.pdf'),'test_script_.pdf');
  assert.equal(safeDownloadName('CON.txt'),'download-CON.txt');
  assert.equal(safeDownloadName('nul.tar.gz'),'download-nul.tar.gz');
  assert.equal(safeDownloadName('AUX.pdf'),'download-AUX.pdf');
  assert.equal(safeDownloadName('Com9.log'),'download-Com9.log');
  assert.equal(safeDownloadName('lPt1'),'download-lPt1');
  assert.equal(safeDownloadName('CON .txt'),'download-CON .txt');
  assert.equal(safeDownloadName('report.txt...  '),'report.txt');
  assert.equal(safeDownloadName('report .pdf'),'report .pdf');
  assert.equal(safeDownloadName('....'),'download');
  assert.equal(safeDownloadName('design-final.pdf'),'design-final.pdf');
});

test('failed Chromium view attachment never orphans a tab and later opens recover',async t=>{
  for(const partiallyAttached of [false,true]){
    const f=fixture();t.after(()=>f.host.dispose());
    f.post({type:'tab.open',tabId:'existing',url:'https://example.com/existing'});
    await Promise.resolve();
    const before=f.host.getSnapshot();
    const add=f.window.contentView.addChildView;
    f.window.contentView.addChildView=function(view){
      if(partiallyAttached)this.views.push(view);
      throw Error('Windows Chromium view could not attach');
    };
    assert.doesNotThrow(()=>f.post({
      type:'tab.open',tabId:'failed',url:'https://example.com/failed',
    }), 'a failed native view attachment must not escape into Native IPC');
    assert.deepEqual(f.host.getSnapshot(),before,
      'a failed tab must not change the active tab or registered tabs');
    assert.deepEqual(f.window.contentView.views,[View.all[0]],
      'a partially attached Chromium view must be removed');
    assert.equal(View.all[1].webContents.closed,true,
      'the failed WebContents must be closed, not leaked');
    assert.equal(f.host.hasActiveWork(),false,
      'an aborted tab creation cannot hold the updater gate');
    f.window.contentView.addChildView=add;
    f.post({type:'tab.open',tabId:'recovered',url:'https://example.com/recovered'});
    await Promise.resolve();
    assert.deepEqual(f.host.getSnapshot().tabs.map(tab=>tab.id),['existing','recovered']);
    assert.equal(f.window.contentView.views.length,2,
      'a subsequent valid tab still attaches to the canonical container');
  }
});

test('failed Chromium window-open hook closes its unregistered WebContents',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  const hook=WC.prototype.setWindowOpenHandler;
  WC.prototype.setWindowOpenHandler=()=>{throw Error('Chromium popup policy unavailable');};
  t.after(()=>{WC.prototype.setWindowOpenHandler=hook;});
  assert.doesNotThrow(()=>f.post({
    type:'tab.open',tabId:'failed-hook',url:'https://example.com',
  }));
  assert.deepEqual(f.host.getSnapshot().tabs,[]);
  assert.equal(f.window.contentView.views.length,0);
  assert.equal(View.all[0].webContents.closed,true);
  WC.prototype.setWindowOpenHandler=hook;
  f.post({type:'tab.open',tabId:'working',url:'https://example.com'});
  await Promise.resolve();
  assert.equal(f.host.getSnapshot().tabs.length,1);
});

test('synchronous Chromium navigation failure cannot orphan a tab or break later browsing',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  const load=WC.prototype.loadURL;
  WC.prototype.loadURL=function(url){
    if(url.endsWith('/crash'))throw Error('Chromium rejected synchronous navigation');
    return load.call(this,url);
  };
  t.after(()=>{WC.prototype.loadURL=load;});
  f.post({type:'tab.open',tabId:'tab-good',url:'https://example.com/good'});
  await Promise.resolve();
  assert.doesNotThrow(()=>f.post({
    type:'tab.open',tabId:'tab-failed',url:'https://example.com/crash',
  }));
  assert.deepEqual(f.host.getSnapshot().tabs.map(tab=>tab.id),['tab-good'],
    'the failed tab must leave no registered Chromium view or active tab');
  assert.equal(f.host.getSnapshot().activeTabId,'tab-good');
  assert.equal(f.window.contentView.views.length,1);
  assert.equal(View.all[1].webContents.closed,true,
    'a failed tab must close its Chromium WebContents rather than leak it');
  assert.doesNotThrow(()=>f.post({
    type:'tab.navigate',tabId:'tab-good',url:'https://example.com/crash',
  }));
  assert.equal(f.host.getSnapshot().tabs[0].url,'https://example.com/good',
    'failed navigation preserves the usable existing tab');
  f.post({type:'tab.navigate',tabId:'tab-good',url:'https://example.com/recovered'});
  await Promise.resolve();
  assert.equal(f.host.getSnapshot().tabs[0].url,'https://example.com/recovered');
});

test('Native Internet session uses isolated Chromium views, actual tabs, and rejects unsafe navigation',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'snapshot.request'});
  assert.equal(f.ui.sent.at(-1).value.snapshot.supported,true);
  assert.deepEqual(f.ui.sent.at(-1).value.snapshot.tabs,[]);
  f.post({type:'tab.open',tabId:'tab-1',url:'https://example.com/'});
  await Promise.resolve();
  assert.equal(f.host.getSnapshot().tabs.length,1);
  assert.equal(f.host.getSnapshot().activeTabId,'tab-1');
  assert.equal(View.all[0].options.webPreferences.sandbox,true);
  assert.equal(View.all[0].options.webPreferences.nodeIntegration,false);
  assert.equal(View.all[0].webContents.popupHandler().action,'deny');
  f.post({type:'viewport.set',viewport:{visible:true,x:24,y:50,width:800,height:450}});
  assert.deepEqual(View.all[0].bounds,{x:24,y:50,width:800,height:450});
  f.post({type:'tab.navigate',tabId:'tab-1',url:'file:///C:/secret.txt'});
  assert.equal(View.all[0].webContents.url,'https://example.com/');
  f.post({type:'tab.navigate',tabId:'tab-1',url:'https://openai.com/'});
  await Promise.resolve();
  assert.equal(View.all[0].webContents.url,'https://openai.com/');
  f.post({type:'tab.close',tabId:'tab-1'});
  assert.equal(f.host.getSnapshot().tabs.length,0);
  assert.equal(View.all[0].webContents.closed,true);
});

test('ordax-pull never interrupts Native browser downloads, audio or navigation',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  assert.equal(f.host.hasActiveWork(),false);
  f.post({type:'tab.open',tabId:'tab-work',url:'https://example.com'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  assert.equal(f.host.hasActiveWork(),false);
  wc.audible=true;
  assert.equal(f.host.hasActiveWork(),true,'audio playback does not generate mouse idle activity');
  wc.audible=false;
  wc.loading=true;
  assert.equal(f.host.hasActiveWork(),true,'in-progress page load must not be discarded');
  wc.loading=false;
  const item=new EventEmitter();
  item.getFilename=()=> 'download.bin';
  item.pause=()=>{};
  item.cancel=()=>{};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected rejected download')}},item,wc);
  assert.equal(f.host.hasActiveWork(),true,'pending save dialog or transfer prevents relaunch');
  item.emit('done',{},'completed');
  assert.equal(f.host.hasActiveWork(),false,'completed download releases update gate');
  wc.isCurrentlyAudible=()=>{throw Error('Chromium renderer unavailable')};
  assert.equal(f.host.hasActiveWork(),true,'failed media inspection must delay update');
});

test('malformed and cross-window commands cannot acquire browser privileges',t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.ipcMain.emit('ordax:desktop-browser:command',{sender:{}},JSON.stringify({type:'tab.open',tabId:'evil',url:'https://example.com'}));
  f.post({type:null,tabId:'bad'});
  f.post({type:'tab.open',tabId:'../../unsafe',url:'https://example.com'});
  f.post({type:'tab.open',tabId:'x',url:'javascript:alert(1)'});
  f.post({type:'tab.open',tabId:'x',url:'file:///etc/passwd'});
  assert.deepEqual(f.host.getSnapshot().tabs,[]);
  assert.equal(f.browserSession.check(),false);
  let allowed;f.browserSession.permission(null,'camera',v=>{allowed=v;});
  assert.equal(allowed,false);
});

test('Internet bridge requires current Native origin and main frame across rollback',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  const post=raw=>f.ipcMain.emit('ordax:desktop-browser:command',
    {sender:f.ui,senderFrame:f.ui.mainFrame},JSON.stringify(raw));
  f.ui.url='data:text/html,starting';
  post({type:'tab.open',tabId:'splash',url:'https://example.com/'});
  assert.equal(f.host.getSnapshot().tabs.length,0,'splash cannot control browser tabs');
  f.ui.url='https://attacker.example/';
  post({type:'tab.open',tabId:'foreign',url:'https://example.com/'});
  assert.equal(f.host.getSnapshot().tabs.length,0,'reused WebContents on a foreign origin has no bridge');
  f.ui.url='http://127.0.0.1:43123/system/composition/native/index.html';
  f.ipcMain.emit('ordax:desktop-browser:command',
    {sender:f.ui,senderFrame:{}},JSON.stringify({type:'tab.open',tabId:'iframe',url:'https://example.com/'}));
  assert.equal(f.host.getSnapshot().tabs.length,0,'only the actual Native main frame owns commands');
  post({type:'tab.open',tabId:'trusted',url:'https://example.com/'});
  assert.equal(f.host.getSnapshot().tabs.length,1);
  f.ui.sent.length=0;
  f.ui.url='https://attacker.example/';
  f.post({type:'snapshot.request'});
  assert.equal(f.ui.sent.length,0,'untrusted document cannot obtain existing tab URLs');
  // Notifications generated by Chromium must also not leak to a foreign page.
  View.all[0].webContents.emit('page-title-updated');
  assert.equal(f.ui.sent.length,0,'snapshots do not leak across origin changes');
  f.host.setTrustedOrigin(null);
  f.ui.url='http://127.0.0.1:43123/system/composition/native/index.html';
  post({type:'tab.open',tabId:'revoked',url:'https://example.com/'});
  assert.equal(f.host.getSnapshot().tabs.length,0,'rollback closes tabs from revoked Native session');
  assert.equal(View.all[0].webContents.closed,true,'revoked Native session must close old Chromium WebContents');
  f.host.setTrustedOrigin('http://127.0.0.1:43210');
  post({type:'tab.open',tabId:'stale',url:'https://example.com/'});
  assert.equal(f.host.getSnapshot().tabs.length,0,'old Native port stays rejected');
  f.ui.url='http://127.0.0.1:43210/system/composition/native/index.html?source=test';
  post({type:'tab.open',tabId:'rebound',url:'https://example.com/'});
  assert.equal(f.host.getSnapshot().tabs.length,1,'new Native port gets a fresh browser session');
  f.host.setTrustedOrigin('http://127.0.0.1:43210');
  assert.equal(f.host.getSnapshot().tabs.length,1,'reaffirming the same origin preserves its tabs');
  assert.throws(()=>f.host.setTrustedOrigin('https://attacker.example'),/loopback host origin/);
  assert.throws(()=>f.host.setTrustedOrigin('http://127.0.0.1:43210/evil'),/loopback host origin/);
  assert.throws(()=>f.host.setTrustedOrigin('http://user:pass@127.0.0.1:43210/'),/loopback host origin/);
});

test('Native rollback revokes pending save consent and prevents stale dialogs from writing files',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-old',url:'https://example.com'});
  await Promise.resolve();
  const item=new EventEmitter();
  let cancels=0, saved=0, resumed=0, resolveDialog;
  item.getFilename=()=> 'private.txt';
  item.pause=()=>{};
  item.cancel=()=>{cancels++;};
  item.setSavePath=()=>{saved++;};
  item.resume=()=>{resumed++;};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected reject');}},
    item,View.all[0].webContents);
  const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
  f.dialog.showSaveDialog=()=>new Promise(resolve=>{resolveDialog=resolve;});
  f.post({type:'download.approve',id:pending.id});
  f.host.setTrustedOrigin(null);
  assert.equal(cancels,1,'revoking Native ownership cancels the outstanding consent');
  assert.equal(f.host.getSnapshot().tabs.length,0);
  resolveDialog({canceled:false,filePath:'C:\\Users\\Dev\\private.txt'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(saved,0,'late approval from the old Native origin cannot write a file');
  assert.equal(resumed,0,'late approval from the old Native origin cannot resume a transfer');
});

test('Native rollback keeps failed transfer cancellation gated without leaking to the replacement session',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-old',url:'https://example.com'});
  await Promise.resolve();
  const item=new EventEmitter();
  let cancelled=0;
  item.getFilename=()=> 'confidential.txt';
  item.pause=()=>{};
  item.setSavePath=()=>{};
  item.resume=()=>{};
  item.cancel=()=>{cancelled++;throw Error('Chromium cannot cancel running transfer');};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected reject');}},
    item,View.all[0].webContents);
  const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
  f.dialog.showSaveDialog=async()=>({canceled:false,filePath:'C:\\Users\\Dev\\confidential.txt'});
  f.post({type:'download.approve',id:pending.id});
  await new Promise(resolve=>setImmediate(resolve));
  f.host.setTrustedOrigin(null);
  assert.equal(cancelled,1);
  assert.equal(f.host.getSnapshot().tabs.length,0);
  assert.equal(f.host.hasActiveWork(),true,
    'failed Chromium cancel must not allow an unsafe Desktop update');
  f.host.setTrustedOrigin('http://127.0.0.1:43210');
  f.ui.url='http://127.0.0.1:43210/system/composition/native/index.html';
  f.post({type:'tab.open',tabId:'tab-new',url:'https://openai.com'});
  await Promise.resolve();
  assert.deepEqual(f.host.getSnapshot().tabs.map(tab=>tab.id),['tab-new']);
  f.ui.sent.length=0;
  item.emit('done',{},'completed');
  assert.equal(f.host.hasActiveWork(),false,
    'a real terminal Chromium event releases the update gate');
  assert.equal(f.ui.sent.some(x=>x.value.type==='browser-download'),false,
    'a completion event from the revoked origin cannot leak its filename to new Native');
});

test('download IPC rejects oversized and foreign-window requests before save dialog',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-download',url:'https://example.com/'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  let cancelled=false, dialogs=0;
  const item=new EventEmitter();
  item.getFilename=()=> 'safe-file.txt';
  item.pause=()=>{};
  item.cancel=()=>{cancelled=true;};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected reject');}},item,wc);
  const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
  assert.match(pending.id,/^download-[0-9a-f]{16}$/);
  f.dialog.showSaveDialog=async()=>{dialogs++;return {canceled:true};};
  f.ipcMain.emit('ordax:desktop-browser:command',{sender:f.ui,senderFrame:f.ui.mainFrame},
    JSON.stringify({type:'download.approve',id:pending.id,padding:'x'.repeat(12000)}));
  assert.equal(dialogs,0,'oversized payload must not invoke the privileged save dialog');
  f.ipcMain.emit('ordax:desktop-browser:command',{sender:{}},
    JSON.stringify({type:'download.cancel',id:pending.id}));
  assert.equal(cancelled,false,'another WebContents cannot cancel a download');
  f.post({type:'download.approve',id:pending.id});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dialogs,1,'bounded request retains the intended save flow');
  assert.equal(cancelled,true,'canceling the save dialog cancels the download');
});

test('synchronous Windows save-dialog failure cannot leak into IPC or strand a download',async t=>{
  for(const failsCancellation of [false,true]){
    const f=fixture();t.after(()=>f.host.dispose());
    f.post({type:'tab.open',tabId:'tab-dialog',url:'https://example.com/file'});
    await Promise.resolve();
    const wc=View.all[0].webContents;
    let cancels=0, saved=0, resumed=0;
    const item=new EventEmitter();
    item.getFilename=()=> 'file.txt';
    item.pause=()=>{};
    item.setSavePath=()=>{saved++;};
    item.resume=()=>{resumed++;};
    item.cancel=()=>{
      cancels++;
      if(failsCancellation)throw Error('Chromium transfer cancellation refused');
    };
    f.browserSession.emit('will-download',{
      preventDefault(){throw Error('unexpected rejection');},
    },item,wc);
    const pending=f.ui.sent.map(x=>x.value).find(x=>
      x.type==='browser-download'&&x.status==='pending');
    assert.ok(pending);
    f.dialog.showSaveDialog=()=>{throw Error('Windows dialog unavailable');};
    assert.doesNotThrow(()=>f.post({type:'download.approve',id:pending.id}),
      'the privileged native dialog error must never escape into the renderer IPC');
    assert.equal(cancels,1,'a synchronous failure revokes the pending download consent');
    assert.equal(saved,0,'failed dialog cannot assign a save destination');
    assert.equal(resumed,0,'failed dialog cannot resume a transfer');
    assert.equal(f.host.hasActiveWork(),failsCancellation,
      'only an unconfirmed Chromium cancellation must retain the update gate');
    f.post({type:'download.approve',id:pending.id});
    assert.equal(cancels,1,'a rejected dialog must not be reopened for the same download');
    if(failsCancellation){
      item.emit('done',{},'cancelled');
      assert.equal(f.host.hasActiveWork(),false,
        'confirmed terminal Chromium event releases the previously blocked update');
    }
  }
});

test('download consent is single-use and cancelled pending approval never writes a file',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-download',url:'https://example.com'});
  await Promise.resolve();
  let resolveSave, dialogs=0, cancellations=0, resumed=0;
  const paths=[];
  const item=new EventEmitter();
  item.getFilename=()=> 'private.txt';
  item.pause=()=>{};
  item.cancel=()=>{cancellations++;};
  item.setSavePath=p=>paths.push(p);
  item.resume=()=>{resumed++;};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected reject');}},
    item,View.all[0].webContents);
  const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
  f.dialog.showSaveDialog=()=>{
    dialogs++;
    return new Promise(resolve=>{resolveSave=resolve;});
  };
  f.post({type:'download.approve',id:pending.id});
  f.post({type:'download.approve',id:pending.id});
  assert.equal(dialogs,1,'concurrent approvals must not create multiple native dialogs');
  f.post({type:'download.cancel',id:pending.id});
  f.post({type:'download.cancel',id:pending.id});
  resolveSave({canceled:false,filePath:'C:\\Users\\Dev\\private.txt'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancellations,1,'only the first cancel is applied');
  assert.deepEqual(paths,[],'late native approval must not write after cancellation');
  assert.equal(resumed,0,'cancelled transfer must never resume');
});

test('late save dialogs cannot resume downloads after browser disposal or completion',async()=>{
  for(const terminal of ['disposed','completed']){
    const f=fixture();
    f.post({type:'tab.open',tabId:'tab-file',url:'https://example.com'});
    await Promise.resolve();
    const item=new EventEmitter();
    let cancellations=0, resumed=0, saved=0, resolveSave;
    item.getFilename=()=> 'file.txt';
    item.pause=()=>{};
    item.cancel=()=>{cancellations++;};
    item.setSavePath=()=>{saved++;};
    item.resume=()=>{resumed++;};
    f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected reject');}},
      item,View.all[0].webContents);
    const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
    f.dialog.showSaveDialog=()=>new Promise(resolve=>{resolveSave=resolve;});
    f.post({type:'download.approve',id:pending.id});
    if(terminal==='disposed') f.host.dispose();
    else item.emit('done',{},'cancelled');
    resolveSave({canceled:false,filePath:'C:\\Users\\Dev\\file.txt'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(saved,0,terminal+' pending approval never sets a save path');
    assert.equal(resumed,0,terminal+' pending approval never resumes a transfer');
    assert.equal(cancellations,terminal==='disposed'?1:0);
    f.host.dispose();
  }
});

test('single valid download approval still saves and starts the transfer',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-valid',url:'https://example.com'});
  await Promise.resolve();
  const item=new EventEmitter();
  let savePath=null, resumed=0, dialogs=0;
  item.getFilename=()=> 'file.txt';
  item.pause=()=>{};
  item.cancel=()=>{};
  item.setSavePath=path=>{savePath=path;};
  item.resume=()=>{resumed++;};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected reject');}},
    item,View.all[0].webContents);
  const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
  f.dialog.showSaveDialog=async()=>{
    dialogs++;
    return {canceled:false,filePath:'C:\\Users\\Dev\\file.txt'};
  };
  f.post({type:'download.approve',id:pending.id});
  await new Promise(resolve=>setImmediate(resolve));
  f.post({type:'download.approve',id:pending.id});
  assert.equal(dialogs,1);
  assert.equal(savePath,'C:\\Users\\Dev\\file.txt');
  assert.equal(resumed,1);
  assert.ok(f.ui.sent.some(x=>x.value.type==='browser-download'&&x.value.status==='downloading'));
});

test('untrusted page selection is only returned to OrdaX on explicit tab-scoped request',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-a',url:'https://example.com'});
  await Promise.resolve();
  f.post({type:'page-selection.capture',tabId:'tab-a',requestId:'selection-1'});
  await new Promise(resolve=>setImmediate(resolve));
  const event=f.ui.sent.map(x=>x.value).find(x=>x.type==='page-selection.result');
  assert.equal(event.selection.source,'untrusted-web-content');
  assert.equal(event.selection.text,'selected web text');
  assert.equal(event.selection.url,'https://example.com/');
});

test('synchronous Chromium selection failure returns an unavailable receipt without breaking IPC',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-failed-selection',url:'https://example.com'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  wc.executeJavaScript=()=>{throw Error('Chromium WebContents is no longer usable');};
  assert.doesNotThrow(()=>f.post({
    type:'page-selection.capture',tabId:'tab-failed-selection',requestId:'failed-selection',
  }));
  const failed=f.ui.sent.map(x=>x.value).find(x=>x.requestId==='failed-selection');
  assert.equal(failed?.error,'selection-unavailable',
    'the current page must receive the same failure receipt as an async rejection');
  wc.executeJavaScript=async()=> 'recovered selection';
  f.post({type:'page-selection.capture',tabId:'tab-failed-selection',requestId:'recovered'});
  await new Promise(resolve=>setImmediate(resolve));
  const recovered=f.ui.sent.map(x=>x.value).find(x=>x.requestId==='recovered');
  assert.equal(recovered?.selection?.text,'recovered selection',
    'a synchronous Chromium failure must not disable subsequent page operations');
});

test('synchronous Chromium find finish failure clears listeners without crashing Native IPC',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-find-failure',url:'https://example.com'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  let request=10;
  wc.findInPage=()=>++request;
  f.post({type:'page-find.search',tabId:'tab-find-failure',query:'first'});
  assert.equal(wc.listenerCount('found-in-page'),1);
  wc.stopFindInPage=()=>{throw Error('Chromium find controller is unavailable');};
  assert.doesNotThrow(()=>f.post({type:'page-find.finish',tabId:'tab-find-failure'}));
  assert.equal(wc.listenerCount('found-in-page'),0,
    'even if Chromium fails, Native no longer holds the stale listener');
  f.post({type:'page-find.search',tabId:'tab-find-failure',query:'new'});
  assert.equal(wc.listenerCount('found-in-page'),1,
    'a new page search still works after the failed finish');
  wc.emit('found-in-page',{}, {requestId:request,matches:2});
  assert.ok(f.ui.sent.some(x=>x.value.type==='page-find.result'&&x.value.count===2));
  assert.equal(wc.listenerCount('found-in-page'),0);
});

test('late page selection from a previous navigation cannot be attributed to the new document',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-selection',url:'https://old.example/'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  let resolveSelection;
  wc.executeJavaScript=()=>new Promise(resolve=>{resolveSelection=resolve;});
  f.post({type:'page-selection.capture',tabId:'tab-selection',requestId:'old-selection'});
  f.post({type:'tab.navigate',tabId:'tab-selection',url:'https://new.example/'});
  await Promise.resolve();
  resolveSelection('private text from previous document');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.ui.sent.some(x=>x.value.type==='page-selection.result'
    && x.value.requestId==='old-selection'),false,
    'previous document text must not reach the new page context');
  wc.executeJavaScript=async()=> 'current text';
  f.post({type:'page-selection.capture',tabId:'tab-selection',requestId:'current-selection'});
  await new Promise(resolve=>setImmediate(resolve));
  const fresh=f.ui.sent.map(x=>x.value).find(x=>x.requestId==='current-selection');
  assert.equal(fresh.selection.text,'current text');
  assert.equal(fresh.selection.url,'https://new.example/');
});

test('closing and reusing a tab ID cannot revive old pending selection',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-reuse',url:'https://old.example/'});
  await Promise.resolve();
  let complete;
  View.all[0].webContents.executeJavaScript=()=>new Promise(resolve=>{complete=resolve;});
  f.post({type:'page-selection.capture',tabId:'tab-reuse',requestId:'old-request'});
  f.post({type:'tab.close',tabId:'tab-reuse'});
  f.post({type:'tab.open',tabId:'tab-reuse',url:'https://new.example/'});
  await Promise.resolve();
  complete('old tab secret');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.ui.sent.some(x=>x.value.requestId==='old-request'),false);
  f.post({type:'page-selection.capture',tabId:'tab-reuse',requestId:'new-request'});
  await new Promise(resolve=>setImmediate(resolve));
  const current=f.ui.sent.map(x=>x.value).find(x=>x.requestId==='new-request');
  assert.equal(current.selection.text,'selected web text');
  assert.equal(current.selection.url,'https://new.example/');
});

test('page find accepts only current requestId and clears pending listeners at navigation',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-find',url:'https://old.example/'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  let nextId=40;
  const queries=[];
  wc.findInPage=q=>{queries.push(q);return ++nextId;};
  f.post({type:'page-find.search',tabId:'tab-find',query:'old private query'});
  assert.equal(wc.listenerCount('found-in-page'),1);
  wc.emit('found-in-page',{}, {requestId:40,matches:10});
  assert.equal(f.ui.sent.some(x=>x.value.type==='page-find.result'),false,
    'stale Chromium request ID is not a fresh find response');
  wc.emit('found-in-page',{}, {requestId:41,matches:3});
  assert.equal(f.ui.sent.filter(x=>x.value.type==='page-find.result').length,1);
  assert.equal(wc.listenerCount('found-in-page'),0);
  f.post({type:'page-find.search',tabId:'tab-find',query:'pending old query'});
  assert.equal(wc.listenerCount('found-in-page'),1);
  f.post({type:'tab.navigate',tabId:'tab-find',url:'https://new.example/'});
  await Promise.resolve();
  assert.equal(wc.listenerCount('found-in-page'),0,
    'navigation must remove the old page find listener');
  wc.emit('found-in-page',{}, {requestId:42,matches:20});
  assert.equal(f.ui.sent.filter(x=>x.value.type==='page-find.result').length,1);
  f.post({type:'page-find.next',tabId:'tab-find'});
  assert.equal(queries.length,2,
    'new document must not inherit the previous document search query');
  f.post({type:'page-find.search',tabId:'tab-find',query:'new query'});
  assert.equal(queries.at(-1),'new query');
  f.post({type:'page-find.finish',tabId:'tab-find'});
  assert.equal(wc.listenerCount('found-in-page'),0);
});

test('closing a tab and disposing the host clear outstanding find and selection work',async()=>{
  const f=fixture();
  f.post({type:'tab.open',tabId:'tab-clean',url:'https://old.example/'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  wc.findInPage=()=>77;
  f.post({type:'page-find.search',tabId:'tab-clean',query:'old'});
  assert.equal(wc.listenerCount('found-in-page'),1);
  f.post({type:'tab.close',tabId:'tab-clean'});
  assert.equal(wc.listenerCount('found-in-page'),0);
  f.post({type:'tab.open',tabId:'tab-clean',url:'https://new.example/'});
  await Promise.resolve();
  let resolveSelection;
  View.all[1].webContents.executeJavaScript=()=>new Promise(resolve=>{resolveSelection=resolve;});
  f.post({type:'page-selection.capture',tabId:'tab-clean',requestId:'disposed-request'});
  f.host.dispose();
  resolveSelection('no consent after disposal');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.ui.sent.some(x=>x.value.requestId==='disposed-request'),false);
});

test('Desktop bridge remains a preload-only port on canonical Native; no privileged browser shortcuts',()=>{
  const preload=readFileSync(join(__dirname,'browser-preload.cjs'),'utf8');
  const main=readFileSync(join(__dirname,'main.cjs'),'utf8');
  assert.ok(preload.includes("contextBridge.exposeInMainWorld('ordaxDesktopBrowser'"));
  assert.ok(main.includes("preload:join(__dirname,'browser-preload.cjs')"));
  assert.ok(main.includes('createDesktopBrowserHost'));
  assert.ok(main.includes('Native Internet browser bridge is unavailable'));
  assert.ok(!preload.includes('nodeIntegration:true'));
  assert.equal(viewportBounds({visible:true,x:10,y:0,width:2000,height:2000},{getContentBounds:()=>({width:900,height:700})}).width,890);
});

test('browser viewport restores its requested size after a temporary Windows or RDP shrink',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-rdp',url:'about:blank'});
  await Promise.resolve();
  const view=View.all[0];
  f.post({type:'viewport.set',viewport:{visible:true,x:24,y:50,width:800,height:450}});
  assert.deepEqual(view.bounds,{x:24,y:50,width:800,height:450});
  f.window.getContentBounds=()=>({width:480,height:350});
  f.window.emit('resize');
  assert.deepEqual(view.bounds,{x:24,y:50,width:456,height:300});
  f.window.getContentBounds=()=>({width:1000,height:700});
  f.window.emit('resize');
  assert.deepEqual(view.bounds,{x:24,y:50,width:800,height:450},
    'a temporary clamp must not overwrite the original viewport request');
  // RDP may reduce the content area smaller than the viewport origin.
  // The renderer can resend a still-valid full-size request at that moment.
  f.window.getContentBounds=()=>({width:10,height:10});
  f.window.emit('resize');
  assert.deepEqual(view.bounds,{x:0,y:0,width:0,height:0});
  f.post({type:'viewport.set',viewport:{visible:true,x:24,y:50,width:800,height:450}});
  assert.deepEqual(view.bounds,{x:0,y:0,width:0,height:0},
    'offscreen viewport remains visually hidden while the RDP window is tiny');
  f.window.getContentBounds=()=>({width:1000,height:700});
  f.window.emit('resize');
  assert.deepEqual(view.bounds,{x:24,y:50,width:800,height:450},
    'a valid request made during transient RDP shrink must recover on expansion');
  f.post({type:'viewport.set',viewport:{visible:false,x:24,y:50,width:800,height:450}});
  f.window.emit('resize');
  assert.deepEqual(view.bounds,{x:0,y:0,width:0,height:0},
    'an intentionally hidden browser must remain hidden after resize');
  // Malformed requests are not recoverable viewport intents.
  f.post({type:'viewport.set',viewport:{visible:true,x:-4,y:50,width:800,height:450}});
  f.window.emit('resize');
  assert.deepEqual(view.bounds,{x:0,y:0,width:0,height:0},
    'invalid viewport coordinates cannot be restored after resize');
});

test('Chromium layout does not repeat native calls for unchanged RDP size or tab visibility',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  for(let i=0;i<16;i++)f.post({type:'tab.open',tabId:'tab-'+i,url:'about:blank'});
  await Promise.resolve();
  const request={visible:true,x:24,y:50,width:800,height:450};
  f.post({type:'viewport.set',viewport:request});
  const calls=()=>View.all.reduce((total,v)=>total+v.boundsCalls+v.visibleCalls,0);
  const first=calls();
  for(let i=0;i<40;i++){
    f.window.emit('resize');
    f.post({type:'viewport.set',viewport:request});
  }
  assert.equal(calls(),first,
    'unchanged layout must not issue 2560 unnecessary Chromium native calls');
  const active=View.all[15],next=View.all[2];
  f.post({type:'tab.activate',tabId:'tab-15'});
  assert.equal(calls(),first,'reselecting active tab is a layout no-op');
  f.window.getContentBounds=()=>({width:480,height:350});
  f.window.emit('resize');
  assert.deepEqual(active.bounds,{x:24,y:50,width:456,height:300});
  assert.equal(calls(),first+1,'RDP clamp changes only active bounds');
  f.window.emit('resize');
  assert.equal(calls(),first+1,'repeat RDP resize cannot change Chromium layout');
  f.window.getContentBounds=()=>({width:1000,height:700});
  f.window.emit('resize');
  assert.equal(calls(),first+2,'restoring screen changes only active bounds');
  f.post({type:'tab.activate',tabId:'tab-2'});
  assert.deepEqual(active.bounds,{x:0,y:0,width:0,height:0});
  assert.equal(active.visible,false);
  assert.deepEqual(next.bounds,{x:24,y:50,width:800,height:450});
  assert.equal(next.visible,true);
  assert.equal(calls(),first+6,'activation changes only previous and next tabs');
  f.post({type:'viewport.set',viewport:{visible:false,x:24,y:50,width:800,height:450}});
  assert.equal(next.visible,false);
  assert.equal(calls(),first+8,'hiding the active tab clears bounds and visibility');
  f.post({type:'viewport.set',viewport:request});
  assert.equal(next.visible,true);
  assert.equal(calls(),first+10,'restoring the tab reapplies real bounds and visibility');
  f.post({type:'tab.close',tabId:'tab-2'});
  assert.equal(f.host.getSnapshot().tabs.length,15);
  assert.equal(View.all[15].visible,true,'closing active tab exposes the last remaining tab');
});

test('closing a tab releases only its unapproved downloads, even with an open save dialog',async()=>{
  for(const phase of ['pending','approving']){
    const f=fixture();
    f.post({type:'tab.open',tabId:'tab-pending',url:'https://example.com'});
    await Promise.resolve();
    const item=new EventEmitter();
    let cancelled=0, resumed=0, saved=0, resolveDialog;
    item.getFilename=()=> 'pending.txt';
    item.pause=()=>{};
    item.cancel=()=>{cancelled++;};
    item.setSavePath=()=>{saved++;};
    item.resume=()=>{resumed++;};
    f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected rejection');}},
      item,View.all[0].webContents);
    assert.equal(f.host.hasActiveWork(),true);
    const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
    if(phase==='approving'){
      f.dialog.showSaveDialog=()=>new Promise(resolve=>{resolveDialog=resolve;});
      f.post({type:'download.approve',id:pending.id});
    }
    f.post({type:'tab.close',tabId:'tab-pending'});
    assert.equal(cancelled,1,'tab closure cancels an unapproved transfer once');
    assert.equal(f.host.hasActiveWork(),false,'closed tab cannot block future idle updates');
    if(resolveDialog){
      resolveDialog({canceled:false,filePath:'C:\\Users\\Dev\\pending.txt'});
      await new Promise(resolve=>setImmediate(resolve));
    }
    f.post({type:'download.approve',id:pending.id});
    item.emit('done',{},'cancelled');
    assert.equal(saved,0,'late consent cannot write a closed tab download');
    assert.equal(resumed,0,'closed tab download never resumes');
    assert.equal(f.ui.sent.map(x=>x.value).filter(x=>
      x.type==='browser-download'&&x.id===pending.id&&x.status==='cancelled').length,1,
      'late done event cannot duplicate terminal result');
    f.host.dispose();
  }
});

test('approved downloads continue after closing their tab; explicit cancellation releases the gate',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-approved',url:'https://example.com'});
  await Promise.resolve();
  const item=new EventEmitter();
  let cancelled=0, resumed=0;
  item.getFilename=()=> 'approved.bin';
  item.pause=()=>{};
  item.cancel=()=>{cancelled++;};
  item.setSavePath=()=>{};
  item.resume=()=>{resumed++;};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected rejection');}},
    item,View.all[0].webContents);
  const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
  f.dialog.showSaveDialog=async()=>({canceled:false,filePath:'C:\\Users\\Dev\\approved.bin'});
  f.post({type:'download.approve',id:pending.id});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resumed,1);
  f.post({type:'tab.close',tabId:'tab-approved'});
  assert.equal(cancelled,0,'an approved transfer remains active after its tab closes');
  assert.equal(f.host.hasActiveWork(),true);
  f.post({type:'download.cancel',id:pending.id});
  assert.equal(cancelled,1);
  assert.equal(f.host.hasActiveWork(),false,'explicit cancel releases the update gate without waiting for done');
  item.emit('done',{},'cancelled');
  assert.equal(f.ui.sent.map(x=>x.value).filter(x=>
    x.type==='browser-download'&&x.id===pending.id&&x.status==='cancelled').length,1);
});

test('Chromium cancellation failure must retain the update gate until a terminal event',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-failed-cancel',url:'https://example.com'});
  await Promise.resolve();
  const item=new EventEmitter();
  let cancellations=0;
  item.getFilename=()=> 'unconfirmed.bin';
  item.pause=()=>{};
  item.cancel=()=>{cancellations++;throw Error('download still active');};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected rejection');}},
    item,View.all[0].webContents);
  const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
  f.post({type:'tab.close',tabId:'tab-failed-cancel'});
  assert.equal(cancellations,1);
  assert.equal(f.host.hasActiveWork(),true,
    'failed cancel must block relaunch rather than assume Chromium stopped');
  assert.equal(f.ui.sent.some(x=>x.value.id===pending.id&&x.value.status==='cancelled'),false,
    'no false cancellation receipt');
  item.emit('done',{},'cancelled');
  assert.equal(f.host.hasActiveWork(),false,'actual terminal signal releases gate');
  assert.equal(f.ui.sent.filter(x=>x.value.id===pending.id&&x.value.status==='cancelled').length,1);
});

test('muted media playback protects the Desktop updater until every player stops',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-muted',url:'https://example.com/'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  assert.equal(wc.isCurrentlyAudible(),false);
  assert.equal(f.host.hasActiveWork(),false);
  wc.emit('media-started-playing');
  assert.equal(f.host.hasActiveWork(),true,'muted video must block automatic relaunch');
  wc.emit('media-started-playing');
  wc.emit('media-paused');
  assert.equal(f.host.hasActiveWork(),true,'another active player still protects the tab');
  wc.emit('media-paused');
  assert.equal(f.host.hasActiveWork(),false,'all paused players release the update gate');
  wc.emit('media-started-playing');
  wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true});
  assert.equal(f.host.hasActiveWork(),true,'SPA route changes must preserve playback protection');
  wc.emit('did-start-navigation',{isMainFrame:false,isSameDocument:false});
  assert.equal(f.host.hasActiveWork(),true,'another frame cannot erase active media state');
  wc.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});
  assert.equal(f.host.hasActiveWork(),false,'new main document resets the previous media state');
  wc.emit('media-started-playing');
  f.post({type:'tab.close',tabId:'tab-muted'});
  assert.equal(f.host.hasActiveWork(),false,'closed tab does not block the next update');
});


test('Electron 40 page links and redirects use their event URL without weakening protocol guards',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-links',url:'https://example.com/'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  const attempt=(name,url,legacyUrl)=>{
    let prevented=0;
    const details={url,preventDefault(){prevented++;}};
    wc.emit(name,details,legacyUrl);
    return prevented;
  };
  for(const event of ['will-navigate','will-redirect']){
    assert.equal(attempt(event,'https://www.example.com/page'),0,
      event+' must allow modern HTTPS page navigation');
    assert.equal(attempt(event,'http://example.net/'),0,
      event+' must allow normal HTTP links');
    assert.equal(attempt(event,'https://user:secret@example.net/'),1,
      event+' must reject embedded credentials');
    assert.equal(attempt(event,'file:///C:/private/secret.txt'),1,
      event+' must reject local file access');
    assert.equal(attempt(event,'javascript:alert(1)'),1,
      event+' must reject page-supplied scripts');
    assert.equal(attempt(event,undefined),1,
      event+' must fail closed on missing navigation URL');
    assert.equal(attempt(event,'file:///C:/secret','https://safe.example/'),1,
      event+' must not use a legacy URL to override unsafe modern metadata');
    let rejected=0;
    wc.emit(event,{preventDefault(){rejected++;}},'https://legacy.example/');
    assert.equal(rejected,0,event+' must accept an older Electron event signature');
    wc.emit(event,{preventDefault(){rejected++;}},'file:///C:/secret.txt');
    assert.equal(rejected,1,event+' must reject unsafe old-style events');
  }
});

test('target=_blank links open sandboxed tabs without creating privileged windows',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-origin',url:'https://example.com/'});
  await Promise.resolve();
  const parent=View.all[0];
  const popup=parent.webContents.popupHandler;
  assert.equal(popup({url:'https://docs.example.com/article',disposition:'new-window'}).action,'deny');
  await Promise.resolve();
  assert.equal(f.host.getSnapshot().tabs.length,2);
  assert.equal(f.host.getSnapshot().activeTabId,f.host.getSnapshot().tabs[1].id,
    'foreground link activates its new OrdaX tab');
  const child=View.all[1];
  assert.equal(child.webContents.url,'https://docs.example.com/article');
  assert.equal(child.options.webPreferences.sandbox,true);
  assert.equal(child.options.webPreferences.nodeIntegration,false);
  assert.equal(child.options.webPreferences.contextIsolation,true);
  assert.equal(child.options.webPreferences.partition,'persist:ordax-desktop-internet');
  assert.equal(child.webContents.popupHandler({url:'file:///C:/secret.txt'}).action,'deny');
  assert.equal(f.host.getSnapshot().tabs.length,2,'unsafe popup cannot create new tabs');
  assert.equal(popup({url:'https://docs.example.com/background',disposition:'background-tab'}).action,'deny');
  await Promise.resolve();
  assert.equal(f.host.getSnapshot().tabs.length,3);
  assert.equal(f.host.getSnapshot().activeTabId,f.host.getSnapshot().tabs[1].id,
    'background link must not steal focus');
});

test('popup handler fails closed for unsafe schemes, POST bodies, closed tabs and tab limits',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-origin',url:'https://example.com'});
  await Promise.resolve();
  const handler=View.all[0].webContents.popupHandler;
  for(const details of [undefined,{}, {url:'javascript:alert(1)'},
    {url:'file:///C:/Users/Dev/private'},
    {url:'https://person:secret@example.com/'},
    {url:'https://example.com/upload',postBody:{data:[{bytes:'data'}]}}]){
    assert.equal(handler(details).action,'deny');
  }
  assert.equal(f.host.getSnapshot().tabs.length,1,'untrusted popup metadata cannot create tabs');
  for(let i=0;i<30;i++){
    assert.equal(handler({url:'https://example.com/page/'+i,disposition:'new-window'}).action,'deny');
  }
  assert.equal(f.host.getSnapshot().tabs.length,16,'popup tab count stays bounded');
  f.post({type:'tab.close',tabId:'tab-origin'});
  const count=f.host.getSnapshot().tabs.length;
  handler({url:'https://example.com/late',disposition:'new-window'});
  assert.equal(f.host.getSnapshot().tabs.length,count,'a closed origin cannot spawn tabs');
});

test('synchronous download completion during save path never resumes or emits stale downloading',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-fast-path',url:'https://example.com'});
  await Promise.resolve();
  const item=new EventEmitter();
  let resumed=0;
  item.getFilename=()=> 'tiny.txt';
  item.pause=()=>{};
  item.cancel=()=>{};
  item.setSavePath=()=>item.emit('done',{},'completed');
  item.resume=()=>{resumed++;};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected rejection')}},
    item,View.all[0].webContents);
  const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
  assert.equal(f.host.hasActiveWork(),true);
  f.dialog.showSaveDialog=async()=>({canceled:false,filePath:'C:\\\\Users\\\\Dev\\\\tiny.txt'});
  f.post({type:'download.approve',id:pending.id});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resumed,0,'a completed transfer cannot be resumed');
  assert.equal(f.host.hasActiveWork(),false,'terminal event releases the update gate');
  assert.deepEqual(f.ui.sent.map(x=>x.value).filter(x=>x.id===pending.id).map(x=>x.status),
    ['pending','saved'],'a stale downloading event cannot overwrite a saved receipt');
});

test('synchronous completion during resume leaves terminal receipt last',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-fast-resume',url:'https://example.com'});
  await Promise.resolve();
  const item=new EventEmitter();
  let resumed=0;
  item.getFilename=()=> 'instant.txt';
  item.pause=()=>{};
  item.cancel=()=>{};
  item.setSavePath=()=>{};
  item.resume=()=>{resumed++;item.emit('done',{},'completed');};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected rejection')}},
    item,View.all[0].webContents);
  const pending=f.ui.sent.map(x=>x.value).find(x=>x.type==='browser-download'&&x.status==='pending');
  f.dialog.showSaveDialog=async()=>({canceled:false,filePath:'C:\\\\Users\\\\Dev\\\\instant.txt'});
  f.post({type:'download.approve',id:pending.id});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(resumed,1);
  assert.equal(f.host.hasActiveWork(),false);
  assert.deepEqual(f.ui.sent.map(x=>x.value).filter(x=>x.id===pending.id).map(x=>x.status),
    ['pending','saved'],'completed download cannot regress to downloading');
});

test('download completing while Chromium pauses has one terminal receipt and releases updater',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'tab-early-done',url:'https://example.com'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  const item=new EventEmitter();
  item.getFilename=()=> 'NUL.txt';
  item.pause=()=>item.emit('done',{},'completed');
  item.cancel=()=>{throw Error('completed item cannot be cancelled')};
  f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected preventDefault')}},item,wc);
  const events=f.ui.sent.map(x=>x.value).filter(x=>x.type==='browser-download');
  assert.deepEqual(events.map(x=>x.status),['pending','saved']);
  assert.equal(events[0].fileName,'download-NUL.txt');
  assert.equal(f.host.hasActiveWork(),false,'synchronous done cannot strand the update gate');
});

test('download pause failure cancels unapproved transfer without losing activity on cancellation failure',async t=>{
  for(const cancellationFails of [false,true]){
    const f=fixture();t.after(()=>f.host.dispose());
    f.post({type:'tab.open',tabId:'tab-pause-failure',url:'https://example.com'});
    await Promise.resolve();
    const item=new EventEmitter();
    item.getFilename=()=> 'sample.zip';
    item.pause=()=>{throw Error('transfer already unpausable')};
    let cancellations=0;
    item.cancel=()=>{cancellations++;if(cancellationFails)throw Error('cannot cancel')};
    f.browserSession.emit('will-download',{preventDefault(){throw Error('unexpected preventDefault')}},
      item,View.all[0].webContents);
    assert.equal(cancellations,1);
    const states=()=>f.ui.sent.map(x=>x.value).filter(x=>x.type==='browser-download').map(x=>x.status);
    assert.deepEqual(states(),cancellationFails?['pending']:['pending','cancelled']);
    assert.equal(f.host.hasActiveWork(),cancellationFails,
      'unconfirmed cancellation must retain the safety gate');
    if(cancellationFails){
      item.emit('done',{},'cancelled');
      assert.deepEqual(states(),['pending','cancelled']);
      assert.equal(f.host.hasActiveWork(),false);
    }
  }
});

test('Chromium detach failure blocks Native origin replacement until exact view is cleaned',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'old-tab',url:'https://example.com/old'});
  await Promise.resolve();
  const remove=f.window.contentView.removeChildView;
  let fail=true;
  f.window.contentView.removeChildView=function(view){
    if(fail){fail=false;throw Error('Chromium detach unavailable');}
    return remove.call(this,view);
  };
  assert.throws(()=>f.host.setTrustedOrigin('http://127.0.0.1:43124'),
    /Cannot revoke previous Chromium browser views/);
  assert.equal(f.host.hasActiveWork(),true,
    'a view with unproven detachment cannot allow idle update');
  assert.deepEqual(f.host.getSnapshot().tabs.map(tab=>tab.id),['old-tab']);
  const sent=f.ui.sent.length;
  f.post({type:'snapshot.request'});
  assert.equal(f.ui.sent.length,sent,'old Native renderer must lose its IPC privilege');
  f.host.setTrustedOrigin('http://127.0.0.1:43124');
  assert.deepEqual(f.host.getSnapshot().tabs,[]);
  assert.equal(f.host.hasActiveWork(),false);
  assert.equal(f.window.contentView.views.length,0);
});

test('Chromium close failure keeps tab owned and blocks idle update until retry',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'fragile',url:'https://example.com'});
  await Promise.resolve();
  const wc=View.all[0].webContents;
  const close=wc.close;
  let fail=true;
  wc.close=function(){
    if(fail){fail=false;throw Error('Chromium close unavailable');}
    return close.call(this);
  };
  assert.doesNotThrow(()=>f.post({type:'tab.close',tabId:'fragile'}));
  assert.equal(f.host.hasActiveWork(),true);
  assert.equal(f.host.getSnapshot().tabs.length,1);
  f.post({type:'tab.close',tabId:'fragile'});
  assert.equal(wc.closed,true);
  assert.equal(f.host.hasActiveWork(),false);
  assert.deepEqual(f.host.getSnapshot().tabs,[]);
});

test('browser disposal continues cleanup after a single Chromium detach exception',async()=>{
  const f=fixture();
  f.post({type:'tab.open',tabId:'first',url:'https://example.com/first'});
  f.post({type:'tab.open',tabId:'second',url:'https://example.com/second'});
  await Promise.resolve();
  const remove=f.window.contentView.removeChildView;
  let fail=true;
  f.window.contentView.removeChildView=function(view){
    if(fail){fail=false;throw Error('Chromium detach unavailable');}
    return remove.call(this,view);
  };
  assert.doesNotThrow(()=>f.host.dispose());
  assert.equal(View.all[0].webContents.closed,true);
  assert.equal(View.all[1].webContents.closed,true);
  assert.equal(f.ipcMain.listenerCount('ordax:desktop-browser:command'),0);
  assert.equal(f.browserSession.listenerCount('will-download'),0);
});

test('failed attachment with failed detach stays owned and blocks a new Native session until cleaned',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  const add=f.window.contentView.addChildView;
  const remove=f.window.contentView.removeChildView;
  let failDetach=true;
  f.window.contentView.addChildView=function(view){
    this.views.push(view);
    throw Error('Chromium attached before rejecting window add');
  };
  f.window.contentView.removeChildView=function(view){
    if(failDetach){failDetach=false;throw Error('Chromium detach unavailable');}
    return remove.call(this,view);
  };
  f.post({type:'tab.open',tabId:'failed-create',url:'https://example.com'});
  assert.deepEqual(f.host.getSnapshot().tabs,[],
    'failed tab must not be visible as a valid Native browser tab');
  assert.equal(f.window.contentView.views.length,1,
    'a partial native attachment remains physically attached during failure');
  assert.equal(f.host.hasActiveWork(),true,
    'orphaned Chromium views must block ordax-pull');
  f.window.contentView.addChildView=add;
  f.post({type:'tab.open',tabId:'must-wait',url:'https://example.com'});
  assert.deepEqual(f.host.getSnapshot().tabs,[],
    'no new web view while a failed attachment remains unverified');
  f.host.setTrustedOrigin('http://127.0.0.1:43124');
  assert.equal(f.window.contentView.views.length,0);
  assert.equal(f.host.hasActiveWork(),false);
  f.post({type:'tab.open',tabId:'revoked',url:'https://example.com'});
  assert.deepEqual(f.host.getSnapshot().tabs,[],
    'old Native document cannot open tabs after origin replacement');
});

test('failed pre-attachment Chromium close retries without removing an unattached view',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  const hook=WC.prototype.setWindowOpenHandler;
  const close=WC.prototype.close;
  let fail=true;
  WC.prototype.setWindowOpenHandler=()=>{throw Error('Chromium popup policy unavailable');};
  WC.prototype.close=function(){
    if(fail){fail=false;throw Error('Chromium WebContents close unavailable');}
    return close.call(this);
  };
  t.after(()=>{WC.prototype.setWindowOpenHandler=hook;WC.prototype.close=close;});
  const remove=f.window.contentView.removeChildView;
  let removeCalls=0;
  f.window.contentView.removeChildView=function(view){
    removeCalls++;
    return remove.call(this,view);
  };
  f.post({type:'tab.open',tabId:'failed-hook',url:'https://example.com'});
  assert.equal(f.host.hasActiveWork(),true);
  assert.equal(removeCalls,0,'a view never attached must not be forcibly detached');
  f.host.setTrustedOrigin('http://127.0.0.1:43124');
  assert.equal(View.all[0].webContents.closed,true);
  assert.equal(removeCalls,0);
  assert.equal(f.host.hasActiveWork(),false);
});

test('tab close retries only its unfinished Chromium step, not an already-detached view',async t=>{
  const f=fixture();t.after(()=>f.host.dispose());
  f.post({type:'tab.open',tabId:'transient-close',url:'https://example.com'});
  await Promise.resolve();
  const view=View.all[0];
  const original=view.webContents.close;
  let fail=true;
  view.webContents.close=function(){
    if(fail){fail=false;throw Error('WebContents unavailable');}
    return original.call(this);
  };
  const remove=f.window.contentView.removeChildView;
  let removes=0;
  f.window.contentView.removeChildView=function(v){
    removes++;
    if(!this.views.includes(v))throw Error('Chromium view was already detached');
    return remove.call(this,v);
  };
  f.post({type:'tab.close',tabId:'transient-close'});
  assert.equal(f.host.hasActiveWork(),true);
  assert.equal(removes,1);
  f.post({type:'tab.close',tabId:'transient-close'});
  assert.equal(removes,1,'do not detach an already detached Chromium view twice');
  assert.equal(view.webContents.closed,true);
  assert.equal(f.host.hasActiveWork(),false);
  assert.deepEqual(f.host.getSnapshot().tabs,[]);
});
