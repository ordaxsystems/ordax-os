import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,copyFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {spawn} from "node:child_process";
import {nextLocalViteRestart} from "../tools/windows-emulator/dev-restart-policy.mjs";

test("one local Native compiler is recovered with bounded progressive waits",()=>{
  const first=nextLocalViteRestart(0,1000);
  assert.deepEqual(first,{failures:1,delayMs:500});
  const second=nextLocalViteRestart(first.failures,1000);
  assert.deepEqual(second,{failures:2,delayMs:1000});
  const third=nextLocalViteRestart(second.failures,1000);
  assert.deepEqual(third,{failures:3,delayMs:2000});
  assert.equal(nextLocalViteRestart(third.failures,1000),null,
    "repeated crashes cannot start an unbounded Vite loop");
  assert.deepEqual(nextLocalViteRestart(3,60000),{
    failures:1,delayMs:500,
  },"a stable Native session permits one new recovery sequence");
  assert.equal(Object.isFrozen(first),true);
});

test("invalid local retry state never enables a recovery",()=>{
  for(const [count,uptime] of [
    [-1,100], [1,-1], [1,Infinity], [1,NaN], [0.5,100],
    [null,100], [1,null],
  ])assert.throws(()=>nextLocalViteRestart(count,uptime),TypeError);
});

test("local retry is owned by the existing Desktop host, not an installed runtime",()=>{
  const source=readFileSync(new URL("../tools/windows-emulator/dev-supervisor.mjs",import.meta.url),"utf8");
  assert.match(source,/ORDAX_DESKTOP_LOCAL_DEV === '1'/);
  assert.match(source,/ORDAX_DESKTOP_HOST === '1'/);
  assert.match(source,/ORDAX_EMULATOR_NO_BROWSER === '1'/);
  assert.match(source,/nextLocalViteRestart\(crashStreak,Date\.now\(\)-startedAt\)/);
  assert.match(source,/clearTimeout\(restartTimer\)/);
  assert.match(source,/if \(stopping\) return;/);
  assert.doesNotMatch(source,/ORDAX_PRODUCT_ACCESS_TOKEN|ORDAX_DEVICE_TOKEN/);
});

// An isolated Native child exercises the actual Windows process supervisor.
// This never stops the user's live Electron, Surface, or Product MCP agent.
async function runIsolatedNativeSupervisor(t,{alwaysFail=false}={}){
  const fixture=mkdtempSync(join(tmpdir(),"ordax-native-recovery-e2e-"));
  const emulator=join(fixture,"tools","windows-emulator");
  const vite=join(fixture,"node_modules","vite","bin","vite.js");
  const marker=join(fixture,"attempts.txt");
  mkdirSync(emulator,{recursive:true});
  mkdirSync(dirname(vite),{recursive:true});
  for(const name of ["dev-supervisor.mjs","dev-restart-policy.mjs"])
    copyFileSync(new URL("../tools/windows-emulator/"+name,import.meta.url),
      join(emulator,name));
  writeFileSync(vite,`
const fs=require("node:fs");
const file=process.env.ORDAX_TEST_ATTEMPTS_FILE;
const attempt=(fs.existsSync(file)?Number(fs.readFileSync(file,"utf8")):0)+1;
fs.writeFileSync(file,String(attempt));
if(process.env.ORDAX_TEST_ALWAYS_FAIL==="1"||attempt===1)process.exit(31);
process.stdout.write("TEST_NATIVE_VITE_READY\\n");
setInterval(()=>{},1000);
`);
  const child=spawn(process.execPath,[join(emulator,"dev-supervisor.mjs")],{
    cwd:fixture,windowsHide:true,stdio:["ignore","pipe","pipe"],
    env:{...process.env,ORDAX_DESKTOP_HOST:"1",
      ORDAX_DESKTOP_LOCAL_DEV:"1",ORDAX_EMULATOR_NO_BROWSER:"1",
      ORDAX_TEST_ATTEMPTS_FILE:marker,
      ORDAX_TEST_ALWAYS_FAIL:alwaysFail?"1":"0"},
  });
  let stdout="",stderr="",exited=false;
  const output=()=>stdout+"\n"+stderr;
  child.stdout.on("data",chunk=>{stdout+=String(chunk)});
  child.stderr.on("data",chunk=>{stderr+=String(chunk)});
  child.once("exit",()=>{exited=true});
  t.after(async()=>{
    if(!exited)child.kill("SIGTERM");
    await new Promise(resolve=>{
      if(exited)return resolve();
      const deadline=setTimeout(()=>{
        // Scoped to this test supervisor and its process tree, never
        // another desktop or a process found by executable name.
        if(!exited)child.kill("SIGKILL");
        resolve();
      },3000);
      child.once("exit",()=>{clearTimeout(deadline);resolve()});
    });
    rmSync(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  const deadline=Date.now()+11000;
  while(Date.now()<deadline){
    if(alwaysFail&&exited)return {output:output(),attempts:Number(readFileSync(marker,"utf8"))};
    if(!alwaysFail&&output().includes("TEST_NATIVE_VITE_READY"))
      return {output:output(),attempts:Number(readFileSync(marker,"utf8"))};
    if(exited)throw Error("Local Native supervisor exited before recovery: "+output().slice(-1200));
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error("Local Native supervisor exceeded recovery deadline: "+output().slice(-1500));
}
test("real isolated Windows supervisor restarts one failed Native child and recovers",async t=>{
  const result=await runIsolatedNativeSupervisor(t);
  assert.equal(result.attempts,2);
  assert.match(result.output,/local recovery 1\/3 in 500ms/);
  assert.match(result.output,/TEST_NATIVE_VITE_READY/);
});
test("real isolated supervisor stops after three failed Native restart attempts",async t=>{
  const result=await runIsolatedNativeSupervisor(t,{alwaysFail:true});
  assert.equal(result.attempts,4);
  assert.match(result.output,/local recovery 3\/3 in 2000ms/);
  assert.match(result.output,/development supervisor is stopping/);
});
