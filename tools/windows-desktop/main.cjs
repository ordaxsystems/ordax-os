'use strict';
// Installable Windows host: the UI and Git Pull remain owned by OrdaX OS.
const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, shell, dialog } = require('electron');
const { createDesktopBrowserHost } = require('./browser-host.cjs');
const { join } = require('node:path');
const { mkdirSync, createWriteStream, existsSync } = require('node:fs');
const { resolveTemplate, runtimeStateDirectory } = require('./runtime.cjs');
const { chooseBootVersion, confirmHealthy, rejectCandidate, stageMain, readState, pinPrevious, unpin } = require('./dev-update.cjs');
const { startHost, stopHost } = require('./host.cjs');
let window=null, runtime=null, stream=null, browserHost=null, updateTimer=null, staging=false;
const PRODUCT='/system/composition/native/index.html';
// Explicit stable per-user storage must be set before the instance lock or any
// Electron internal service can resolve a path from the npm package name.
app.setName('OrdaX OS Desktop Dev');
const devProfile = !app.isPackaged && process.env.ORDAX_DESKTOP_TEST_PROFILE === '1';
const desktopUserData=join(app.getPath('appData'),devProfile ? 'OrdaX OS Desktop Dev Test' : 'OrdaX OS Desktop Dev');
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
    const template=resolveTemplate(__dirname,process.resourcesPath,app.isPackaged);
    if(!existsSync(join(template,'tools','windows-emulator','dev-supervisor.mjs')))
      throw Error('Canonical OrdaX runtime snapshot missing');
    // Packaged startup never waits for Git/network or mutates a running checkout.
    // A staged source gets one trial; a missing health receipt rolls it back.
    const selected=app.isPackaged
      ? await chooseBootVersion({userData,template,log})
      : {root:template,sha:null,trial:false};
    let root=selected.root;
    try {
      log(root===template?'Bundled OrdaX Surface':'Verified Git-managed OrdaX Surface');
      runtime=await startHost({root,stateDirectory:runtimeStateDirectory(userData),userData,log});
      await window.loadURL(runtime.url+PRODUCT);
      await assertNativeShellMounted(window);
      await assertDesktopInternetSmoke(window,browserHost);
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
      runtime=await startHost({root,stateDirectory:runtimeStateDirectory(userData),userData,log});
      await window.loadURL(runtime.url+PRODUCT);
      await assertNativeShellMounted(window);
      await assertDesktopInternetSmoke(window,browserHost);
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
