import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDesktopSystemMetrics } from "../system/adapters/desktop/system-metrics.mjs";
import { validateSystemMetricsSnapshot } from "../system/contracts/system-metrics.mjs";

test("Windows metrics use actual system memory, uptime and the OrdaX profile volume", async () => {
  const calls=[];
  const result = await readDesktopSystemMetrics("C:\\Users\\User\\AppData\\Roaming\\OrdaX",{
    readVolume:async(path,opts)=>{
      calls.push([path,opts.bigint]);
      return { bsize:4096n, blocks:10000n,bavail:2500n };
    },
    totalMemory:()=>16000000000,
    freeMemory:()=>6500000000,
    systemUptime:()=>1567.92,
  });
  assert.deepEqual(result,validateSystemMetricsSnapshot(result));
  assert.equal(result.userStorageTotalBytes,40960000);
  assert.equal(result.userStorageFreeBytes,10240000);
  assert.equal(result.memoryAvailableBytes,6500000000);
  assert.equal(result.uptimeSeconds,1567);
  assert.equal(calls[0][1],true);
});

test("invalid volume readings are rejected; never fabricate storage",async()=>{
  await assert.rejects(()=>readDesktopSystemMetrics("profile",{
    readVolume:async()=>({bsize:4096n,blocks:3n,bavail:6n}),
    totalMemory:()=>100,freeMemory:()=>80,systemUptime:()=>4,
  }),/free user storage/);
  await assert.rejects(()=>readDesktopSystemMetrics("profile",{
    readVolume:async()=>({bsize:4096n,blocks:2n**64n,bavail:1n}),
    totalMemory:()=>100,freeMemory:()=>80,systemUptime:()=>4,
  }),/safe integer/);
});

test("Node observes real disk volume and system metrics on its host",async t=>{
  const dir=mkdtempSync(join(tmpdir(),"ordax-metrics-test-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const result=await readDesktopSystemMetrics(dir);
  assert.deepEqual(result,validateSystemMetricsSnapshot(result));
  assert.ok(result.memoryTotalBytes>0);
  assert.ok(result.userStorageTotalBytes>0);
  assert.ok(result.userStorageFreeBytes<=result.userStorageTotalBytes);
});
