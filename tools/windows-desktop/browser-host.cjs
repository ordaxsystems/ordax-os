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
  // Async page operations are scoped to the exact WebContents and navigation
  // generation, never merely the tab ID (which may be reused after close).
  const pageEpochs = new WeakMap();
  const findQueries = new Map();
  const findRequests = new Map();
  const clearFindRequest = id => {
    const pending=findRequests.get(id);
    if(!pending)return;
    findRequests.delete(id);
    pending.contents.removeListener('found-in-page',pending.listener);
  };
  const invalidatePage = (id,contents) => {
    pageEpochs.set(contents,(pageEpochs.get(contents)??0)+1);
    findQueries.delete(id);
    clearFindRequest(id);
  };
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
  // Updates must not discard browser work merely because Windows reports
  // no mouse/keyboard input. This is the same browser owner that handles
  // downloads and WebContentsViews, not a second activity tracker.
  const hasActiveWork = () => {
    if (disposed || downloads.size>0) return true;
    for (const view of tabs.values()) {
      try {
        const wc=view.webContents;
        if (wc.isDestroyed() || typeof wc.isCurrentlyAudible!=='function' ||
            wc.isCurrentlyAudible() || wc.isLoadingMainFrame?.()) return true;
      } catch {
        // Failure to inspect Chromium state must delay, not force, relaunch.
        return true;
      }
    }
    return false;
  };
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
    const record={item,fileName,phase:'pending'};
    downloads.set(id,record);
    downloadEvent(id,fileName,'pending');
    item.on('done',(_event,state)=>{
      record.phase='done';
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
    pageEpochs.set(wc,0);
    // A navigation/reload revokes prior selection and find results. Chromium
    // may resolve executeJavaScript only after the next document is active.
    for(const event of ['did-start-navigation','did-navigate','did-navigate-in-page'])
      wc.on(event,()=>{if(tabs.get(id)===view)invalidatePage(id,wc);});
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
    invalidatePage(id,view.webContents);
    window.contentView.removeChildView(view);
    tabs.delete(id);
    if(activeTabId===id)activeTabId=[...tabs.keys()].at(-1)??null;
    if(!view.webContents.isDestroyed())view.webContents.close();
    layout();publish();
  };
  const navigate=(id,url)=>{
    const view=tabs.get(id),target=safeWebUrl(url,{blank:true});
    if(!view||!target)return;
    invalidatePage(id,view.webContents);
    void view.webContents.loadURL(target).catch(error=>{log('Browser navigation failed: '+error.message);publish();});
  };
  const handle = (event,raw) => {
    if (disposed || event.sender!==window.webContents ||
        typeof raw!=='string'||raw.length>MAX_BYTES)return;
    let command;
    try {command=JSON.parse(raw);}catch{return;}
    if(!command||typeof command!=='object'||Array.isArray(command))return;
    const {type,tabId}=command;
    if(typeof type!=='string')return;
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
    if(type==='tab.reload'){invalidatePage(tabId,wc);wc.reload();return;}
    if(type==='tab.back'){if(nav.canGoBack?.()){invalidatePage(tabId,wc);nav.goBack();}return;}
    if(type==='tab.forward'){if(nav.canGoForward?.()){invalidatePage(tabId,wc);nav.goForward();}return;}
    if(type==='page-selection.capture'){
      if(typeof command.requestId!=='string'||!/^[a-z0-9-]{1,64}$/.test(command.requestId))return;
      const url=safeWebUrl(wc.getURL());
      if(!url){send({type:'page-selection.result',tabId,requestId:command.requestId,error:'unsupported-url'});return;}
      const epoch=pageEpochs.get(wc);
      const stillCurrent=()=>!disposed && tabs.get(tabId)===view &&
        !wc.isDestroyed() && pageEpochs.get(wc)===epoch &&
        safeWebUrl(wc.getURL())===url;
      void wc.executeJavaScript('String(window.getSelection()?.toString()||"").slice(0,4097)',true)
        .then(text=>{
          if(!stillCurrent())return;
          const selection=String(text).trim();
          if(!selection)throw Error('empty-selection');
          send({type:'page-selection.result',tabId,requestId:command.requestId,
            selection:{schema:'ordax.browser-page-selection/1',kind:'selection',
              source:'untrusted-web-content',tabId,url,title:(wc.getTitle()||'').slice(0,256),
              text:selection.slice(0,4096),truncated:selection.length>4096}});
        }).catch(()=>{if(stillCurrent())send({type:'page-selection.result',tabId,requestId:command.requestId,error:'selection-unavailable'});});
      return;
    }
    if(type==='page-find.finish'){
      findQueries.delete(tabId);
      clearFindRequest(tabId);
      wc.stopFindInPage('clearSelection');
      return;
    }
    if(type.startsWith('page-find.')){
      const query=type==='page-find.search'?command.query:findQueries.get(tabId);
      if(typeof query!=='string'||query.length<1||query.length>256||/[\u0000-\u001f\u007f]/.test(query))return;
      clearFindRequest(tabId);
      findQueries.set(tabId,query);
      const epoch=pageEpochs.get(wc);
      const pending={contents:wc,listener:null,requestId:null};
      const onFound=(_event,result)=>{
        // Electron search results include their own requestId. Never confuse
        // an older response with a newer search on the same WebContents.
        if(result?.requestId!==pending.requestId)return;
        clearFindRequest(tabId);
        if(disposed||tabs.get(tabId)!==view||wc.isDestroyed()||
           pageEpochs.get(wc)!==epoch)return;
        const count=Number.isFinite(result.matches)
          ?Math.min(1000,Math.max(0,Math.floor(result.matches))):0;
        send({type:'page-find.result',tabId,query,
          count,state:count>0?'found':'not-found'});
      };
      pending.listener=onFound;
      findRequests.set(tabId,pending);
      wc.on('found-in-page',onFound);
      try {
        pending.requestId=wc.findInPage(query,{
          forward:type!=='page-find.previous',findNext:type!=='page-find.search',
        });
        if(!Number.isSafeInteger(pending.requestId)||pending.requestId<=0)
          clearFindRequest(tabId);
      } catch(error) {
        clearFindRequest(tabId);
        log('Browser find operation failed: '+error.message);
      }
    }
  };
  const handleDownloads = (event,raw)=>{
    if(disposed||event.sender!==window.webContents||typeof raw!=='string'||raw.length>MAX_BYTES)return;
    let command;try{command=JSON.parse(raw)}catch{return;}
    if(!DOWNLOAD_ID.test(command?.id))return;
    const record=downloads.get(command.id);
    if(!record)return;
    if(command.type==='download.cancel'){
      if(record.phase==='pending'||record.phase==='approving'||record.phase==='downloading'){
        record.phase='cancelled';
        record.item.cancel();
      }
      return;
    }
    if(command.type!=='download.approve'||record.phase!=='pending')return;
    // One consent dialog per item; a late answer must never revive a
    // cancelled/completed download or an already disposed browser host.
    record.phase='approving';
    void dialog.showSaveDialog(window,{title:'Salvar arquivo',defaultPath:record.fileName,
      buttonLabel:'Salvar',properties:['createDirectory','showOverwriteConfirmation']})
      .then(result=>{
        if(disposed||downloads.get(command.id)!==record||record.phase!=='approving')return;
        if(result.canceled||!result.filePath){
          record.phase='cancelled';
          record.item.cancel();
          return;
        }
        try {
          record.item.setSavePath(result.filePath);
          record.item.resume();
          record.phase='downloading';
          downloadEvent(command.id,record.fileName,'downloading');
        } catch(error) {
          record.phase='cancelled';
          record.item.cancel();
          log('Browser download could not be saved: '+error.message);
        }
      }).catch(error=>{
        if(disposed||downloads.get(command.id)!==record||record.phase!=='approving')return;
        record.phase='cancelled';
        record.item.cancel();
        log('Browser save dialog failed: '+error.message);
      });
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
      invalidatePage(id,v.webContents);
      window.contentView.removeChildView(v);
      if(!v.webContents.isDestroyed())v.webContents.close();
      tabs.delete(id);
    }
  };
  window.once('closed',dispose);
  return Object.freeze({dispose,getSnapshot:snapshot,hasActiveWork});
}
module.exports={createDesktopBrowserHost,safeWebUrl,safeDownloadName,viewportBounds};
