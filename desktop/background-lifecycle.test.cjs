'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createDesktopBackgroundLifecycle}=require('./background-lifecycle.cjs');

class FakeTray extends EventEmitter {
  constructor(icon){super();this.icon=icon;FakeTray.created.push(this)}
  setToolTip(value){this.tooltip=value}
  setContextMenu(value){if(FakeTray.failMenu)throw Error('synthetic tray menu failure');this.menu=value}
  destroy(){this.destroyed=true}
}
FakeTray.created=[];
function setup({ready=true,invalidIcon=false}={}){
  const state={ready,hidden:false,minimized:false,destroyed:false,focused:0,
    hides:0,shows:0,restores:0,quits:0,logs:[]};
  const window={
    isDestroyed:()=>state.destroyed,
    isMinimized:()=>state.minimized,
    isVisible:()=>!state.hidden,
    hide(){state.hides++;state.hidden=true},
    show(){state.shows++;state.hidden=false},
    restore(){state.restores++;state.minimized=false},
    focus(){state.focused++},
  };
  const Menu={buildFromTemplate:items=>items};
  const icon={isEmpty:()=>invalidIcon};
  const controller=createDesktopBackgroundLifecycle({
    Tray:FakeTray,Menu,icon,window,
    canContinue:()=>state.ready,
    requestQuit:()=>state.quits++,
    log:message=>state.logs.push(message),
  });
  return {controller,state,tray:FakeTray.created.at(-1)};
}

test('closing the visible healthy Desktop hides the SAME window, retaining Native MCP and Aura',()=>{
  const {controller,state,tray}=setup();
  let prevented=0;
  assert.equal(controller.close({preventDefault(){prevented++}}),true);
  assert.equal(prevented,1);
  assert.equal(state.hides,1);
  assert.equal(state.quits,0);
  assert.match(state.logs[0],/MCP/);
  assert.match(tray.tooltip,/Aura/);
  assert.equal(state.hidden,true);
  tray.emit('double-click');
  assert.equal(state.hidden,false);
  assert.equal(state.shows,1);
  assert.equal(state.focused,1);
  assert.equal(state.quits,0);
  controller.dispose();
});

test('the Windows tray exposes an explicit real Quit, not a second agent',()=>{
  const {controller,state,tray}=setup();
  assert.deepEqual(tray.menu.map(x=>x.label||x.type),
    ['Abrir OrdaX','separator','Encerrar OrdaX']);
  tray.menu[2].click();
  assert.equal(state.quits,1);
  assert.equal(state.hides,0);
  controller.dispose();
  assert.equal(tray.destroyed,true);
  assert.equal(controller.show(),false);
  assert.equal(controller.close({preventDefault(){throw Error('disposed')}}),false);
  controller.dispose();
});

test('native crash or failed startup must never hide an unusable Desktop',()=>{
  const {controller,state}=setup({ready:false});
  let prevented=0;
  assert.equal(controller.close({preventDefault(){prevented++}}),false);
  assert.equal(prevented,0);
  assert.equal(state.hides,0);
  state.ready=true;
  assert.equal(controller.close({}),false);
  assert.equal(state.hides,0);
  controller.dispose();
});

test('an existing hidden/minimized Desktop is restored by the same tray',()=>{
  const {controller,state,tray}=setup();
  state.hidden=true;
  state.minimized=true;
  tray.emit('click');
  assert.equal(state.restores,1);
  assert.equal(state.shows,1);
  assert.equal(state.focused,1);
  controller.dispose();
});

test('tray icon failure must never leave an invisible agent with no exit control',()=>{
  assert.throws(()=>setup({invalidIcon:true}),/valid Windows tray/);
});

test('a partially initialized Windows tray is destroyed before ordinary close fallback',()=>{
  FakeTray.failMenu=true;
  try{
    assert.throws(()=>setup(),/synthetic tray menu failure/);
    assert.equal(FakeTray.created.at(-1).destroyed,true);
  }finally{FakeTray.failMenu=false}
});

test('Electron integration preserves one Native owner and deliberate shutdown',()=>{
  const main=readFileSync(join(__dirname,'main.cjs'),'utf8');
  assert.match(main,/const \{ createDesktopBackgroundLifecycle \} = require\('\.\/background-lifecycle\.cjs'\)/);
  assert.match(main,/if\(!quitting && backgroundLifecycle\?\.close\(event\)\)return;/);
  assert.match(main,/if\(process\.platform==='win32' && app\.isPackaged && !devProfile\)/);
  assert.match(main,/nativeSurfaceMounted=true/);
  assert.match(main,/backgroundLifecycle\?\.dispose\(\)/);
  assert.match(main,/shutdownReason='tray-explicit-quit'/);
  assert.match(main,/app\.on\('before-quit'/);
  assert.match(main,/app\.on\('window-all-closed'/);
  assert.match(main,/backgroundThrottling:false/);
});
