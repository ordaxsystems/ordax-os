'use strict';
// Installable Windows host: the UI and Git Pull remain owned by OrdaX OS.
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, shell, dialog } = require('electron');
const { createDesktopBrowserHost } = require('./browser-host.cjs');
const { join, resolve, isAbsolute, basename } = require('node:path');
const { randomBytes } = require('node:crypto');
const { mkdirSync, createWriteStream, existsSync, readFileSync } = require('node:fs');
const { resolveTemplate, runtimeStateDirectory } = require('./runtime.cjs');
const { chooseBootVersion, confirmHealthy, rejectCandidate, stageMain, readState, pinPrevious, unpin } = require('./dev-update.cjs');
const { startHost, stopHost } = require('./host.cjs');
const { verifyBundledNativeReceipt } = require('./native-build.cjs');
let window=null, runtime=null, stream=null, browserHost=null, updateTimer=null, staging=false;
const PRODUCT='/system/composition/native/index.html';
// Explicit stable per-user storage must be set before the instance lock or any
// Electron internal service can resolve a path from the npm package name.
app.setName('OrdaX OS Desktop Dev');
// An installed smoke must not load the real user's account/files or
// desktop-dev-update-state.json. This is a profile selector only, never a
// different OrdaX runtime, Surface, updater or product channel.
const devProfile = process.env.ORDAX_DESKTOP_TEST_PROFILE === '1';
const explicitTestDirectory = process.env.ORDAX_DESKTOP_TEST_PROFILE_DIR || '';
// Smoke tests on an already-used Windows machine need a unique directory,
// regardless of whether Electron resolves appData from Windows known folders
// or from APPDATA. Never permit the override for a normal Desktop launch.
if (explicitTestDirectory && (!devProfile || !isAbsolute(explicitTestDirectory) ||
    basename(resolve(explicitTestDirectory)) !== 'OrdaX OS Desktop Dev Test')) {
  throw Error('Unsafe isolated Desktop test profile path');
}
const desktopUserData = explicitTestDirectory
  ? resolve(explicitTestDirectory)
  : join(app.getPath('appData'),devProfile ? 'OrdaX OS Desktop Dev Test' : 'OrdaX OS Desktop Dev');
mkdirSync(desktopUserData,{recursive:true});
app.setPath('userData',desktopUserData);
if (process.platform==='win32') app.setAppUserModelId('dev.ordax.os.desktop');
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
else app.on('second-instance',()=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.focus();}});
function log(message) {
  const line=new Date().toISOString()+' '+String(message)+'\n';
  stream?.write(line);
  process.stderr.write(line);
}
function status(message) {
  if(!window || window.isDestroyed())return;
  const safe=String(message).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(
    '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><body style="background:#101820;color:white;font:16px Segoe UI,Arial,sans-serif;margin:8%"><h2>OrdaX OS Desktop Dev</h2><p>'+safe+'</p></body>'
  ));
}
function navigationPolicy(base) {
  const allowed=new URL(base);
  const external=url=>{
    try {
      const target=new URL(url);
      if(target.protocol==='https:') shell.openExternal(target.href);
    } catch { /* Unsafe navigation stays blocked */ }
  };
  window.webContents.on('will-navigate',(event,url)=>{
    try {
      const target=new URL(url);
      if(target.origin===allowed.origin) return;
    } catch {}
    event.preventDefault();external(url);
  });
  window.webContents.setWindowOpenHandler(({url})=>{
    external(url);return {action:'deny'};
  });
}
function menu(userData) {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'OrdaX',submenu:[
      {label:'Recarregar interface',accelerator:'Ctrl+R',click:()=>window?.webContents.reload()},
      {label:'Abrir logs',click:()=>shell.openPath(join(userData,'desktop.log'))},
      ...(app.isPackaged ? [
        {type:'separator'},
        {label:'Verificar atualizações Dev',click:()=>void stageInBackground(userData,resolveTemplate(__dirname,process.resourcesPath,true))},
        {label:'Reverter para versão anterior Dev',click:async()=>{
          try {
            const state=readState(userData);
            if(!state.previousSha){ dialog.showMessageBoxSync(window,{type:'info',message:'Nenhuma versão Dev anterior verificada está disponível.'});return; }
            const reply=await dialog.showMessageBox(window,{type:'warning',buttons:['Cancelar','Reverter e reiniciar'],
              defaultId:0,cancelId:0,message:'Reverter o OrdaX Desktop Dev?',
              detail:'A versão anterior será fixada. Atualizações automáticas permanecerão suspensas até reativadas.'});
            if(reply.response!==1)return;
            await pinPrevious(userData,resolveTemplate(__dirname,process.resourcesPath,true));
            app.relaunch();app.quit();
          }catch(error){log('Rollback rejected: '+error.message);}
        }},
        {label:'Retomar atualizações Dev',click:()=>{
          try {unpin(userData);void stageInBackground(userData,resolveTemplate(__dirname,process.resourcesPath,true));}
          catch(error){log('Update unpin failed: '+error.message);}
        }},
      ] : []),
      {type:'separator'},{role:'quit',label:'Sair'},
    ]},
    {label:'Desenvolvimento',submenu:[
      {label:'Ferramentas de desenvolvimento',accelerator:'Ctrl+Shift+I',
        click:()=>window?.webContents.toggleDevTools()},
    ]},
  ]));
}
function nativeBuiltAssetsFor(root, template) {
  // The build is generated from exactly the selected source revision.
  // Never show an old Desktop bundle as a freshly updated checkout.
  const built = app.isPackaged
    ? root===template ? join(template,'desktop-assets')
      : join(root,'out','windows-desktop-native')
    : process.env.ORDAX_DESKTOP_TEST_BUILT_ASSETS==='1'
      ? join(root,'out','windows-desktop-native') : null;
  if (!built) return null;
  if (app.isPackaged && root===template && !verifyBundledNativeReceipt(template,built))
    throw Error('Bundled Windows Native assets lack exact OS and Surface provenance');
  const html=join(built,'system','composition','native','index.html');
  if (!existsSync(html)) {
    if (app.isPackaged && root===template) throw Error('Packaged canonical Native bundle missing');
    return null;
  }
  return built;
}
const FILE_ROUTES=new Set([
  '/__ordax/native/files','/__ordax/native/trash',
  '/__ordax/native/file-content','/__ordax/native/file-import',
  '/__ordax/native/file-export','/__ordax/native/image-preview',
  '/__ordax/native/media-preview','/__ordax/native/document-preview',
]);
function authorizeDesktopFileRequests(browserWindow,base,fileToken,localSessionToken,nativeSessionToken,deviceProfileToken,stateToken) {
  const permittedOrigin=new URL(base).origin;
  // The secret never enters the renderer or a browser cookie. Only requests
  // from this trusted Surface's WebContents receive it; external Chromium
  // tabs never inherit the native file capability.
  browserWindow.webContents.session.webRequest.onBeforeSendHeaders(
    {urls:['http://127.0.0.1/*']},
    (details,callback)=>{
      const headers={...details.requestHeaders};
      // Strip any renderer-supplied fake grant first, even if the route is
      // untrusted. Only the owning Electron WebContents may receive secrets.
      for(const key of Object.keys(headers)){
        if(/^(x-ordax-file-token|x-ordax-local-session-token|x-ordax-session-token|x-ordax-device-profile-token|x-ordax-desktop-state-token)$/i.test(key))delete headers[key];
      }
      try {
        const target=new URL(details.url);
        const trusted=details.webContentsId===browserWindow.webContents.id &&
          target.origin===permittedOrigin;
        if(trusted && FILE_ROUTES.has(target.pathname))headers['X-OrdaX-File-Token']=fileToken;
        if(trusted && target.pathname==='/__ordax/native/local-session')
          headers['X-OrdaX-Local-Session-Token']=localSessionToken;
        if(trusted && target.pathname==='/__ordax/native/session')
          headers['X-OrdaX-Session-Token']=nativeSessionToken;
        if(trusted && target.pathname==='/__ordax/native/device-profile')
          headers['X-OrdaX-Device-Profile-Token']=deviceProfileToken;
        if(trusted && ['/__ordax/native/first-run','/__ordax/native/preferences',
                       '/__ordax/native/first-run-cursor'].includes(target.pathname))
          headers['X-OrdaX-Desktop-State-Token']=stateToken;
      } catch {}
      callback({requestHeaders:headers});
    }
  );
}
async function assertDesktopFileSpaceSmoke(browserWindow) {
  if(process.env.ORDAX_DESKTOP_FILE_SMOKE!=='1')return;
  const result=await browserWindow.webContents.executeJavaScript(
    "(async()=>{const paths=['/__ordax/native/files?path=%2F','/__ordax/native/trash'];"+
    "return Promise.all(paths.map(async p=>{const r=await fetch(p,{credentials:'same-origin',cache:'no-store'});"+
    "if(!r.ok)return {status:r.status};const data=await r.json();"+
    "return {status:r.status,entries:Array.isArray(data.entries),path:data.path??null};}));})()"
  );
  if(result.length!==2 || !result.every(x=>x.status===200 && x.entries) ||
     result[0].path!=='/') {
    throw Error('Canonical Windows Files were not accessible through Electron Surface');
  }
  log('DESKTOP_FILE_SPACE_SMOKE=PASS');
  const localSession=await browserWindow.webContents.executeJavaScript(
    "(async()=>{const r=await fetch('/__ordax/native/local-session',"+
    "{cache:'no-store',credentials:'same-origin'});"+
    "if(!r.ok)return {status:r.status};"+
    "const s=await r.json();return {status:r.status,...s};})()"
  );
  if(localSession.status!==200 || localSession.schema!=='ordax.local-session/1' ||
     localSession.state!=='unlocked' || localSession.credentialConfigured!==false ||
     localSession.protectionScope!=='surface-session-not-storage-encryption') {
    throw Error('Trusted Electron Surface cannot read canonical Windows local session');
  }
  log('DESKTOP_LOCAL_SESSION_TRUSTED_SURFACE_SMOKE=PASS');
  const diagnostic=await browserWindow.webContents.executeJavaScript(
    "(async()=>{const s=await fetch('/__ordax/native/session',"+
    "{credentials:'same-origin',cache:'no-store'});"+
    "if(!s.ok)return {sessionStatus:s.status};const payload=await s.json();"+
    "const sha=new URL(location.href).searchParams.get('source');"+
    "const r=await fetch('/__ordax/native/client-diagnostic',"+
    "{method:'POST',credentials:'same-origin',"+
    "headers:{'Content-Type':'application/json','X-OrdaX-Diagnostic-Token':payload.diagnosticToken},"+
    "body:JSON.stringify({sourceSha:sha,stage:'desktop-install-smoke',errorName:'Error',source:''})});"+
    "return {sessionStatus:s.status,reportStatus:r.status,sha,hasToken:typeof payload.diagnosticToken==='string'};})()"
  );
  if(diagnostic.sessionStatus!==200 || diagnostic.reportStatus!==204 ||
    diagnostic.hasToken!==true || !/^[0-9a-f]{40}$/.test(diagnostic.sha)) {
    throw Error('Trusted Electron Surface cannot submit a verified Native client diagnostic');
  }
  log('DESKTOP_NATIVE_DIAGNOSTIC_TRUSTED_SURFACE_SMOKE=PASS');
  const deviceProfile=await browserWindow.webContents.executeJavaScript(
    "(async()=>{const url='/__ordax/native/device-profile';"+
    "const first=await fetch(url,{cache:'no-store',credentials:'same-origin'});"+
    "if(!first.ok)return {readStatus:first.status};"+
    "const initial=await first.json();"+
    "const put=async name=>fetch(url,{method:'POST',credentials:'same-origin',"+
    "headers:{'Content-Type':'application/json'},"+
    "body:JSON.stringify({displayName:name})});"+
    "const renamed=await put('Desktop Teste');"+
    "if(!renamed.ok)return {readStatus:first.status,renameStatus:renamed.status};"+
    "const changed=await renamed.json();"+
    "const restored=await put(initial.displayName);"+
    "const final=restored.ok?await restored.json():{};"+
    "return {readStatus:first.status,renameStatus:renamed.status,"+
    "restoreStatus:restored.status,initial,changed,final};})()"
  );
  if(deviceProfile.readStatus!==200 || deviceProfile.renameStatus!==200 ||
    deviceProfile.restoreStatus!==200 ||
    !/^ordax-[0-9a-f]{32}$/.test(deviceProfile.initial?.devicePublicId??'') ||
    deviceProfile.changed?.displayName!=='Desktop Teste' ||
    deviceProfile.final?.displayName!==deviceProfile.initial?.displayName ||
    deviceProfile.final?.devicePublicId!==deviceProfile.initial?.devicePublicId) {
    throw Error('Trusted Electron Surface cannot read and rename canonical OrdaX device profile');
  }
  log('DESKTOP_DEVICE_PROFILE_TRUSTED_SURFACE_SMOKE=PASS');
  const privateState=await browserWindow.webContents.executeJavaScript(
    "(async()=>{const paths=['/__ordax/native/first-run',"+
    "'/__ordax/native/preferences','/__ordax/native/first-run-cursor'];"+
    "const values=await Promise.all(paths.map(async p=>{"+
    "const r=await fetch(p,{cache:'no-store',credentials:'same-origin'});"+
    "return {status:r.status,body:r.ok?await r.json():null};}));"+
    "return values.map(v=>({status:v.status,valid:v.body!==null}));})()"
  );
  if(privateState.length!==3 || !privateState.every(value=>value.status===200 && value.valid)){
    throw Error('Trusted Electron Surface cannot read canonical state with host authorization');
  }
  log('DESKTOP_PRIVATE_STATE_TRUSTED_SURFACE_SMOKE=PASS');
  const wlanRead=await browserWindow.webContents.executeJavaScript(
    "(async()=>{const session=await fetch('/__ordax/native/session',"+
    "{cache:'no-store',credentials:'same-origin'});"+
    "if(!session.ok)return {status:session.status};"+
    "const s=await session.json();"+
    "if(!/^[0-9a-f]{64}$/.test(s.networkToken??''))return {status:0};"+
    "const r=await fetch('/__ordax/native/network-management',"+
    "{cache:'no-store',credentials:'same-origin',headers:{'X-OrdaX-Network-Token':s.networkToken}});"+
    "return {status:r.status,snapshot:r.ok?await r.json():null};})()"
  );
  if(![200,503].includes(wlanRead.status) ||
    (wlanRead.status===200 &&
      (wlanRead.snapshot?.wifiInterface!==null ||
       wlanRead.snapshot?.unavailableReason!=='no-wlan-interface' ||
       wlanRead.snapshot?.networks?.length!==0 ||
       wlanRead.snapshot?.currentSsid!==null ||
       wlanRead.snapshot?.savedSsid!==null))) {
    throw Error('Installed Desktop WLAN discovery invents connectivity or bypasses the Native session');
  }
  log('DESKTOP_WLAN_DISCOVERY_TRUSTED_SURFACE_SMOKE=PASS');
}
async function assertNativeShellMounted(browserWindow) {
  const started=Date.now(),deadline=started+90000;
  let previous='';let last=null;
  while(Date.now()<deadline && !browserWindow.isDestroyed()) {
    const result=await browserWindow.webContents.executeJavaScript(
      "({count:document.querySelector('#ordax-root')?.childElementCount||0,"+
      "phase:document.querySelector('#ordax-boot-screen')?.dataset.state||'missing',"+
      "status:document.querySelector('[data-ordax-boot-status]')?.textContent?.slice(0,150)||'',"+
      "ready:document.readyState,script:!!document.querySelector('script[src]'),"+
      "milestone:document.documentElement.dataset.ordaxNativeMilestone||'module-not-evaluated',"+
      "resources:performance.getEntriesByType('resource').length,url:location.pathname})"
    );
    last=result;
    const current=[result.phase,result.count,result.status,result.ready,result.milestone,result.resources].join('|');
    if(current!==previous){
      log('Native mount observation '+Math.round((Date.now()-started)/1000)+'s: '+current.slice(0,280));
      previous=current;
    }
    if(result.phase==='error')throw Error('Canonical Native composition boot failed: '+result.status);
    if(result.count>0 && result.phase==='ready') {
      const bridge=await browserWindow.webContents.executeJavaScript(
        "typeof window.ordaxDesktopBrowser?.postMessage === 'function'"
      );
      if(!bridge)throw Error('OrdaX Native Internet browser bridge is unavailable');
      return true;
    }
    await new Promise(resolve=>setTimeout(resolve,450));
  }
  throw Error('Canonical Native composition not mounted within 90s; last='+JSON.stringify(last).slice(0,400));
}
// CI-only proof: the renderer sends the same typed command as Internet,
// and the isolated Chromium host must instantiate and close an actual view.
async function assertDesktopInternetSmoke(browserWindow,host) {
  if(process.env.ORDAX_DESKTOP_BROWSER_SMOKE!=='1')return;
  const id='ordax-ci-internet';
  await browserWindow.webContents.executeJavaScript(
    "window.ordaxDesktopBrowser.postMessage(JSON.stringify({type:'tab.open',tabId:'ordax-ci-internet',url:'about:blank'}))"
  );
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {
    const tabs=host.getSnapshot().tabs;
    if(tabs.some(tab=>tab.id===id && tab.url==='about:blank')) {
      await browserWindow.webContents.executeJavaScript(
        "window.ordaxDesktopBrowser.postMessage(JSON.stringify({type:'tab.close',tabId:'ordax-ci-internet'}))"
      );
      const closeDeadline=Date.now()+3000;
      while(Date.now()<closeDeadline) {
        if(!host.getSnapshot().tabs.some(tab=>tab.id===id)){
          log('DESKTOP_INTERNET_SMOKE=PASS');
          return;
        }
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error('Internet smoke tab did not close');
    }
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  throw Error('Canonical Internet bridge could not instantiate isolated Chromium tab');
}
async function stageInBackground(userData,template) {
  if(staging || !app.isPackaged) return;
  staging=true;
  try {
    const result=await stageMain({userData,template,log});
    if(result.status==='staged') log('Desktop Dev update prepared for the next application start: '+result.sha);
    else if(!['current','pending','pinned','rejected'].includes(result.status))
      log('Desktop Dev update check: '+result.status);
  }catch(error){log('Desktop Dev update check blocked: '+error.message);}
  finally{staging=false;}
}
app.on('before-quit',()=>{
  if(updateTimer){clearInterval(updateTimer);updateTimer=null;}
  browserHost?.dispose();browserHost=null;
  if(runtime?.child){stopHost(runtime.child);runtime=null;}
  stream?.end();stream=null;
});
app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{
  if(!primaryInstance)return;
  const userData=app.getPath('userData');
  mkdirSync(userData,{recursive:true});
  stream=createWriteStream(join(userData,'desktop.log'),{flags:'a'});
  window=new BrowserWindow({
    width:1350,height:820,minWidth:800,minHeight:570,
    title:'OrdaX OS Desktop Dev',backgroundColor:'#101820',
    webPreferences:{nodeIntegration:false,contextIsolation:true,
      preload:join(__dirname,'browser-preload.cjs'),
      sandbox:true,webSecurity:true,allowRunningInsecureContent:false},
  });
  // Electron 40 passes a single details event, not the legacy (event, level,
  // message) tuple. Without this, actual Native renderer errors were invisible.
  window.webContents.on('console-message',details=>{
    const value=String(details?.message??'').replace(/[\\r\\n]+/g,' ').trim();
    if(!value)return;
    if(Number(details?.level)>=2 ||
       /OrdaX native composition failed|Uncaught|TypeError|ReferenceError|failed/i.test(value)){
      log('renderer ['+String(details?.level??'unknown')+'] '+
        value.slice(0,900)+' @ '+String(details?.sourceId??'').slice(0,180)+
        ':'+String(details?.lineNumber??'?'));
    }
  });
  window.webContents.on('render-process-gone',(_event,details)=>{
    log('Renderer process gone: '+String(details?.reason||'unknown'));
  });
  menu(userData);
  browserHost=createDesktopBrowserHost({window,ipcMain,WebContentsView,session,dialog,log});
  window.webContents.on('page-title-updated',event=>{event.preventDefault();window?.setTitle('OrdaX OS Desktop Dev');});
  status('Iniciando a Surface Native compartilhada...');
  try{
    const fileToken=randomBytes(32).toString('hex');
    const localSessionToken=randomBytes(32).toString('hex');
    const nativeSessionToken=randomBytes(32).toString('hex');
    const diagnosticToken=randomBytes(32).toString('hex');
    const deviceProfileToken=randomBytes(32).toString('hex');
    const stateToken=randomBytes(32).toString('hex');
    const networkToken=randomBytes(32).toString('hex');
    const template=resolveTemplate(__dirname,process.resourcesPath,app.isPackaged);
    if(!existsSync(join(template,'tools','windows-emulator','dev-supervisor.mjs')))
      throw Error('Canonical OrdaX runtime snapshot missing');
    // Packaged startup never waits for Git/network or mutates a running checkout.
    // A staged source gets one trial; a missing health receipt rolls it back.
    const selected=app.isPackaged
      ? await chooseBootVersion({userData,template,log})
      : {root:template,sha:null,trial:false};
    // The exact installed OS SHA is already pinned by the verified Native
    // bundle receipt; update candidates use their validated Git SHA.
    const bundledSourceSha=app.isPackaged
      ? JSON.parse(readFileSync(join(template,'desktop-assets','source-provenance.json'),'utf8')).os_sha
      : '';
    if(app.isPackaged && !/^[0-9a-f]{40}$/.test(bundledSourceSha))
      throw Error('Packaged Desktop source provenance unavailable');
    const sourceOf=selection=>selection.sha??bundledSourceSha;
    const nativeUrl=(base,sha)=>base+PRODUCT+(sha?'?source='+sha:'');
    let root=selected.root;
    try {
      log(root===template?'Bundled OrdaX Surface':'Verified Git-managed OrdaX Surface');
      runtime=await startHost({root,stateDirectory:runtimeStateDirectory(userData),userData,log,fileToken,localSessionToken,nativeSessionToken,diagnosticToken,deviceProfileToken,stateToken,networkToken,sourceSha:sourceOf(selected),
         builtAssetsRoot:nativeBuiltAssetsFor(root,template)});
      authorizeDesktopFileRequests(window,runtime.url,fileToken,localSessionToken,nativeSessionToken,deviceProfileToken,stateToken);
      await window.loadURL(nativeUrl(runtime.url,sourceOf(selected)));
      await assertNativeShellMounted(window);
      await assertDesktopInternetSmoke(window,browserHost);
      await assertDesktopFileSpaceSmoke(window);
      log('Native shell mounted and ready: '+runtime.url);
      log('Native Surface ready: '+runtime.url);
      if(selected.trial) {
        confirmHealthy(userData,selected.sha);
        log('Desktop Dev candidate committed healthy: '+selected.sha);
      }
    } catch(error) {
      if(!selected.trial)throw error;
      log('Desktop Dev candidate health failed; reverting to known-good: '+error.message);
      rejectCandidate(userData,selected.sha);
      if(runtime?.child)stopHost(runtime.child);
      runtime=null;
      const fallback=await chooseBootVersion({userData,template,log});
      root=fallback.root;
      runtime=await startHost({root,stateDirectory:runtimeStateDirectory(userData),userData,log,fileToken,localSessionToken,nativeSessionToken,diagnosticToken,deviceProfileToken,stateToken,networkToken,sourceSha:sourceOf(fallback),
         builtAssetsRoot:nativeBuiltAssetsFor(root,template)});
      authorizeDesktopFileRequests(window,runtime.url,fileToken,localSessionToken,nativeSessionToken,deviceProfileToken,stateToken);
      await window.loadURL(nativeUrl(runtime.url,sourceOf(fallback)));
      await assertNativeShellMounted(window);
      await assertDesktopInternetSmoke(window,browserHost);
      await assertDesktopFileSpaceSmoke(window);
      log('Native shell mounted and ready after rollback: '+runtime.url);
      log('Native Surface ready after rollback: '+runtime.url);
    }
    navigationPolicy(runtime.url);
    if(app.isPackaged) {
      // Safe background discovery, never a startup dependency or live-tree merge.
      setTimeout(()=>{void stageInBackground(userData,template);},5000);
      updateTimer=setInterval(()=>{void stageInBackground(userData,template);},10*60*1000);
      updateTimer.unref?.();
    }

  }catch(error){
    log('Startup failed: '+error.message);
    status('Falha ao iniciar: '+error.message+'. Verifique os logs no menu OrdaX.');
  }
}).catch(e=>{log('Application failed: '+e.message);app.quit();});
