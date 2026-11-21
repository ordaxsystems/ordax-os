'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,readFileSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {resolveDesktopWindowLayout,desktopMinimumWindowSize,
  reconcileDesktopWindowDisplayChange,
  readDesktopWindowLayout,readDesktopWindowPreference,
  fitDesktopWindowPreference,saveDesktopWindowLayout,
  createDesktopWindowLayoutPersistence}=require('./window-layout.cjs');
const areas=[{x:0,y:0,width:1920,height:1080}];
const layout=(bounds,maximized=false)=>({
  schema:'ordax.desktop-window-layout/1',bounds,maximized,
});
test('first Desktop window is centered and fits the current monitor',()=>{
  assert.deepEqual(resolveDesktopWindowLayout(areas),{
    bounds:{x:285,y:130,width:1350,height:820},maximized:false,
  });
  const narrow=resolveDesktopWindowLayout([{x:20,y:30,width:1024,height:680}]);
  assert.deepEqual(narrow.bounds,{x:20,y:30,width:1024,height:680});
});
test('small displays and remote sessions keep the Electron window fully accessible',()=>{
  const remote=resolveDesktopWindowLayout([{x:30,y:20,width:640,height:480}]);
  assert.deepEqual(remote.bounds,{x:30,y:20,width:640,height:480});
  assert.deepEqual(desktopMinimumWindowSize(remote.bounds),{
    minWidth:640,minHeight:480,
  });
  assert.deepEqual(desktopMinimumWindowSize({width:1350,height:820}),{
    minWidth:800,minHeight:570,
  });
});
test('hot-unplug and RDP topology change recover only genuinely stranded windows',()=>{
  const second={x:-1600,y:0,width:1600,height:900};
  const primary={x:0,y:0,width:1920,height:1080};
  const onSecondary={x:-1300,y:80,width:1100,height:700};
  assert.equal(reconcileDesktopWindowDisplayChange([primary,second],onSecondary),null,
    'a valid second monitor must not be forcibly recentered');
  assert.deepEqual(reconcileDesktopWindowDisplayChange([primary],onSecondary),{
    x:410,y:190,width:1100,height:700,
  },'a disconnected monitor cannot strand the window');
  const onPrimary={x:200,y:120,width:1100,height:700};
  assert.equal(reconcileDesktopWindowDisplayChange([primary],onPrimary),null);
  assert.equal(reconcileDesktopWindowDisplayChange([],onSecondary),null,
    'unknown monitor topology must not change state');
  const rdp={x:0,y:0,width:640,height:480};
  assert.deepEqual(reconcileDesktopWindowDisplayChange([rdp],{
    x:260,y:150,width:1250,height:850,
  }),rdp,'remote-screen shrink clips and repositions the window');
  assert.equal(reconcileDesktopWindowDisplayChange([primary],{
    x:1500,y:190,width:800,height:600,
  })?.x,1120,'window mostly outside desktop is pulled back into view');
  assert.equal(reconcileDesktopWindowDisplayChange([primary],{
    x:40,y:40,width:1400,height:850,
  }),null,'normal user positioning must not be disturbed');
  assert.deepEqual(reconcileDesktopWindowDisplayChange([primary],{
    x:80,y:-25,width:1100,height:700,
  }),{x:80,y:0,width:1100,height:700},
  'an inaccessible title bar is recovered even when most content is visible');
  assert.equal(reconcileDesktopWindowDisplayChange([primary],{
    x:0,y:0,width:0,height:850,
  }),null,'invalid geometry cannot be passed to Electron');
});
test('existing window geometry and maximized state are preserved within display',()=>{
  assert.deepEqual(resolveDesktopWindowLayout(areas,layout({
    x:310,y:120,width:1024,height:720,
  },true)),{
    bounds:{x:310,y:120,width:1024,height:720},maximized:true,
  });
});
test('moving or unplugging a monitor never restores an inaccessible window',()=>{
  const screens=[{x:-1600,y:0,width:1600,height:900},
    {x:0,y:0,width:1920,height:1080}];
  const retained=resolveDesktopWindowLayout(screens,layout({
    x:-1100,y:120,width:1100,height:720,
  }));
  assert.equal(retained.bounds.x,-1100);
  assert.deepEqual(resolveDesktopWindowLayout(areas,layout({
    x:-1450,y:120,width:1100,height:720,
  })).bounds,{x:285,y:130,width:1350,height:820});
  const clamped=resolveDesktopWindowLayout(areas,layout({
    x:1820,y:990,width:1100,height:720,
  }));
  assert.equal(clamped.bounds.x,820);
  assert.equal(clamped.bounds.y,360);
});
test('corrupt, incomplete, or impossible window geometry never escapes to Electron',()=>{
  for(const invalid of [
    null,{},layout({x:0,y:0,width:-1,height:720}),
    layout({x:NaN,y:0,width:1000,height:700}),
    layout({x:0,y:0,width:1000,height:700},'yes'),
    {...layout({x:0,y:0,width:1000,height:700}),schema:'unknown'},
  ])assert.deepEqual(resolveDesktopWindowLayout(areas,invalid).bounds,{
    x:285,y:130,width:1350,height:820,
  });
  assert.deepEqual(resolveDesktopWindowLayout([]).bounds,{
    width:1350,height:820,
  });
});
test('Electron shell and packaged installer use the same window layout authority',()=>{
  const main=readFileSync(join(__dirname,'main.cjs'),'utf8');
  const pkg=JSON.parse(readFileSync(join(__dirname,'package.json'),'utf8'));
  assert.match(main,/readDesktopWindowLayout\(userData,/);
  assert.match(main,/screen\.getAllDisplays\(\)/);
  assert.match(main,/screen\.getPrimaryDisplay\(\)/,
    'fresh windows should center on the actual primary monitor');
  assert.match(main,/screen\.on\(event,onDisplayChange\)/);
  assert.match(main,/screen\.removeListener\(event,onDisplayChange\)/,
    'display listener must be released when Electron closes');
  assert.match(main,/reconcileDesktopWindowDisplayChange\(areas,/);
  assert.match(main,/window\.setBounds\(target,false\)/,
    'screen topology must reposition only the existing Electron window');
  assert.match(main,/desktopMinimumWindowSize\(savedWindow\.bounds\)/,
    'RDP and small displays must lower Electron minimum size to work area');
  assert.match(main,/createDesktopWindowLayoutPersistence\(\{/);
  assert.match(main,/geometry\.markDisplayAdjustment\(savedWindow\.bounds\)/);
  assert.match(main,/fitDesktopWindowPreference\(areas,geometry\.getPreferredBounds\(\)\)/);
  assert.match(main,/geometry\.markDisplayAdjustment\(target\)/);
  assert.match(main,/window\.on\(event,geometry\.schedule\)/);
  assert.match(main,/window\.getNormalBounds\(\)/);
  assert.match(main,/window\.isMaximized\(\)/);
  assert.ok(pkg.build.files.includes('window-layout.cjs'),
    'packaged Desktop must include the same local geometry owner');
});
test('window moves debounce disk writes and survive an unexpected quit',t=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-window-autosave-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const timers=new Set();
  let bounds={x:100,y:90,width:1100,height:680};
  let maximized=false;
  const persist=createDesktopWindowLayoutPersistence({
    userData:root,
    getNormalBounds:()=>bounds,
    isMaximized:()=>maximized,
    setTimeoutImpl:(fn,delay)=>{
      assert.equal(delay,500);
      const timer={fn,unref(){}};
      timers.add(timer);
      return timer;
    },
    clearTimeoutImpl:timer=>{timers.delete(timer)},
  });
  persist.schedule();
  bounds={x:180,y:120,width:1120,height:700};
  persist.schedule();
  assert.equal(timers.size,1,'rapid moves retain only one write');
  assert.equal(readDesktopWindowLayout(root,areas).bounds.x,285,
    'no file write during active drag');
  const timer=[...timers][0];timers.delete(timer);timer.fn();
  assert.deepEqual(readDesktopWindowLayout(root,areas).bounds,bounds,
    'last stable geometry is durable without a normal application exit');
  maximized=true;
  persist.schedule();
  assert.equal(persist.close(),true);
  assert.equal(timers.size,0);
  assert.equal(readDesktopWindowLayout(root,areas).maximized,true);
  persist.schedule();
  assert.equal(timers.size,0,'closed window cannot schedule further writes');
  assert.equal(persist.close(),false);
});
test('RDP shrink preserves preferred Desktop geometry and restores it on expansion',t=>{
  const userData=mkdtempSync(join(tmpdir(),'ordax-remote-window-preference-'));
  t.after(()=>rmSync(userData,{recursive:true,force:true}));
  const preferred={x:260,y:150,width:1250,height:850};
  const rdp=[{x:0,y:0,width:640,height:480}];
  assert.equal(saveDesktopWindowLayout(userData,preferred,false),true);
  assert.deepEqual(readDesktopWindowPreference(userData),preferred);
  const compact=readDesktopWindowLayout(userData,rdp).bounds;
  assert.deepEqual(compact,{x:0,y:0,width:640,height:480});
  let bounds={...compact},maximized=false;
  const pending=new Set();
  const geometry=createDesktopWindowLayoutPersistence({
    userData,preferredBounds:readDesktopWindowPreference(userData),
    getNormalBounds:()=>bounds,isMaximized:()=>maximized,
    setTimeoutImpl:fn=>{const timer={fn,unref(){}};pending.add(timer);return timer;},
    clearTimeoutImpl:timer=>{pending.delete(timer)},
  });
  const flush=()=>{for(const timer of [...pending]){pending.delete(timer);timer.fn();}};
  geometry.markDisplayAdjustment(compact);
  geometry.schedule();
  flush();
  assert.deepEqual(readDesktopWindowPreference(userData),preferred,
    'startup on a 640x480 RDP session cannot replace the saved 1250x850 size');
  assert.equal(geometry.isDisplayAdjusted(),true);
  assert.deepEqual(geometry.getPreferredBounds(),preferred);
  assert.deepEqual(fitDesktopWindowPreference(rdp,preferred),compact);
  assert.deepEqual(fitDesktopWindowPreference(areas,preferred),preferred,
    'larger restored monitor can return to the exact preferred position');
  const toRestore=fitDesktopWindowPreference(areas,geometry.getPreferredBounds());
  geometry.markDisplayAdjustment(toRestore);
  bounds={...toRestore};
  geometry.schedule();flush();
  assert.deepEqual(readDesktopWindowPreference(userData),preferred);
  assert.equal(geometry.close(),true);
  assert.deepEqual(readDesktopWindowPreference(userData),preferred,
    'normal window close must also keep the preferred layout');
});
test('user resize after automatic RDP clamp becomes new preference',t=>{
  const userData=mkdtempSync(join(tmpdir(),'ordax-remote-user-resize-'));
  t.after(()=>rmSync(userData,{recursive:true,force:true}));
  const original={x:250,y:130,width:1250,height:820};
  const auto={x:0,y:0,width:640,height:480};
  const chosen={x:20,y:30,width:600,height:420};
  let bounds={...original};
  const timers=new Set();
  const geometry=createDesktopWindowLayoutPersistence({
    userData,getNormalBounds:()=>bounds,isMaximized:()=>false,
    setTimeoutImpl:fn=>{const timer={fn,unref(){}};timers.add(timer);return timer;},
    clearTimeoutImpl:timer=>timers.delete(timer),
  });
  geometry.markDisplayAdjustment(auto);
  bounds={...auto};geometry.schedule();
  assert.deepEqual(geometry.getPreferredBounds(),original);
  bounds={...chosen};geometry.schedule();
  assert.equal(geometry.isDisplayAdjusted(),false);
  assert.equal(geometry.close(),true);
  assert.deepEqual(readDesktopWindowPreference(userData),chosen,
    'a deliberate user resize supersedes the old RDP preference');
  assert.equal(timers.size,0);
  assert.equal(fitDesktopWindowPreference(areas,{x:-1400,y:80,width:1000,height:650}),null,
    'disconnected monitor preference must not yank the current window away');
});
test('window state persists only to its current Desktop user profile',t=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-window-layout-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bounds={x:300,y:220,width:1200,height:690};
  assert.equal(saveDesktopWindowLayout(root,bounds,true),true);
  assert.deepEqual(readDesktopWindowLayout(root,areas),{
    bounds,maximized:true,
  });
  const record=JSON.parse(readFileSync(join(root,'desktop-window-layout.json'),'utf8'));
  assert.equal(record.schema,'ordax.desktop-window-layout/1');
  assert.deepEqual(record.bounds,bounds);
  assert.equal(saveDesktopWindowLayout(root,{...bounds,width:-10},false),false);
  assert.deepEqual(readDesktopWindowLayout(root,areas).bounds,bounds);
  writeFileSync(join(root,'desktop-window-layout.json'),'not valid JSON');
  assert.equal(readDesktopWindowLayout(root,areas).maximized,false);
  assert.deepEqual(readDesktopWindowLayout(root,areas).bounds,{
    x:285,y:130,width:1350,height:820,
  });
});
