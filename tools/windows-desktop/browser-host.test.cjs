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
  constructor(options){this.options=options;this.webContents=new WC();View.all.push(this);}
  setBounds(value){this.bounds=value;}
  setVisible(value){this.visible=value;}
}
View.all=[];
function fixture(){
  View.all=[];
  const ui=new EventEmitter();
  ui.sent=[];
  ui.send=(key,value)=>ui.sent.push({key,value});
  ui.isDestroyed=()=>false;
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
  const post=payload=>ipcMain.emit('ordax:desktop-browser:command',{sender:ui},JSON.stringify(payload));
  return {window,ui,host,post,browserSession,ipcMain};
}

test('Browser URL validation rejects privileged schemes, credentials and oversized data',()=>{
  assert.equal(safeWebUrl('https://example.com/x'),'https://example.com/x');
  assert.equal(safeWebUrl('http://example.org/'),'http://example.org/');
  assert.equal(safeWebUrl('javascript:alert(1)'),null);
  assert.equal(safeWebUrl('file:///C:/secret'),null);
  assert.equal(safeWebUrl('https://bob:pass@example.com'),null);
  assert.equal(safeWebUrl('',{blank:true}),'about:blank');
  assert.equal(safeDownloadName('..\\..\\test<script>.pdf'),'test_script_.pdf');
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
