import test from "node:test";
import assert from "node:assert/strict";
import { projectWindowsPowerStatus,readDesktopPowerStatus } from "../system/adapters/desktop/power-status.mjs";

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
  await assert.rejects(()=>readDesktopPowerStatus({platform:"win32",run:async()=>({stdout:"not telemetry"})}),/invalid/);
  await assert.rejects(()=>readDesktopPowerStatus({platform:"win32",run:async()=>{throw Error("PowerLineStatus unavailable");}}),/PowerLineStatus unavailable/);
});
test("Native service only uses real Win32 result and is bounded",async()=>{
  let observed;
  const reading=await readDesktopPowerStatus({platform:"win32",run:async(file,args,options)=>{
    observed={file,args,options};return {stdout:"1,128,255\r\n"};
  }});
  assert.equal(observed.file,"powershell.exe");
  assert.equal(observed.options.timeout,7000);
  const script=observed.args.at(-1);
  assert.match(script,/System\.Windows\.Forms\.SystemInformation/);
  assert.doesNotMatch(script,/Add-Type -TypeDefinition|DllImport|New-Object OrdaXPowerStatus/);
  assert.match(script,/BatteryChargeStatus/);
  assert.deepEqual(reading,{battery:null,externalPower:true});
});
