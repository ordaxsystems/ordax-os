// Real Windows network interface/link telemetry for ordax.network-status/1.
// Query .NET NetworkInterface types and operational status; a configured IP
// address is NOT evidence that a physical link is connected.
// This is a read-only host adapter, not a Wi-Fi manager or network fallback.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateNetworkStatusSnapshot } from "../../contracts/network-status.mjs";

const execute = promisify(execFile);
const SAFE_NAME = /^[A-Za-z0-9_.:-]{1,32}$/;
const MAX_INTERFACES = 64;
const ETHERNET_TYPES = new Set([6, 26, 62, 69, 117]);
const WIFI_TYPE = 71;
const LOOPBACK_TYPE = 24;
const LINK_UP = 1;
const LINK_DOWN = new Set([2, 6, 7]);

// System.Net.NetworkInformation comes with Windows PowerShell/.NET. No
// localized netsh parsing, elevated permissions, compiled C#, or scanning.
const nativeScript = String.raw`
$ErrorActionPreference='Stop'
$records=@([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
  ForEach-Object { [PSCustomObject]@{
    Name=[string]$_.Name
    Type=[int]$_.NetworkInterfaceType
    Status=[int]$_.OperationalStatus
  } })
[Console]::Out.Write((ConvertTo-Json -InputObject $records -Depth 3 -Compress))
`;

function capabilityName(input,index,used) {
  const candidate=input.replace(/[^A-Za-z0-9_.:-]+/g,"-").slice(0,32);
  const base=SAFE_NAME.test(candidate)?candidate:`host-interface-${index+1}`;
  let name=base,suffix=2;
  while(used.has(name)){
    const extra=`-${suffix++}`;
    name=base.slice(0,32-extra.length)+extra;
  }
  used.add(name);
  return name;
}

export function projectWindowsNetworkStatus(records) {
  if(!Array.isArray(records) || records.length>256)
    throw new TypeError("Windows network interface list is invalid");
  const names=new Set(),entries=[];
  for(const record of records) {
    if(!record || typeof record!=="object" || Array.isArray(record) ||
      typeof record.Name!=="string" || !record.Name.trim() ||
      record.Name.length>256 || !Number.isInteger(record.Type) ||
      !Number.isInteger(record.Status) || record.Status<0 || record.Status>7)
      throw new TypeError("Windows network interface telemetry is invalid");
    if(record.Type===LOOPBACK_TYPE)continue;
    if(entries.length>=MAX_INTERFACES)break;
    const kind=record.Type===WIFI_TYPE?"wifi":
      ETHERNET_TYPES.has(record.Type)?"ethernet":"other";
    const state=record.Status===LINK_UP?"connected":
      LINK_DOWN.has(record.Status)?"disconnected":"unknown";
    entries.push({
      name:capabilityName(record.Name,entries.length,names),
      kind,state,signalDbm:null,
    });
  }
  return validateNetworkStatusSnapshot({interfaces:entries});
}

export async function readDesktopNetworkStatus({
  run=execute,platform=process.platform,
}={}) {
  if(platform!=="win32")throw new Error("Windows network service requires Windows");
  const {stdout}=await run("powershell.exe",
    ["-NoLogo","-NoProfile","-NonInteractive","-Command",nativeScript],
    {timeout:7000,windowsHide:true,maxBuffer:32768});
  let records;
  try { records=JSON.parse(String(stdout).trim()); }
  catch { throw Error("Windows network status output invalid"); }
  return projectWindowsNetworkStatus(records);
}
