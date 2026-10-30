import test from "node:test";
import assert from "node:assert/strict";
import {
  projectWindowsNetworkStatus,readDesktopNetworkStatus,
} from "../system/adapters/desktop/network-status.mjs";
import {NETWORK_STATUS_SCHEMA,validateNetworkStatusSnapshot} from "../system/contracts/network-status.mjs";

test("Windows host uses real link status and physical interface type, not IP heuristics",async()=>{
  const records=[
    {Name:"Wi-Fi",Type:71,Status:1},
    {Name:"Ethernet 2",Type:6,Status:2},
    {Name:"Loopback Pseudo-Interface 1",Type:24,Status:1},
    {Name:"vEthernet (WSL)",Type:6,Status:1},
    {Name:"VPN",Type:131,Status:5},
  ];
  let observed;
  const result=await readDesktopNetworkStatus({
    platform:"win32",
    run:async(binary,args,options)=>{
      observed={binary,args,options};
      return{stdout:JSON.stringify(records)};
    },
  });
  assert.equal(NETWORK_STATUS_SCHEMA,"ordax.network-status/1");
  assert.deepEqual(result,validateNetworkStatusSnapshot(result));
  assert.deepEqual(result.interfaces,[
    {name:"Wi-Fi",kind:"wifi",state:"connected",signalDbm:null},
    {name:"Ethernet-2",kind:"ethernet",state:"disconnected",signalDbm:null},
    {name:"vEthernet-WSL-",kind:"ethernet",state:"connected",signalDbm:null},
    {name:"VPN",kind:"other",state:"unknown",signalDbm:null},
  ]);
  assert.equal(observed.binary,"powershell.exe");
  assert.equal(observed.options.timeout,7000);
  const script=observed.args.at(-1);
  assert.match(script,/GetAllNetworkInterfaces/);
  assert.match(script,/NetworkInterfaceType/);
  assert.match(script,/OperationalStatus/);
  assert.doesNotMatch(script,/netsh|Add-Type -TypeDefinition|Enable-NetAdapter|Set-NetAdapter|Connect-/);
});

test("Windows interface status never promotes assigned IP address into connection",()=>{
  const snapshot=projectWindowsNetworkStatus([
    {Name:"Wi-Fi",Type:71,Status:2},
    {Name:"Ethernet",Type:6,Status:7},
    {Name:"No device",Type:6,Status:6},
    {Name:"Testing",Type:71,Status:3},
    {Name:"Dormant",Type:71,Status:5},
  ]);
  assert.deepEqual(snapshot.interfaces.map(item=>item.state),[
    "disconnected","disconnected","disconnected","unknown","unknown",
  ]);
  assert.ok(snapshot.interfaces.every(item=>item.signalDbm===null));
});

test("Windows network names are bounded and unique; absence is an empty snapshot",()=>{
  const result=projectWindowsNetworkStatus([
    {Name:"Adapter @ 1",Type:6,Status:1},
    {Name:"Adapter - 1",Type:6,Status:1},
    {Name:"x".repeat(200),Type:71,Status:4},
  ]);
  assert.equal(result.interfaces.length,3);
  assert.equal(new Set(result.interfaces.map(i=>i.name)).size,3);
  assert.ok(result.interfaces.every(i=>i.name.length<=32));
  assert.deepEqual(projectWindowsNetworkStatus([]).interfaces,[]);
});

test("Malformed native network telemetry fails closed, without fabricated connectivity",async()=>{
  for(const value of [null,{},[{Name:"Wi-Fi",Type:"71",Status:1}],
    [{Name:"Ethernet",Type:6,Status:99}],
    [{Name:"",Type:6,Status:1}],Array(257).fill({Name:"Adapter",Type:6,Status:1})]){
    assert.throws(()=>projectWindowsNetworkStatus(value),TypeError);
  }
  await assert.rejects(()=>readDesktopNetworkStatus({platform:"linux"}),/requires Windows/);
  await assert.rejects(()=>readDesktopNetworkStatus({
    platform:"win32",run:async()=>({stdout:"not-json"}),
  }),/output invalid/);
  await assert.rejects(()=>readDesktopNetworkStatus({
    platform:"win32",run:async()=>{throw Error("native API unavailable");},
  }),/native API unavailable/);
});
