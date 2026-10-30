#!/usr/bin/env node
import {runBrowser,sleep} from "../browser-proof/chromium.mjs";
const url=process.env.ORDAX_WINDOWS_EMULATOR_URL??"http://127.0.0.1:4202/tools/windows-emulator/index.html";
const target="/system/composition/native/index.html";
const timeout=30_000;
async function state(client){
  const response=await client.send("Runtime.evaluate",{
    expression:`(async()=>{
      const api=window.__ORDAX_EMULATOR__;
      const doc=document.querySelector("#ordax-emulator-surface")?.contentDocument;
      const overlay=doc?.querySelector(".ordax-first-run");
      return {
        schema:api?.schema,kernel:api?.kernel,target:api?.surfaceTarget,
        path:doc?.location.pathname,completed:(await api?.getFirstRunState?.())?.completed,
        firstRunVisible:!!overlay,next:!!doc?.querySelector('[data-first-run-action="next"]'),
        stage:overlay?.dataset.firstRunStep,
        meridian:doc?.documentElement.hasAttribute("data-meridian"),
        accent:doc?getComputedStyle(doc.documentElement).getPropertyValue("--md-accent").trim():null,
        boot:doc?.querySelector("#ordax-boot-screen")?.dataset.state,
        shell:!!doc?.querySelector("[data-ordax-shell]")
      };
    })()`,
    returnByValue:true,awaitPromise:true,
  });
  if(response.exceptionDetails)return null;
  return response.result?.value??null;
}
async function until(client,predicate){
  const deadline=Date.now()+timeout;
  let result;
  while(Date.now()<deadline){
    result=await state(client);
    if(predicate(result))return result;
    await sleep(150);
  }
  throw Error("Native emulator did not reach expected state: "+JSON.stringify(result));
}
async function action(client,id){
  const reply=await client.send("Runtime.evaluate",{
    expression:`(()=>{
      const doc=document.querySelector("#ordax-emulator-surface")?.contentDocument;
      if (${JSON.stringify(id)} === "finish") {
        const terms=doc?.querySelector('[data-first-run-system-terms-acceptance]');
        if(!terms)return false;
        terms.checked=true;terms.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
      }
      const button=doc?.querySelector(${JSON.stringify('[data-first-run-action="'+id+'"]')});
      if(button?.tagName!=="BUTTON"||button.disabled)return false;
      button.click();return true;
    })()`,returnByValue:true,
  });
  if(reply.result?.value!==true)throw Error("Native First Run action unavailable: "+id);
  await sleep(100);
}
runBrowser(async client=>{
  const navigation=await client.send("Page.navigate",{url});
  if(navigation.errorText)throw Error(navigation.errorText);
  const initial=await until(client,result=>result?.firstRunVisible&&result.next);
  if(initial.schema!=="ordax.windows-emulator/1"||initial.kernel!==false||initial.target!==target||initial.path!==target)
    throw Error("Emulator must render the real Native entry: "+JSON.stringify(initial));
  if(!initial.meridian||!initial.accent)throw Error("Native Meridian presentation is missing");
  if(initial.stage!=="welcome")throw Error("Use fresh isolated emulator state before smoke proof");
  for(const id of ["next","next","account-local","next","next","finish"])await action(client,id);
  const result=await until(client,value=>value?.completed===true&&!value.firstRunVisible&&value.shell&&value.boot==="ready");
  await client.send("Page.reload",{});
  await until(client,value=>value?.completed===true&&!value.firstRunVisible&&value.shell&&value.boot==="ready");
  console.log("ORDAX_WINDOWS_EMULATOR_SMOKE=PASS");
  console.log("ORDAX_WINDOWS_EMULATOR_COMPOSITION=NATIVE");
  console.log("ORDAX_WINDOWS_EMULATOR_OOBE=COMPLETED_AND_RELOADED");
  return result;
}).catch(error=>{console.error(error);process.exitCode=1;});
