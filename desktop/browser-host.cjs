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
    .replace(/[^a-zA-Z0-9 ._-]/g,'_').slice(0,120).replace(/[ .]+$/g,'');
  if (!/^[a-zA-Z0-9]/.test(name)) return 'download';
  // Windows reserves these device names even when followed by an extension.
  // Keep the original extension rather than making a failed Save dialog likely.
  const stem=name.split('.')[0].trimEnd();
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)
    ? 'download-'+name : name;
}

function validViewportRequest(value) {
  if (!value || typeof value !== 'object' || value.visible !== true) return false;
  const nums=['x','y','width','height'].map(key=>value[key]);
  return nums.every(Number.isSafeInteger) &&
    value.x>=0 && value.y>=0 && value.width>0 && value.height>0;
}
function viewportBounds(value, window) {
  if (!validViewportRequest(value)) return null;
  const bounds = window.getContentBounds();
  let {x,y,width,height}=value;
  if (x >= bounds.width || y >= bounds.height) return null;
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
  // A Chromium view that could not be detached or closed must block idle updates.
  const failedCleanup = new Set();
  // Preserve partial native teardown progress. Removing an already-detached
  // view a second time can itself fail and indefinitely strand a close retry.
  const cleanupProgress = new WeakMap();
  const cleanupView = (view,{mayBeAttached=true}={}) => {
    let progress=cleanupProgress.get(view);
    if(!progress){
      progress={detached:!mayBeAttached,closed:false};
      cleanupProgress.set(view,progress);
    }
    if(!progress.detached){
      try {window.contentView.removeChildView(view);progress.detached=true;}
      catch(error){log('Browser view detach failed: '+String(error?.message??error));}
    }
    if(!progress.closed){
      try {
        if(!view.webContents.isDestroyed())view.webContents.close();
        progress.closed=true;
      } catch(error){log('Browser WebContents close failed: '+String(error?.message??error));}
    }
    if(!progress.detached || !progress.closed){
      failedCleanup.add(view);
      return false;
    }
    failedCleanup.delete(view);
    return true;
  };
  // Chromium media events also cover silent video that is not reported by
  // isCurrentlyAudible(). Track each WebContents rather than the OS idle clock.
  const activeMedia = new WeakMap();
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
  // Keep the validated renderer request separate from its currently clamped
  // size. A temporary RDP/window shrink must not permanently shrink the tab.
  let requestedViewport = null;
  let disposed = false;
  // The renderer shares a BrowserWindow across splash, Native startup and
  // rollback. Only the current Native origin may control Internet tabs or
  // receive their snapshots; sender WebContents identity alone is not enough.
  let trustedOrigin = null;
  let originEpoch = 0;
  const setTrustedOrigin = base => {
    let next=null;
    if(base!==null){
      const url=new URL(base);
      if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
         url.username||url.password||url.pathname!=='/'||url.search||url.hash)
        throw new TypeError('Native browser commands require a loopback host origin');
      next=url.origin;
    }
    if(next===trustedOrigin)return;
    // Rollback and Native host replacement revoke the previous session,
    // including its tabs and unconsumed save consent. An old transfer whose
    // cancellation fails must still hold the updater gate until Chromium ends.
    trustedOrigin=null;
    originEpoch++;
    let revoked=true;
    // Failed tab creation may leave an unregistered but still-attached
    // Chromium view. Do not grant the replacement Native session until it
    // is cleaned as well as the regular registered tabs.
    const registered=new Set(tabs.values());
    for(const view of [...failedCleanup])
      if(!registered.has(view) && !cleanupView(view))revoked=false;
    for(const id of [...tabs.keys()])if(!close(id))revoked=false;
    for(const [id,record] of downloads)
      if(record.phase==='downloading')cancelDownload(id,record);
    requestedViewport=null;
    viewport=null;
    // Never grant a replacement Native session while an old Chromium view
    // cannot be proven detached and closed.
    if(!revoked)throw Error('Cannot revoke previous Chromium browser views');
    trustedOrigin=next;
  };
  const isTrustedMainDocument = () => {
    if(disposed||!trustedOrigin||window.isDestroyed()||
       window.webContents.isDestroyed())return false;
    try {
      const url=new URL(window.webContents.getURL());
      return url.origin===trustedOrigin && !url.username && !url.password;
    } catch {return false;}
  };
  const browserSession = session.fromPartition('persist:ordax-desktop-internet');
  const send = payload => {
    if(isTrustedMainDocument())window.webContents.send(EVT,payload);
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
    if (disposed || downloads.size>0 || failedCleanup.size>0) return true;
    for (const view of tabs.values()) {
      try {
        const wc=view.webContents;
        if (wc.isDestroyed() || typeof wc.isCurrentlyAudible!=='function' ||
            wc.isCurrentlyAudible() || (activeMedia.get(wc)??0)>0 ||
            wc.isLoadingMainFrame?.()) return true;
      } catch {
        // Failure to inspect Chromium state must delay, not force, relaunch.
        return true;
      }
    }
    return false;
  };
  const publish = () => send({type:'snapshot',snapshot:snapshot()});
  // Avoid crossing the Electron/Chromium native boundary on repeated Surface
  // viewport messages and Windows/RDP resize events that change no layout.
  // Cache only the last layout actually applied to each exact WebContentsView.
  const appliedLayouts = new WeakMap();
  const layout = () => {
    for(const [id,view] of tabs){
      const visible=id===activeTabId && viewport!==null;
      const bounds=visible?viewport:{x:0,y:0,width:0,height:0};
      const previous=appliedLayouts.get(view);
      if(!previous || ['x','y','width','height'].some(key=>
          previous.bounds[key]!==bounds[key]))view.setBounds(bounds);
      if(!previous || previous.visible!==visible)view.setVisible?.(visible);
      appliedLayouts.set(view,{bounds,visible});
    }
  };
  const downloadEvent=(id,fileName,status,epoch)=>{
    if(epoch===originEpoch)send({type:'browser-download',id,fileName,status});
  };
  // Release the update gate synchronously when consent is revoked. Electron's
  // 'done' event may arrive later (or never after its WebContents closes).
  const cancelDownload=(id,record)=>{
    if(downloads.get(id)!==record ||
       !['pending','approving','downloading','cancel-failed'].includes(record.phase))return false;
    // If Chromium refuses cancellation, keep the transfer counted as active:
    // losing the done receipt must never authorize an unsafe Desktop restart.
    record.phase='cancelling';
    try{record.item.cancel();}
    catch(error){
      if(downloads.get(id)===record){
        record.phase='cancel-failed';
        log('Browser download cancellation failed: '+error.message);
      }
      return false;
    }
    // Electron may emit 'done' synchronously inside cancel(); the event owns
    // the terminal receipt in that case, and no second event may be sent.
    if(downloads.get(id)===record){
      record.phase='cancelled';
      downloads.delete(id);
      downloadEvent(id,record.fileName,'cancelled',record.epoch);
    }
    return true;
  };
  const onDownload = (event,item,contents) => {
    if (disposed || ![...tabs.values()].some(v=>v.webContents===contents)) {
      event.preventDefault();return;
    }
    if (downloads.size >= 8) {event.preventDefault();return;}
    const id='download-'+randomBytes(8).toString('hex');
    const fileName=safeDownloadName(item.getFilename());
    const record={item,contents,fileName,phase:'pending',epoch:originEpoch};
    downloads.set(id,record);
    // Register the terminal listener BEFORE requesting pause: Chromium can
    // finish or cancel a tiny transfer synchronously while pausing.
    item.on('done',(_event,state)=>{
      // A cancelled transfer is already forgotten; never publish twice.
      if(downloads.get(id)!==record)return;
      record.phase='done';
      downloads.delete(id);
      downloadEvent(id,fileName,state==='completed'?'saved':state==='cancelled'?'cancelled':'failed',record.epoch);
    });
    downloadEvent(id,fileName,'pending',record.epoch);
    try { item.pause(); }
    catch(error) {
      // A failed pause must not leave an unapproved transfer running. Keep
      // its update gate closed if Chromium also refuses cancellation.
      if(downloads.get(id)===record){
        cancelDownload(id,record);
        log('Browser download could not be paused: '+error.message);
      }
    }
  };
  browserSession.on('will-download',onDownload);
  browserSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  browserSession.setPermissionCheckHandler?.(()=>false);

  // Chromium may reject loadURL synchronously if its WebContents is no
  // longer usable, in addition to rejecting the returned Promise. Neither
  // failure may escape the Native IPC handler or strand an orphaned view.
  const loadPage=(id,view,target,{closeOnThrow=false}={})=>{
    try {
      void Promise.resolve(view.webContents.loadURL(target)).catch(error=>{
        if(disposed || tabs.get(id)!==view)return;
        log('Browser navigation failed: '+error.message);
        publish();
      });
    } catch(error) {
      log('Browser navigation failed: '+error.message);
      if(closeOnThrow)close(id);
      else publish();
      return false;
    }
    return true;
  };

  const open = (id,url='',{background=false}={}) => {
    if (!TAB_ID.test(id) || tabs.has(id) || tabs.size>=MAX_TABS ||
        failedCleanup.size>0) return;
    const target=safeWebUrl(url,{blank:true});
    if (!target) return;
    let view,attachmentAttempted=false;
    try {
      view=new WebContentsView({webPreferences:{
      partition:'persist:ordax-desktop-internet',nodeIntegration:false,
      contextIsolation:true,sandbox:true,webSecurity:true,
      javascript:true,webviewTag:false,
    }});
    const wc=view.webContents;
    pageEpochs.set(wc,0);
    wc.on('media-started-playing',()=>activeMedia.set(wc,(activeMedia.get(wc)??0)+1));
    wc.on('media-paused',()=>activeMedia.set(wc,Math.max(0,(activeMedia.get(wc)??0)-1)));
    // A different document cannot inherit the previous page's media state.
    wc.on('did-start-navigation',details=>{
      // Hash/SPA navigation does not stop playback, and subframe navigation
      // must not erase activity from another frame in the same WebContents.
      // Unknown navigation metadata retains the safety gate.
      if(details?.isMainFrame===true && details.isSameDocument===false)
        activeMedia.delete(wc);
    });
    // A navigation/reload revokes prior selection and find results. Chromium
    // may resolve executeJavaScript only after the next document is active.
    for(const event of ['did-start-navigation','did-navigate','did-navigate-in-page'])
      wc.on(event,()=>{if(tabs.get(id)===view)invalidatePage(id,wc);});
    wc.setWindowOpenHandler(details=>{
      // Chromium reports _blank links here. Keep the untrusted page out of
      // BrowserWindow creation: open only a bounded, sandboxed OrdaX tab.
      const target=safeWebUrl(details?.url);
      if(!disposed && tabs.get(id)===view && target &&
         details?.postBody == null && tabs.size<MAX_TABS){
        open('tab-popup-'+randomBytes(8).toString('hex'),target,{
          background:details.disposition==='background-tab',
        });
      }
      // Never allow the remote renderer to construct an Electron window.
      return {action:'deny'};
    });
    // Electron 40 puts the URL in the navigation Event itself; the second
    // argument is deprecated. Read the modern contract first, while accepting
    // the older signature used by already-installed development shells.
    const guardNavigation=(event,legacyUrl)=>{
      const target=typeof event?.url==='string'?event.url:legacyUrl;
      if(!safeWebUrl(target,{blank:true}))event.preventDefault();
    };
    wc.on('will-navigate',guardNavigation);
    wc.on('will-redirect',guardNavigation);
    for(const event of ['did-start-loading','did-stop-loading','did-navigate','did-navigate-in-page','page-title-updated'])
      wc.on(event,()=>publish());
    tabs.set(id,view);
    attachmentAttempted=true;
    window.contentView.addChildView(view);
    if(!background || activeTabId===null)activeTabId=id;
    layout();
    if(loadPage(id,view,target,{closeOnThrow:true}))publish();
    } catch(error) {
      // Window attachment, Chromium policy hooks, or view layout can fail
      // synchronously while Electron is tearing down. Tab creation is atomic:
      // restore the old active tab and close the exact failed WebContents.
      log('Browser tab creation failed: '+String(error?.message??error));
      if(view){
        if(tabs.get(id)===view){
          tabs.delete(id);
          if(activeTabId===id)activeTabId=[...tabs.keys()].at(-1)??null;
        }
        // A partial native add or synchronous close failure must remain
        // owned even after removing the failed tab from Native snapshots.
        cleanupView(view,{mayBeAttached:attachmentAttempted});
        try {layout();publish();}
        catch(cleanupError){log('Browser tab recovery failed: '+String(cleanupError?.message??cleanupError));}
      }
    }
  };
  const close = id => {
    const view=tabs.get(id);
    if(!view)return true;
    // Unapproved downloads lose their save consent when their owner closes;
    // approved transfers retain the existing independent download lifecycle.
    for(const [downloadId,record] of downloads){
      if(record.contents===view.webContents && record.phase!=='downloading')
        cancelDownload(downloadId,record);
    }
    invalidatePage(id,view.webContents);
    activeMedia.delete(view.webContents);
    // The same Chromium teardown policy owns ordinary close, Native origin
    // revocation, failed tab creation and retry after a partial operation.
    if(!cleanupView(view))return false;
    tabs.delete(id);
    if(activeTabId===id)activeTabId=[...tabs.keys()].at(-1)??null;
    if(!disposed) {
      try {layout();publish();}
      catch(error){log('Browser view layout after close failed: '+String(error?.message??error));}
    }
    return true;
  };
  const navigate=(id,url)=>{
    const view=tabs.get(id),target=safeWebUrl(url,{blank:true});
    if(!view||!target)return;
    invalidatePage(id,view.webContents);
    loadPage(id,view,target);
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
    if(type==='viewport.set'){
      // Validate the requested rectangle independently of the *current*
      // window dimensions. During RDP resize it may temporarily be entirely
      // offscreen; discarding it would prevent recovery on a later resize.
      const valid=validViewportRequest(command.viewport);
      requestedViewport=valid?{
        visible:true,x:command.viewport.x,y:command.viewport.y,
        width:command.viewport.width,height:command.viewport.height,
      }:null;
      const next=viewportBounds(requestedViewport,window);
      viewport=next;
      layout();return;
    }
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
      let selectionRequest;
      try {
        selectionRequest=wc.executeJavaScript(
          'String(window.getSelection()?.toString()||"").slice(0,4097)',true);
      } catch(error) {
        // Chromium can throw before returning a Promise while its renderer
        // is being torn down. Treat this exactly like an async rejection.
        log('Browser selection unavailable: '+String(error?.message??error));
        if(stillCurrent())send({type:'page-selection.result',tabId,
          requestId:command.requestId,error:'selection-unavailable'});
        return;
      }
      void Promise.resolve(selectionRequest).then(text=>{
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
      try {wc.stopFindInPage('clearSelection');}
      catch(error){log('Browser find finish failed: '+String(error?.message??error));}
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
    if(command.type==='download.cancel'){cancelDownload(command.id,record);return;}
    if(command.type!=='download.approve'||record.phase!=='pending')return;
    // One consent dialog per item; a late answer must never revive a
    // cancelled/completed download or an already disposed browser host.
    record.phase='approving';
    let saveRequest;
    try {
      saveRequest=dialog.showSaveDialog(window,{title:'Salvar arquivo',
        defaultPath:record.fileName,buttonLabel:'Salvar',
        properties:['createDirectory','showOverwriteConfirmation']});
    } catch(error) {
      // A destroyed/unavailable Windows dialog can throw before returning a
      // Promise. Revoke consent without leaking the exception through IPC.
      // Failed Chromium cancellation retains the existing update safety gate.
      cancelDownload(command.id,record);
      log('Browser save dialog failed: '+error.message);
      return;
    }
    void Promise.resolve(saveRequest).then(result=>{
        if(disposed||downloads.get(command.id)!==record||record.phase!=='approving')return;
        if(result.canceled||!result.filePath){cancelDownload(command.id,record);return;}
        try {
          record.item.setSavePath(result.filePath);
          // A tiny transfer may emit 'done' while Chromium accepts the save
          // path. Never resume or report an already completed item.
          if(downloads.get(command.id)!==record || record.phase!=='approving')return;
          record.phase='downloading';
          record.item.resume();
          // resume() may synchronously emit 'done' as well. The terminal
          // receipt must stay last, and the idle/update gate already released.
          if(downloads.get(command.id)===record && record.phase==='downloading')
            downloadEvent(command.id,record.fileName,'downloading',record.epoch);
        } catch(error) {
          cancelDownload(command.id,record);
          log('Browser download could not be saved: '+error.message);
        }
      }).catch(error=>{
        if(disposed||downloads.get(command.id)!==record||record.phase!=='approving')return;
        cancelDownload(command.id,record);
        log('Browser save dialog failed: '+error.message);
      });
  };
  const onMessage=(e,raw)=>{
    if(!isTrustedMainDocument() || e?.sender!==window.webContents ||
       e.senderFrame!==window.webContents.mainFrame)return;
    handle(e,raw);
    handleDownloads(e,raw);
  };
  ipcMain.on(CMD,onMessage);
  const onResize=()=>{viewport=viewportBounds(requestedViewport,window);layout();};
  window.on('resize',onResize);
  const dispose=()=>{
    if(disposed)return;disposed=true;
    // Startup failure can dispose this host while the error window stays open.
    // Detach this one-shot hook now instead of retaining the browser closure.
    window.removeListener('closed',dispose);
    ipcMain.removeListener(CMD,onMessage);
    window.removeListener('resize',onResize);
    browserSession.removeListener('will-download',onDownload);
    for(const [id,record] of downloads)cancelDownload(id,record);
    // One teardown owner for normal tab close, Native rollback and disposal.
    // A single Chromium exception cannot skip cleanup of the remaining tabs.
    for(const id of [...tabs.keys()])close(id);
    // Retry orphaned failed-creation views as well; never discard their
    // exact references before a complete detach + WebContents close.
    for(const view of [...failedCleanup])cleanupView(view);
  };
  window.once('closed',dispose);
  return Object.freeze({dispose,setTrustedOrigin,getSnapshot:snapshot,hasActiveWork});
}
module.exports={createDesktopBrowserHost,safeWebUrl,safeDownloadName,viewportBounds};
