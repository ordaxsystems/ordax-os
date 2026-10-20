'use strict';
// Installable Windows host: the UI and Git Pull remain owned by OrdaX OS.
const { app, BrowserWindow, Menu, shell } = require('electron');
const { join } = require('node:path');
const { mkdirSync, createWriteStream, existsSync } = require('node:fs');
const { resolveTemplate, runtimeStateDirectory } = require('./runtime.cjs');
const { selectRuntime } = require('./checkout.cjs');
const { startHost, stopHost } = require('./host.cjs');
let window=null, runtime=null, stream=null;
const PRODUCT='/tools/windows-emulator/index.html';
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
      {type:'separator'},{role:'quit',label:'Sair'},
    ]},
    {label:'Desenvolvimento',submenu:[
      {label:'Ferramentas de desenvolvimento',accelerator:'Ctrl+Shift+I',
        click:()=>window?.webContents.toggleDevTools()},
    ]},
  ]));
}
app.on('before-quit',()=>{
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
    const root=await selectRuntime({isPackaged:app.isPackaged,userData,template,log});
    log(root===template?'Bundled OrdaX Surface':'Git-managed OrdaX Surface');
    runtime=await startHost({root,stateDirectory:runtimeStateDirectory(userData),log});
    navigationPolicy(runtime.url);
    await window.loadURL(runtime.url+PRODUCT);
    log('Native Surface ready: '+runtime.url);
  }catch(error){
    log('Startup failed: '+error.message);
    status('Falha ao iniciar: '+error.message+'. Verifique os logs no menu OrdaX.');
  }
}).catch(e=>{log('Application failed: '+e.message);app.quit();});
