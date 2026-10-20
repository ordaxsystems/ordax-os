'use strict';
// Installable Windows host: the UI and Git Pull remain owned by OrdaX OS.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { join } = require('node:path');
const { mkdirSync, createWriteStream, existsSync } = require('node:fs');
const { resolveTemplate, runtimeStateDirectory } = require('./runtime.cjs');
const { chooseBootVersion, confirmHealthy, rejectCandidate, stageMain, readState, pinPrevious, unpin } = require('./dev-update.cjs');
const { startHost, stopHost } = require('./host.cjs');
let window=null, runtime=null, stream=null, updateTimer=null, staging=false;
const PRODUCT='/system/composition/native/index.html';
app.setName('OrdaX OS Desktop Dev');
if (process.platform==='win32') app.setAppUserModelId('dev.ordax.os.desktop');
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
  if(runtime?.child){stopHost(runtime.child);runtime=null;}
  stream?.end();stream=null;
});
app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{
  const userData=app.getPath('userData');
  mkdirSync(userData,{recursive:true});
  stream=createWriteStream(join(userData,'desktop.log'),{flags:'a'});
  window=new BrowserWindow({
    width:1350,height:820,minWidth:800,minHeight:570,
    title:'OrdaX OS Desktop Dev',backgroundColor:'#101820',
    webPreferences:{nodeIntegration:false,contextIsolation:true,
      sandbox:true,webSecurity:true,allowRunningInsecureContent:false},
  });
  menu(userData);
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
      runtime=await startHost({root,stateDirectory:runtimeStateDirectory(userData),log});
      await window.loadURL(runtime.url+PRODUCT);
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
      runtime=await startHost({root,stateDirectory:runtimeStateDirectory(userData),log});
      await window.loadURL(runtime.url+PRODUCT);
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
