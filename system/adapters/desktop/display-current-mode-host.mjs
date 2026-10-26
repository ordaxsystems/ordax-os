// Windows Desktop Native display adapter: real current modes ONLY.
// No ChangeDisplaySettings, preview, confirm, revert, or monitor mutation.
// The same ordax.display-outputs/1 contract feeds the shared Surface.
import { timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DISPLAY_OUTPUTS_SCHEMA,validateDisplayOutputsSnapshot,
} from "../../contracts/display-outputs.mjs";

const execute=promisify(execFile);
const TOKEN_RE=/^[0-9a-f]{64}$/;
const ENDPOINT="/__ordax/native/display-outputs";
const HEADER="x-ordax-display-token";
const DISPLAY_NAME=/^\\\\\.\\DISPLAY([1-9][0-9]{0,2})$/i;
const loopback=ip=>["127.0.0.1","::1","::ffff:127.0.0.1"].includes(ip);

// Win32 EnumDisplaySettings reports the actual physical mode. Screen.Bounds
// is DPI-virtualized and MUST NOT be used as a physical pixel resolution.
// Explicit offsets are DEVMODEW's Windows SDK structure layout, 220 bytes.
// This script is strictly read-only: no DEVMODE write APIs are linked.
const SCRIPT=String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OrdaXDesktopDisplayReadOnly {
  [StructLayout(LayoutKind.Explicit, CharSet=CharSet.Unicode, Size=220)]
  public struct DEVMODE {
    [FieldOffset(68)] public short dmSize;
    [FieldOffset(172)] public int dmPelsWidth;
    [FieldOffset(176)] public int dmPelsHeight;
    [FieldOffset(184)] public int dmDisplayFrequency;
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool EnumDisplaySettings(string deviceName,int modeNum,ref DEVMODE devMode);
  public static string Read(string name) {
    DEVMODE d=new DEVMODE();
    d.dmSize=(short)Marshal.SizeOf(typeof(DEVMODE));
    if(!EnumDisplaySettings(name,-1,ref d))
      throw new InvalidOperationException("Display mode unavailable");
    return d.dmPelsWidth+","+d.dmPelsHeight+","+d.dmDisplayFrequency;
  }
}
'@
$records=@([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  [PSCustomObject]@{
    Device=[string]$_.DeviceName
    Mode=[OrdaXDesktopDisplayReadOnly]::Read($_.DeviceName)
    Primary=[bool]$_.Primary
  }
})
[Console]::Out.Write((ConvertTo-Json -InputObject $records -Compress -Depth 3))
`;

export function projectWindowsDisplayCurrentModes(records){
  if(!Array.isArray(records)||records.length<1||records.length>8)
    throw new TypeError("Windows display enumeration outside bounds");
  const ids=new Set();
  const outputs=records.map(record=>{
    if(!record||typeof record!=="object"||Array.isArray(record)||
      typeof record.Device!=="string"||typeof record.Mode!=="string"||
      typeof record.Primary!=="boolean")
      throw new TypeError("Malformed Windows display telemetry");
    const match=DISPLAY_NAME.exec(record.Device);
    const modes=/^([0-9]{3,5}),([0-9]{3,5}),([0-9]{1,4})$/.exec(record.Mode);
    if(!match||!modes)throw new TypeError("Unexpected Windows display identity or mode");
    const id="DISPLAY"+match[1];
    const width=Number(modes[1]),height=Number(modes[2]),hz=Number(modes[3]);
    if(ids.has(id)||width<320||width>16384||height<200||height>16384||
       hz<1||hz>1000)
      throw new TypeError("Windows display mode or identity is invalid");
    ids.add(id);
    const modeId=`${width}x${height}@${hz}`;
    return{
      id,name:`Windows ${id}`,enabled:true,
      modes:[{
        id:modeId,width,height,refreshHz:hz,
        current:true,preferred:false,
      }],
    };
  });
  return validateDisplayOutputsSnapshot({
    schema:DISPLAY_OUTPUTS_SCHEMA,available:true,reason:null,outputs,
    preview:null,
  });
}

export async function readWindowsDisplayCurrentModes({
  run=execute,platform=process.platform,
}={}){
  if(platform!=="win32")throw Error("Windows display observation requires Windows");
  const {stdout}=await run("powershell.exe",
    ["-NoLogo","-NoProfile","-NonInteractive","-Command",SCRIPT],
    {timeout:12000,windowsHide:true,maxBuffer:16384});
  let records;
  try{records=JSON.parse(String(stdout).trim());}
  catch{throw Error("Windows display provider returned invalid JSON");}
  return projectWindowsDisplayCurrentModes(records);
}

export function createDesktopDisplayCurrentModeMiddleware({
  token,read=readWindowsDisplayCurrentModes,
}={}){
  if(typeof token!=="string"||!TOKEN_RE.test(token)||typeof read!=="function")
    throw new TypeError("Desktop Native display requires an Electron capability token");
  const expected=Buffer.from(token,"hex");
  // A single physical Win32 enumeration is authoritative for all concurrent
  // readers. Without coalescing, each GET starts a new PowerShell/.NET
  // compilation; boot-time contention can exhaust the 12-second provider
  // deadline. This holds no cached value after success or failure.
  let inFlight=null;
  const readShared=()=>{
    if(inFlight)return inFlight;
    const request=Promise.resolve().then(()=>read());
    inFlight=request;
    const clear=()=>{if(inFlight===request)inFlight=null;};
    request.then(clear,clear);
    return request;
  };
  const respond=(res,status,body)=>{
    if(res.writableEnded)return;
    res.writeHead(status,{"Content-Type":"application/json",
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
    res.end(JSON.stringify(body));
  };
  return (req,res,next)=>{
    const path=String(req.url??"").split("?")[0];
    if(path!==ENDPOINT)return next();
    const received=req.headers[HEADER];
    const verified=typeof received==="string"&&TOKEN_RE.test(received)
      ? Buffer.from(received,"hex"):null;
    if(!loopback(req.socket?.remoteAddress)||!verified||
       !timingSafeEqual(expected,verified))
      return respond(res,403,{error:"Desktop display authorization required"});
    if(req.url!==path)return respond(res,400,{error:"Display query not supported"});
    // Never change a personal Windows screen mode. The canonical display
    // controls receive only the single real active mode for each output, so
    // no alternate preview choice exists in the shared Surface.
    if(req.method!=="GET")
      return respond(res,503,{error:"Windows display mode modification unavailable"});
    void readShared().then(s=>respond(res,200,validateDisplayOutputsSnapshot(s)))
      .catch(()=>respond(res,503,{error:"Windows display mode observation unavailable"}));
  };
}
