// Read-only Windows WLAN radio presence under the canonical network port.
// No scan, association, disconnect, forget, profile manipulation or secrets.
// A Windows host that exposes a WLAN interface needs a real WLAN broker
// before any management snapshot or action can be considered available.
import { timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateNetworkManagementSnapshot } from "../../contracts/network-management.mjs";

const execute=promisify(execFile);
const ENDPOINT="/__ordax/native/network-management";
const HEADER="x-ordax-network-token";
const TOKEN=/^[0-9a-f]{64}$/;
const RADIO_SCRIPT=String.raw`
$ErrorActionPreference='Stop'
$wifi=@([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
  Where-Object { [int]$_.NetworkInterfaceType -eq 71 })
[Console]::Out.Write($(if($wifi.Count -eq 0){'absent'}else{'present'}))
`;
const loopback=ip=>["127.0.0.1","::1","::ffff:127.0.0.1"].includes(ip);

export async function readWindowsWlanPresence({platform=process.platform,run=execute}={}) {
  if(platform!=="win32")throw Error("Windows WLAN discovery requires Windows");
  const {stdout}=await run("powershell.exe",
    ["-NoLogo","-NoProfile","-NonInteractive","-Command",RADIO_SCRIPT],
    {timeout:7000,windowsHide:true,maxBuffer:4096});
  const observed=String(stdout).trim();
  if(observed!=="absent" && observed!=="present")
    throw Error("Windows WLAN discovery response invalid");
  return observed==="present";
}

export function createDesktopWlanMiddleware({token,sessionLocked=null,
  readPresence=readWindowsWlanPresence}={}) {
  if(typeof token!=="string"||!TOKEN.test(token) ||
    (sessionLocked!==null&&typeof sessionLocked!=="function")||
    typeof readPresence!=="function")
    throw new TypeError("Desktop WLAN discovery requires a host capability grant");
  const expected=Buffer.from(token,"hex");
  const reply=(res,status,payload)=>{
    res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff"});
    res.end(JSON.stringify(payload));
  };
  return (request,response,next)=>{
    const path=String(request.url??"").split("?")[0];
    if(path!==ENDPOINT)return next();
    const claimed=request.headers[HEADER];
    const supplied=typeof claimed==="string"&&TOKEN.test(claimed)
      ? Buffer.from(claimed,"hex") : null;
    if(!loopback(request.socket?.remoteAddress)||!supplied||
       !timingSafeEqual(expected,supplied))
      return reply(response,403,{error:"Windows WLAN authorization required"});
    if(request.url!==path)return reply(response,400,{error:"Query unavailable"});
    // No real Windows WLAN action broker is attached to this port. Deny all
    // actions, even for a trusted renderer; never disturb the host network.
    if(request.method!=="GET")
      return reply(response,503,{error:"Windows WLAN management broker unavailable"});
    void (async()=>{
      if(sessionLocked && await sessionLocked())
        return reply(response,423,{error:"OrdaX Desktop session locked"});
      const present=await readPresence();
      if(present)
        return reply(response,503,{error:"Windows WLAN management broker unavailable"});
      return reply(response,200,validateNetworkManagementSnapshot({
        wifiInterface:null,currentSsid:null,savedSsid:null,networks:[],
        unavailableReason:"no-wlan-interface",
      }));
    })().catch(()=>{if(!response.writableEnded)
      reply(response,503,{error:"Windows WLAN discovery unavailable"});});
  };
}
