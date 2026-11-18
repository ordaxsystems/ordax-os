import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
const TEST_HELPER=resolve("test-fixtures","ordax-win32-power.exe");
import { projectWindowsPowerStatus,readDesktopPowerStatus,createDesktopPowerStatusObservation } from "../system/adapters/desktop/power-status.mjs";

test("Win32 desktop without battery reports real AC but no fictional battery",()=>{
  assert.deepEqual(projectWindowsPowerStatus({acLineStatus:1,batteryFlag:128,batteryPercent:255}),
    {battery:null,externalPower:true});
});
test("Win32 laptop charging and discharging states are derived only from telemetry",()=>{
  assert.deepEqual(projectWindowsPowerStatus({acLineStatus:1,batteryFlag:8,batteryPercent:57}),
    {battery:{percent:57,state:"charging"},externalPower:true});
  assert.deepEqual(projectWindowsPowerStatus({acLineStatus:0,batteryFlag:2,batteryPercent:23}),
    {battery:{percent:23,state:"discharging"},externalPower:false});
});
test("Unknown AC/battery remain unknown, not invented",()=>{
  assert.deepEqual(projectWindowsPowerStatus({acLineStatus:255,batteryFlag:255,batteryPercent:255}),
    {battery:null,externalPower:null});
});
test("Power status cannot silently become Linux mock or accept corrupt data",async()=>{
  assert.throws(()=>projectWindowsPowerStatus({acLineStatus:5,batteryFlag:-1,batteryPercent:257}),TypeError);
  await assert.rejects(()=>readDesktopPowerStatus({platform:"linux"}),/Windows/);
  await assert.rejects(()=>readDesktopPowerStatus({platform:"win32",helperPath:""}),/Verified/);
  await assert.rejects(()=>readDesktopPowerStatus({platform:"win32",helperPath:resolve("test-fixtures","powershell.exe")}),/Verified/);
  await assert.rejects(()=>readDesktopPowerStatus({platform:"win32",helperPath:TEST_HELPER,run:async()=>({stdout:"not telemetry"})}),/invalid/);
  await assert.rejects(()=>readDesktopPowerStatus({platform:"win32",helperPath:TEST_HELPER,run:async()=>{throw Error("PowerLineStatus unavailable");}}),/PowerLineStatus unavailable/);
});
test("Native service only uses real Win32 result and is bounded",async()=>{
  let observed;
  const reading=await readDesktopPowerStatus({platform:"win32",helperPath:TEST_HELPER,
    run:async(file,args,options)=>{
      observed={file,args,options};return {stdout:"1,128,255\r\n"};
    }});
  assert.equal(observed.file,TEST_HELPER);
  assert.deepEqual(observed.args,[],"Windows helper never receives user arguments");
  assert.equal(observed.options.timeout,8000);
  assert.equal(observed.options.shell,false);
  assert.equal(observed.options.maxBuffer,128);
  assert.deepEqual(reading,{battery:null,externalPower:true});
});

test("Windows power bootstrap starts one real sample for simultaneous consumers",async()=>{
  let now=1000, calls=0, complete;
  const observer=createDesktopPowerStatusObservation({
    readSnapshot:()=>{calls++;return new Promise(resolve=>{complete=resolve;});},
    now:()=>now,maxAgeMs:2000,
  });
  observer.warm();
  const first=observer.read(), second=observer.read();
  await Promise.resolve();
  assert.equal(calls,1,"boot warmup and concurrent Surface GETs share one subprocess");
  complete({battery:null,externalPower:true});
  assert.deepEqual(await first,{battery:null,externalPower:true});
  assert.deepEqual(await second,{battery:null,externalPower:true});
  assert.deepEqual(await observer.read(),{battery:null,externalPower:true});
  assert.equal(calls,1,"validated sample stays fresh for at most two seconds");
  now+=2001;
  const changed=observer.read();
  await Promise.resolve();
  assert.equal(calls,2,"expired telemetry always fetches a real new observation");
  complete({battery:{percent:66,state:"charging"},externalPower:true});
  assert.deepEqual(await changed,{battery:{percent:66,state:"charging"},externalPower:true});
});

test("Windows power failures and invalid samples are never cached",async()=>{
  let calls=0, now=0;
  const observer=createDesktopPowerStatusObservation({
    readSnapshot:async()=>{
      calls++;
      if(calls===1)throw new Error("Win32 helper unavailable");
      if(calls===2)return {battery:{percent:250,state:"charging"},externalPower:true};
      return {battery:null,externalPower:null};
    },now:()=>now,maxAgeMs:2000,
  });
  await assert.rejects(observer.read(),/Win32 helper unavailable/);
  await assert.rejects(observer.read(),/percent|power|battery|Invalid/i);
  assert.equal(calls,2);
  assert.deepEqual(await observer.read(),{battery:null,externalPower:null});
  assert.equal(calls,3,"unknown telemetry is valid but never invented");
  now=2001;
  assert.deepEqual(await observer.read(),{battery:null,externalPower:null});
  assert.equal(calls,4);
  assert.throws(()=>createDesktopPowerStatusObservation({maxAgeMs:10001}),TypeError);
});
