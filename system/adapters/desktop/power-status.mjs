// Actual Windows power telemetry, never Linux ACPI emulation.
// GetSystemPowerStatus reports battery presence and AC mains independently.
// Unknown values remain unknown; the app cannot infer them from a desktop PC.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validatePowerStatusSnapshot } from "../../contracts/power-status.mjs";
const execute = promisify(execFile);
// Use the Windows Forms wrapper over Win32 power telemetry instead of
// compiling a C# P/Invoke class on every GET. Runtime Add-Type compilation
// competed with Native Surface cold-start and could exceed the bounded probe.
const nativeScript = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$state=[System.Windows.Forms.SystemInformation]::PowerStatus
$life=[double]$state.BatteryLifePercent
$percent=255
if($life -ge 0.0 -and $life -le 1.0){
  $percent=[int][Math]::Round($life*100.0,[MidpointRounding]::AwayFromZero)
}
Write-Output (([int]$state.PowerLineStatus).ToString()+','+([int]$state.BatteryChargeStatus).ToString()+','+$percent.ToString())
`;
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
export async function readDesktopPowerStatus({run=execute,platform=process.platform}={}) {
  if(platform!=="win32") throw new Error("Windows power service requires Windows");
  const {stdout}=await run("powershell.exe",
    ["-NoLogo","-NoProfile","-NonInteractive","-Command",nativeScript],
    {timeout:7000,windowsHide:true,maxBuffer:4096});
  const match=String(stdout).trim().match(/^(\d{1,3}),(\d{1,3}),(\d{1,3})$/);
  if(!match)throw new Error("Windows power status output invalid");
  return projectWindowsPowerStatus({
    acLineStatus:Number(match[1]),batteryFlag:Number(match[2]),batteryPercent:Number(match[3]),
  });
}
