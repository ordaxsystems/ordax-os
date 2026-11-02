'use strict';
// Execute 20 clean, real OrdaX installed Electron sessions on ephemeral Windows CI.
const {VisualTestBridge}=require('./bridge.cjs');
const {mkdirSync,writeFileSync}=require('node:fs');
const {isAbsolute,resolve,join}=require('node:path');
const executablePath=process.env.ORDAX_VISUAL_INSTALLED_EXE;
if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Windows'||
   process.env.ORDAX_VISUAL_ISOLATED_SESSION!=='1'||!executablePath||!isAbsolute(executablePath)){
  throw Error('Installed E2E requires a dedicated Windows GitHub Actions runner and absolute verified executable');
}
const artifactsDir=resolve(process.env.ORDAX_VISUAL_ARTIFACTS||'out/visual-test-bridge/installed');
mkdirSync(artifactsDir,{recursive:true});
const results=[];
async function main() {
  for(let run=1;run<=20;run++){
    const evidenceDir=join(artifactsDir,'run-'+String(run).padStart(2,'0'));
    const bridge=new VisualTestBridge({artifactsDir:evidenceDir});
    const record={run,status:'failed',startedAt:new Date().toISOString()};
    results.push(record);
    try{
      const launch=await bridge.launch({mode:'electron-installed',executablePath});
      if(launch.windows.length!==1||!launch.profileIsolated)throw Error('Wrong installed window/profile topology');
      const report=await bridge.runE2E({scenario:'native-smoke'});
      if(report.jsErrors.length)throw Error('Surface JavaScript exceptions: '+report.jsErrors.length);
      const inspection=await bridge.inspect({target:{css:'#ordax-root'}});
      if(!inspection.found||!inspection.visible)throw Error('Native Surface missing after startup');
      const accessibility=await bridge.getAccessibilityTree();
      if(accessibility.ariaSnapshot.length<20)throw Error('Native Surface accessibility tree is empty');
      record.status='passed';
      record.visual=report.visual.sha256;
      record.interactive=report.scan.interactiveElements;
      record.rootBounds=inspection.bounds;
      record.accessibilityChars=accessibility.ariaSnapshot.length;
      record.path=launch.windows[0].path;
    }catch(error){record.error=String(error?.message||error).slice(0,1200);}
    finally{
      try{record.diagnostics=await bridge.collectArtifacts();}
      catch(error){record.diagnosticsError=String(error).slice(0,400);record.status='failed';}
      try{await bridge.close();}
      catch(error){record.teardownError=String(error).slice(0,400);record.status='failed';}
      record.finishedAt=new Date().toISOString();
      writeFileSync(join(artifactsDir,'runs.json'),JSON.stringify({schema:'ordax.visual-installed-runs/1',
        requiredConsecutivePasses:20,results},null,2)+'\n');
    }
    process.stdout.write('ORDAX_INSTALLED_VISUAL_E2E_RUN='+run+' status='+record.status+'\n');
    if(record.status!=='passed')throw Error('Installed E2E iteration '+run+' failed: '+(record.error||record.teardownError||record.diagnosticsError));
  }
  process.stdout.write('ORDAX_INSTALLED_VISUAL_E2E_CONSECUTIVE_PASS=20\n');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
