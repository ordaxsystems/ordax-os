'use strict';
// OrdaX Internet host adapter for Electron. The same Native Surface invokes
// ordax.browser-session/1; browsing is isolated in WebContentsView, never
// in the privileged OrdaX composition renderer.
const { randomBytes } = require('node:crypto');
const { basename } = require('node:path');

const CMD = 'ordax:desktop-browser:command';
const EVT = 'ordax:desktop-browser:event';
const TAB_ID = /^[a-z][a-z0-9-]{0,63}$/;
const DOWNLOAD_ID = /^download-[0-9a-f]{16}$/;
const MAX_TABS = 16;
const MAX_BYTES = 12000;

function safeWebUrl(value, { blank = false } = {}) {
  if (blank && (value === '' || value === 'about:blank')) return 'about:blank';
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
        url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function safeDownloadName(value) {
  const name = basename(String(value || '').replaceAll('\\', '/'))
    .replace(/[^a-zA-Z0-9 ._-]/g,'_').slice(0,120);
  return /^[a-zA-Z0-9]/.test(name) && name !== '.' && name !== '..' ? name : 'download';
}

function viewportBounds(value, window) {
  if (!value || typeof value !== 'object' || value.visible !== true) return null;
  const bounds = window.getContentBounds();
  const nums = ['x','y','width','height'].map(key => value[key]);
  if (nums.some(n => !Number.isFinite(n) || !Number.isInteger(n))) return null;
  let [x,y,width,height] = nums;
  if (x < 0 || y < 0 || width < 1 || height < 1 || x > bounds.width || y > bounds.height) return null;
  width = Math.min(width,bounds.width-x);
  height = Math.min(height,bounds.height-y);
  if (width < 1 || height < 1) return null;
  return {x,y,width,height};
}

function canNavigate(contents) {
  return contents.navigationHistory ?? contents;
}

function createDesktopBrowserHost({window, ipcMain, WebContentsView, session, dialog, log=()=>{}}) {
  if (!window?.webContents || typeof ipcMain?.on !== 'function' ||
      typeof WebContentsView !== 'function') throw new TypeError('Electron Desktop browser owner is required');
  const tabs = new Map();
  const downloads = new Map();
  let activeTabId = null;
  let viewport = null;
  let disposed = false;
  const browserSession = session.fromPartition('persist:ordax-desktop-internet');
  const send = payload => {
    if (!disposed && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(EVT,payload);
  };
  const snapshot = () => ({
    supported:true,reason:'',activeTabId,
    tabs:[...tabs].map(([id,view])=>{
      const wc=view.webContents, nav=canNavigate(wc);
      return {id,url:wc.getURL()||'',title:wc.getTitle()||'',
        loading: Boolean(wc.isLoadingMainFrame?.()),
        canGoBack:Boolean(nav.canGoBack?.()),
        canGoForward:Boolean(nav.canGoForward?.())};
    }),
  });
  const publish = () => send({type:'snapshot',snapshot:snapshot()});
  const layout = () => {
    for(const [id,view] of tabs){
      const visible= id===activeTabId && viewport!==null;
      if(visible)view.setBounds(viewport);
      else view.setBounds({x:0,y:0,width:0,height:0});
      view.setVisible?.(visible);
    }
  };
  const downloadEvent=(id,fileName,status)=>send({type:'browser-download',id,fileName,status});
  const onDownload = (event,item,contents) => {
    if (disposed || ![...tabs.values()].some(v=>v.webContents===contents)) {
      event.preventDefault();return;
    }
    if (downloads.size >= 8) {event.preventDefault();return;}
    const id='download-'+randomBytes(8).toString('hex');
    const fileName=safeDownloadName(item.getFilename());
    item.pause();
    downloads.set(id,{item,fileName});
    downloadEvent(id,fileName,'pending');
    item.on('done',(_event,state)=>{
      downloads.delete(id);
      downloadEvent(id,fileName,state==='completed'?'saved':state==='cancelled'?'cancelled':'failed');
    });
  };
  browserSession.on('will-download',onDownload);
  browserSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  browserSession.setPermissionCheckHandler?.(()=>false);

  const open = (id,url='') => {
    if (!TAB_ID.test(id) || tabs.has(id) || tabs.size>=MAX_TABS) return;
    const target=safeWebUrl(url,{blank:true});
    if (!target) return;
    const view=new WebContentsView({webPreferences:{
      partition:'persist:ordax-desktop-internet',nodeIntegration:false,
      contextIsolation:true,sandbox:true,webSecurity:true,
      javascript:true,webviewTag:false,
    }});
    const wc=view.webContents;
    wc.setWindowOpenHandler(()=>({action:'deny'}));
    wc.on('will-navigate',(event,next)=>{if(!safeWebUrl(next,{blank:true}))event.preventDefault();});
    wc.on('will-redirect',(event,next)=>{if(!safeWebUrl(next,{blank:true}))event.preventDefault();});
    for(const event of ['did-start-loading','did-stop-loading','did-navigate','did-navigate-in-page','page-title-updated'])
      wc.on(event,()=>publish());
    tabs.set(id,view);
    window.contentView.addChildView(view);
    activeTabId=id;
    layout();
    void wc.loadURL(target).catch(error=>{log('Browser navigation failed: '+error.message);publish();});
    publish();
  };
  const close = id => {
    const view=tabs.get(id);
    if(!view)return;
    window.contentView.removeChildView(view);
    tabs.delete(id);
    if(activeTabId===id)activeTabId=[...tabs.keys()].at(-1)??null;
    if(!view.webContents.isDestroyed())view.webContents.close();
    layout();publish();
  };
  const navigate=(id,url)=>{
    const view=tabs.get(id),target=safeWebUrl(url,{blank:true});
    if(!view||!target)return;
    void view.webContents.loadURL(target).catch(error=>{log('Browser navigation failed: '+error.message);publish();});
  };
  const findQueries=new Map();
  const handle = (event,raw) => {
    if (disposed || event.sender!==window.webContents ||
        typeof raw!=='string'||raw.length>MAX_BYTES)return;
    let command;
    try {command=JSON.parse(raw);}catch{return;}
    if(!command||typeof command!=='object'||Array.isArray(command))return;
    const {type,tabId}=command;
    if(type==='snapshot.request'){publish();return;}
    if(type==='viewport.set'){viewport=viewportBounds(command.viewport,window);layout();return;}
    if(type==='tab.open'){open(tabId,command.url??'');return;}
    if(type==='tab.close'){if(TAB_ID.test(tabId))close(tabId);return;}
    if(type==='tab.activate'){
      if(tabs.has(tabId)){activeTabId=tabId;layout();publish();}
      return;
    }
    const view=tabs.get(tabId);
    if(!view)return;
    const wc=view.webContents,nav=canNavigate(wc);
    if(type==='tab.navigate'){navigate(tabId,command.url);return;}
    if(type==='tab.reload'){wc.reload();return;}
    if(type==='tab.back'){if(nav.canGoBack?.())nav.goBack();return;}
    if(type==='tab.forward'){if(nav.canGoForward?.())nav.goForward();return;}
    if(type==='page-selection.capture'){
      if(typeof command.requestId!=='string'||!/^[a-z0-9-]{1,64}$/.test(command.requestId))return;
      const url=safeWebUrl(wc.getURL());
      if(!url){send({type:'page-selection.result',tabId,requestId:command.requestId,error:'unsupported-url'});return;}
      void wc.executeJavaScript('String(window.getSelection()?.toString()||"").slice(0,4097)',true)
        .then(text=>{
          const selection=String(text).trim();
          if(!selection)throw Error('empty-selection');
          send({type:'page-selection.result',tabId,requestId:command.requestId,
            selection:{schema:'ordax.browser-page-selection/1',kind:'selection',
              source:'untrusted-web-content',tabId,url,title:(wc.getTitle()||'').slice(0,256),
              text:selection.slice(0,4096),truncated:selection.length>4096}});
        }).catch(()=>send({type:'page-selection.result',tabId,requestId:command.requestId,error:'selection-unavailable'}));
      return;
    }
    if(type==='page-find.finish'){findQueries.delete(tabId);wc.stopFindInPage('clearSelection');return;}
    if(type.startsWith('page-find.')){
      const query=type==='page-find.search'?command.query:findQueries.get(tabId);
      if(typeof query!=='string'||query.length<1||query.length>256||/[\u0000-\u001f\u007f]/.test(query))return;
      findQueries.set(tabId,query);
      const onFound=(_event,result)=>{
        wc.removeListener('found-in-page',onFound);
        send({type:'page-find.result',tabId,query,
          count:Math.min(1000,Math.max(0,result.matches??0)),
          state:result.matches>0?'found':'not-found'});
      };
      wc.on('found-in-page',onFound);
      wc.findInPage(query,{forward:type!=='page-find.previous',findNext:type!=='page-find.search'});
    }
  };
  const handleDownloads = (event,raw)=>{
    if(disposed||event.sender!==window.webContents||typeof raw!=='string')return;
    let command;try{command=JSON.parse(raw)}catch{return;}
    if(!DOWNLOAD_ID.test(command?.id))return;
    const record=downloads.get(command.id);
    if(!record)return;
    if(command.type==='download.cancel'){record.item.cancel();return;}
    if(command.type!=='download.approve')return;
    void dialog.showSaveDialog(window,{title:'Salvar arquivo',defaultPath:record.fileName,
      buttonLabel:'Salvar',properties:['createDirectory','showOverwriteConfirmation']})
      .then(result=>{
        if(result.canceled||!result.filePath){record.item.cancel();return;}
        record.item.setSavePath(result.filePath);record.item.resume();
        downloadEvent(command.id,record.fileName,'downloading');
      }).catch(()=>record.item.cancel());
  };
  const onMessage=(e,raw)=>{handle(e,raw);handleDownloads(e,raw);};
  ipcMain.on(CMD,onMessage);
  const onResize=()=>{viewport=viewportBounds(viewport?{...viewport,visible:true}:null,window);layout();};
  window.on('resize',onResize);
  const dispose=()=>{
    if(disposed)return;disposed=true;
    ipcMain.removeListener(CMD,onMessage);
    window.removeListener('resize',onResize);
    browserSession.removeListener('will-download',onDownload);
    for(const record of downloads.values())record.item.cancel();
    downloads.clear();
    for(const [id,v] of [...tabs]) {
      window.contentView.removeChildView(v);
      if(!v.webContents.isDestroyed())v.webContents.close();
      tabs.delete(id);
    }
  };
  window.once('closed',dispose);
  return Object.freeze({dispose,getSnapshot:snapshot});
}
module.exports={createDesktopBrowserHost,safeWebUrl,safeDownloadName,viewportBounds};
