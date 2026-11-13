'use strict';
// The 20-run gate exercises REAL installed First Run + Home/Account/Settings/System
// on twenty independent, disposable Windows Electron profiles. Fail closed at
// the first regression instead of burning CI on stale installed source.
const {runInstalledJourney}=require('./installed-journey.cjs');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join,isAbsolute,resolve}=require('node:path');
const executablePath=process.env.ORDAX_VISUAL_INSTALLED_EXE;
if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Windows'||
   process.env.ORDAX_VISUAL_ISOLATED_SESSION!=='1'||!executablePath||!isAbsolute(executablePath))
  throw Error('20-run installed E2E requires a verified executable on an isolated Windows GitHub runner');
const artifactRoot=resolve(process.env.ORDAX_VISUAL_ARTIFACTS||'out/visual-test-bridge/installed');
mkdirSync(artifactRoot,{recursive:true});
const results=[];
async function main(){
 for(let iteration=1;iteration<=20;iteration++){
  const runDir=join(artifactRoot,'run-'+String(iteration).padStart(2,'0'));
  const record={iteration,status:'failed',startedAt:new Date().toISOString()};
  results.push(record);
  try{
   const result=await runInstalledJourney({executablePath,artifactsDir:runDir});
   if(!result.passed)throw Error('Installed journey returned a non-passing result');
   record.status='passed';
   record.steps=result.steps;
   record.firstRunSteps=result.firstRunSteps;
   record.nativeSmokeSha256=result.nativeSmokeSha256;
   record.screenDifference=result.screenDifference;
  }catch(error){record.error=String(error?.message||error).slice(0,1200);}
  finally{
   record.finishedAt=new Date().toISOString();
   writeFileSync(join(artifactRoot,'runs.json'),JSON.stringify({
    schema:'ordax.visual-installed-runs/2',requiredConsecutivePasses:20,
    expectedFullNavigation:true,results},null,2)+'\n');
  }
  process.stdout.write('ORDAX_INSTALLED_VISUAL_E2E_RUN='+iteration+' status='+record.status+'\n');
  if(record.status!=='passed')throw Error('Installed full navigation E2E failed at iteration '+iteration+': '+record.error);
 }
 process.stdout.write('ORDAX_INSTALLED_VISUAL_FULL_JOURNEY_CONSECUTIVE_PASS=20\n');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
