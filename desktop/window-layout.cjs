'use strict';
// Desktop-window geometry is Electron-owned. Surface owns only its own responsive UI.
const {join}=require('node:path');
const {readFileSync,writeFileSync,renameSync,rmSync}=require('node:fs');
const FILE='desktop-window-layout.json';
const SCHEMA='ordax.desktop-window-layout/1';
const MIN_WIDTH=800,MIN_HEIGHT=570,DEFAULT_WIDTH=1350,DEFAULT_HEIGHT=820;
const integer=n=>Number.isSafeInteger(n);
const validRect=r=>r&&typeof r==='object'&&
  ['x','y','width','height'].every(k=>integer(r[k]))&&r.width>0&&r.height>0;
function intersection(a,b){
  if(!validRect(a)||!validRect(b))return 0;
  return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*
    Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
}
function resolveDesktopWindowLayout(areas,stored=null){
  const monitors=Array.isArray(areas)?areas.filter(validRect):[];
  const saved=stored?.schema===SCHEMA&&validRect(stored.bounds)&&
    typeof stored.maximized==='boolean'?stored:null;
  const previous=saved?.bounds??null;
  if(monitors.length===0)return Object.freeze({
    bounds:Object.freeze({width:DEFAULT_WIDTH,height:DEFAULT_HEIGHT}),
    maximized:false,
  });
  const best=previous
    ? monitors.reduce((winner,area)=>intersection(previous,area)>
        intersection(previous,winner)?area:winner,monitors[0])
    : monitors[0];
  const overlaps=previous&&intersection(previous,best)>0;
  const requested=overlaps?previous:{width:DEFAULT_WIDTH,height:DEFAULT_HEIGHT};
  const width=Math.max(1,Math.min(best.width,Math.max(MIN_WIDTH,requested.width)));
  const height=Math.max(1,Math.min(best.height,Math.max(MIN_HEIGHT,requested.height)));
  const x=overlaps
    ?Math.max(best.x,Math.min(previous.x,best.x+best.width-width))
    :best.x+Math.floor((best.width-width)/2);
  const y=overlaps
    ?Math.max(best.y,Math.min(previous.y,best.y+best.height-height))
    :best.y+Math.floor((best.height-height)/2);
  return Object.freeze({
    bounds:Object.freeze({x,y,width,height}),
    maximized:saved?.maximized===true,
  });
}
function desktopMinimumWindowSize(bounds){
  // On 640x480 RDP or a reduced-screen remote session, Electron's default
  // 800x570 minimum would force the window partly outside the visible area.
  const width=integer(bounds?.width)&&bounds.width>0?bounds.width:MIN_WIDTH;
  const height=integer(bounds?.height)&&bounds.height>0?bounds.height:MIN_HEIGHT;
  return Object.freeze({
    minWidth:Math.min(MIN_WIDTH,width),
    minHeight:Math.min(MIN_HEIGHT,height),
  });
}
// Monitor hot-unplug/RDP topology changes can strand a live window offscreen.
// Leave ordinary intentional multi-display placement alone while its title
// bar and most of its content remain reachable. Return only a needed move.
function reconcileDesktopWindowDisplayChange(areas,bounds){
  if(!validRect(bounds))return null;
  const monitors=Array.isArray(areas)?areas.filter(validRect):[];
  if(!monitors.length)return null;
  const titleBar={x:bounds.x,y:bounds.y,width:bounds.width,
    height:Math.min(44,bounds.height)};
  const area=bounds.width*bounds.height;
  const exposed=Math.min(area,monitors.reduce((sum,screen)=>
    sum+intersection(bounds,screen),0));
  const titleReachable=monitors.some(screen=>{
    const visibleWidth=Math.max(0,Math.min(
      titleBar.x+titleBar.width,screen.x+screen.width)-
      Math.max(titleBar.x,screen.x));
    const visibleHeight=Math.max(0,Math.min(
      titleBar.y+titleBar.height,screen.y+screen.height)-
      Math.max(titleBar.y,screen.y));
    // Large window width cannot compensate for an unreachable title bar.
    return visibleWidth>=Math.min(160,bounds.width)&&
      visibleHeight>=Math.min(34,bounds.height);
  });
  if(exposed>=area*0.75&&titleReachable)return null;
  // Preserve the user's chosen size when moving from an unplugged
  // secondary monitor: cold-start fallback defaults are not appropriate.
  const best=monitors.reduce((winner,screen)=>
    intersection(bounds,screen)>intersection(bounds,winner)
      ?screen:winner,monitors[0]);
  const width=Math.min(best.width,Math.max(MIN_WIDTH,bounds.width));
  const height=Math.min(best.height,Math.max(MIN_HEIGHT,bounds.height));
  const overlaps=intersection(bounds,best)>0;
  const next={
    x:overlaps?Math.max(best.x,Math.min(bounds.x,best.x+best.width-width))
      :best.x+Math.floor((best.width-width)/2),
    y:overlaps?Math.max(best.y,Math.min(bounds.y,best.y+best.height-height))
      :best.y+Math.floor((best.height-height)/2),
    width,height,
  };
  if(['x','y','width','height'].every(key=>next[key]===bounds[key]))return null;
  return Object.freeze(next);
}
// Keep the user's requested rectangle separately from the transient
// work-area clamp. A remote login can start at 640x480 while the saved
// preference is 1250x850; it must survive that initial boot and resize.
function readDesktopWindowPreference(userData){
  try{
    const record=JSON.parse(readFileSync(join(userData,FILE),'utf8'));
    if(record?.schema===SCHEMA && validRect(record.bounds) &&
       typeof record.maximized==='boolean')return Object.freeze({...record.bounds});
  }catch{}
  return null;
}
// Restore only when the preferred monitor's work area actually intersects
// its old position. A disconnected secondary must not recenter the user on
// an unrelated monitor every time DPI or RDP topology updates.
function fitDesktopWindowPreference(areas,preferred){
  if(!validRect(preferred) || !Array.isArray(areas) ||
     !areas.some(area=>intersection(area,preferred)>0))return null;
  return resolveDesktopWindowLayout(areas,{
    schema:SCHEMA,bounds:preferred,maximized:false,
  }).bounds;
}
function readDesktopWindowLayout(userData,areas){
  let stored=null;
  try{stored=JSON.parse(readFileSync(join(userData,FILE),'utf8'))}catch{}
  return resolveDesktopWindowLayout(areas,stored);
}
function saveDesktopWindowLayout(userData,bounds,maximized){
  if(!validRect(bounds)||typeof maximized!=='boolean')return false;
  const path=join(userData,FILE);
  const tmp=path+'.tmp';
  try{
    writeFileSync(tmp,JSON.stringify({schema:SCHEMA,bounds:{
      x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,
    },maximized})+'\n',{encoding:'utf8',flag:'w',mode:0o600});
    renameSync(tmp,path);
    return true;
  }catch{
    try{rmSync(tmp,{force:true})}catch{}
    return false;
  }
}
// Window moves/resizes are frequent; persist only once after a quiet period.
// This also preserves the layout after an unexpected Electron shutdown.
function createDesktopWindowLayoutPersistence({
  userData,getNormalBounds,isMaximized,preferredBounds=null,
  setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout,
}={}){
  if(typeof userData!=='string'||!userData||
     typeof getNormalBounds!=='function'||typeof isMaximized!=='function'||
     typeof setTimeoutImpl!=='function'||typeof clearTimeoutImpl!=='function')
    throw new TypeError('Desktop window layout requires one owning window');
  let timer=null,closed=false;
  // A temporary screen clamp is presentation, not a user resize. Keep the
  // last intentional rectangle for persistence, restart and RDP restoration.
  let preferred=validRect(preferredBounds)?{...preferredBounds}:null;
  let adjusted=null;
  const same=(a,b)=>a&&b&&
    ['x','y','width','height'].every(key=>a[key]===b[key]);
  const persist=()=>{
    try{return saveDesktopWindowLayout(userData,preferred??getNormalBounds(),isMaximized())}
    catch{return false}
  };
  const schedule=()=>{
    if(closed)return;
    const current=getNormalBounds();
    if(validRect(current) && !same(current,adjusted)){
      // A real user move/resize after an RDP clamp intentionally replaces
      // the old preference; a setBounds event for the clamp does not.
      preferred={...current};
      adjusted=null;
    }
    if(timer!==null)clearTimeoutImpl(timer);
    timer=setTimeoutImpl(()=>{
      timer=null;
      if(!closed)persist();
    },500);
    timer?.unref?.();
  };
  const markDisplayAdjustment=target=>{
    if(closed||!validRect(target))return;
    if(!preferred){
      const current=getNormalBounds();
      if(validRect(current))preferred={...current};
    }
    adjusted={...target};
  };
  const getPreferredBounds=()=>preferred?Object.freeze({...preferred}):null;
  const isDisplayAdjusted=()=>adjusted!==null;
  const close=()=>{
    if(closed)return false;
    closed=true;
    if(timer!==null){clearTimeoutImpl(timer);timer=null}
    return persist();
  };
  return Object.freeze({
    schedule,markDisplayAdjustment,getPreferredBounds,isDisplayAdjusted,close,
  });
}
module.exports={
  resolveDesktopWindowLayout,desktopMinimumWindowSize,
  reconcileDesktopWindowDisplayChange,
  readDesktopWindowLayout,readDesktopWindowPreference,
  fitDesktopWindowPreference,saveDesktopWindowLayout,
  createDesktopWindowLayoutPersistence,
};
