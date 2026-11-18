// Actual Windows power telemetry, never Linux ACPI emulation.
// GetSystemPowerStatus reports battery presence and AC mains independently.
// Unknown values remain unknown; the app cannot infer them from a desktop PC.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, isAbsolute } from "node:path";
import { validatePowerStatusSnapshot } from "../../contracts/power-status.mjs";
const execute = promisify(execFile);
// The installed Desktop shell provides an attested, short-lived Win32 reader.
// No PowerShell, Node native addon or runtime compilation. The OS remains the
// sole owner of interpreting raw AC/battery telemetry into the public contract.
export function projectWindowsPowerStatus({acLineStatus,batteryFlag,batteryPercent}) {
  if (![acLineStatus,batteryFlag,batteryPercent].every(x=>Number.isInteger(x) && x>=0 && x<=255)) {
    throw new TypeError("Invalid Win32 power telemetry");
  }
  const externalPower=acLineStatus===1?true:acLineStatus===0?false:null;
  // BatteryFlag 128 denotes no system battery (255 denotes unknown).
  const batteryPresent=(batteryFlag!==255 && (batteryFlag & 128)===0);
  const battery=(batteryPresent && batteryPercent<=100) ? {
    percent:batteryPercent,
    state:(batteryFlag & 8)!==0?"charging":
      externalPower===false?"discharging":
      externalPower===true && batteryPercent===100?"full":
      externalPower===true?"not-charging":"unknown",
  } : null;
  return validatePowerStatusSnapshot({battery,externalPower});
}
export async function readDesktopPowerStatus({
  run=execute,platform=process.platform,
  helperPath=process.env.ORDAX_DESKTOP_POWER_HELPER,
}={}) {
  if(platform!=="win32") throw new Error("Windows power service requires Windows");
  // Set solely by the installed Electron owner after its stage-manifest check.
  // A missing helper must remain unavailable, never become a synthetic battery
  // or silently start a PowerShell interpreter on the user's desktop.
  if(typeof helperPath!=="string"||!isAbsolute(helperPath)||
     basename(helperPath).toLowerCase()!=="ordax-win32-power.exe")
    throw new Error("Verified Desktop Win32 power helper unavailable");
  const {stdout}=await run(helperPath,[],{
    timeout:8000,windowsHide:true,shell:false,maxBuffer:128,
  });
  const match=String(stdout).trim().match(/^(\d{1,3}),(\d{1,3}),(\d{1,3})$/);
  if(!match)throw new Error("Windows power status output invalid");
  return projectWindowsPowerStatus({
    acLineStatus:Number(match[1]),batteryFlag:Number(match[2]),batteryPercent:Number(match[3]),
  });
}

// One owner for concurrent Surface observations. Starting the first sample
// before the renderer mounts avoids competing Win32 helper cold starts
// competing on Windows. Only a fresh, validated sample is reusable; failures
// never become an invented battery or an indefinitely stale response.
export function createDesktopPowerStatusObservation({
  readSnapshot=readDesktopPowerStatus, now=Date.now, maxAgeMs=2000,
}={}) {
  if(typeof readSnapshot!=="function" || typeof now!=="function" ||
     !Number.isSafeInteger(maxAgeMs) || maxAgeMs<0 || maxAgeMs>10000)
    throw new TypeError("Windows power observation needs a reader, clock and bounded freshness");
  let sample=null, inflight=null;
  const read=()=>{
    const current=now();
    if(sample && current>=sample.at && current-sample.at<=maxAgeMs)
      return Promise.resolve(sample.value);
    if(inflight)return inflight;
    inflight=Promise.resolve().then(readSnapshot).then(value=>{
      const validated=validatePowerStatusSnapshot(value);
      sample={value:validated,at:now()};
      return validated;
    }).finally(()=>{inflight=null;});
    return inflight;
  };
  return Object.freeze({
    read,
    warm(){void read().catch(()=>{});},
  });
}
