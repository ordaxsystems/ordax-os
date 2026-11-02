'use strict';
// Tested against the real installed OrdaX Native UI in an isolated CI desktop.
// This is NOT a simulated Surface, UI fork, or a bypass of local-first setup.
const {VisualTestBridge,comparePng}=require('./bridge.cjs');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');

async function runInstalledJourney({executablePath,artifactsDir}){
  mkdirSync(artifactsDir,{recursive:true});
  const bridge=new VisualTestBridge({artifactsDir});
  const receipt={schema:'ordax.visual-installed-journey/1',steps:[],passed:false};
  const step=async(name,cb)=>{
    await cb();
    receipt.steps.push(name);
    const shot=await bridge.screenshot({name});
    receipt[name]={screenshotSha256:shot.sha256,
      accessibilityChars:(await bridge.getAccessibilityTree()).ariaSnapshot.length};
    if(receipt[name].accessibilityChars<20)throw Error('Accessibility tree missing after '+name);
    process.stdout.write('ORDAX_INSTALLED_JOURNEY_STEP='+name+' PASS\n');
  };
  try{
    await bridge.launch({mode:'electron-installed',executablePath});
    const page=bridge.currentPage();
    await page.locator('.ordax-first-run[data-first-run-step="welcome"]').waitFor({state:'visible',timeout:90000});
    await step('first-run-welcome',async()=>{});
    await step('first-run-account',async()=>{
      await page.locator('[data-first-run-action="next"]').click({timeout:30000});
      await page.locator('.ordax-first-run[data-first-run-step="account"]').waitFor({timeout:20000});
    });
    await step('first-run-security',async()=>{
      await page.locator('[data-first-run-action="account-local"]').click({timeout:30000});
      await page.locator('.ordax-first-run[data-first-run-step="security"]').waitFor({timeout:20000});
    });
    await step('first-run-device',async()=>{
      // The next step must enable without bypassing pending identity requests.
      await page.locator('[data-first-run-action="next"]').click({timeout:60000});
      await page.locator('.ordax-first-run[data-first-run-step="name"]').waitFor({timeout:20000});
    });
    await step('first-run-ready',async()=>{
      await page.locator('[data-first-run-action="next"]').click({timeout:60000});
      await page.locator('.ordax-first-run[data-first-run-step="ready"]').waitFor({timeout:20000});
    });
    await step('home',async()=>{
      await page.locator('[data-first-run-system-terms-acceptance]').check({timeout:15000});
      await page.locator('[data-first-run-action="finish"]').click({timeout:20000});
      await page.locator('.ordax-first-run').waitFor({state:'detached',timeout:30000});
      await page.locator('[data-ordax-shell]').waitFor({state:'visible',timeout:20000});
    });
    const windows=[
      ['account','[data-launch-app="account"]:visible'],
      ['settings','[data-launch-app="settings"]:visible'],
      ['system','[data-launch-app="system"]:visible']
    ];
    let settingsImage;
    for(const [area,target] of windows) {
      await step(area,async()=>{
        const selector=page.locator(target).first();
        await selector.click({timeout:20000});
        await page.locator('[data-window-id="'+area+'"]').waitFor({state:'visible',timeout:20000});
        const dom=await bridge.inspect({target:{css:'[data-window-id="'+area+'"]'}});
        if(!dom.found||!dom.visible||dom.bounds.width<50||dom.bounds.height<50)
          throw Error('Native '+area+' window not visible/bounded');
        receipt[area+'Dom']={tag:dom.tag,visible:dom.visible,bounds:dom.bounds,style:dom.style};
      });
      if(area==='settings')settingsImage=await page.screenshot({animations:'disabled'});
      if(area==='system'){
        const systemImage=await page.screenshot({animations:'disabled'});
        receipt.screenDifference=comparePng(systemImage,settingsImage,{channelTolerance:0,maxMismatchRatio:0});
        if(receipt.screenDifference.match)throw Error('Settings and System renderings are indistinguishable');
      }
    }
    receipt.layout=await bridge.scanLayout();
    receipt.logs=bridge.getLogs().events.filter(x=>x.kind==='pageerror'||x.kind==='crash');
    if(receipt.logs.length)throw Error('Product renderer crashed during installed journey');
    receipt.passed=true;
    return receipt;
  }catch(error){
    receipt.error=String(error?.stack||error).slice(0,4000);
    throw error;
  }finally{
    try{receipt.artifacts=await bridge.collectArtifacts();}
    catch(error){receipt.artifactError=String(error).slice(0,500);receipt.passed=false;}
    try{await bridge.close();}
    catch(error){receipt.teardownError=String(error).slice(0,500);receipt.passed=false;}
    writeFileSync(join(artifactsDir,'journey.json'),JSON.stringify(receipt,null,2)+'\n');
  }
}
module.exports={runInstalledJourney};
