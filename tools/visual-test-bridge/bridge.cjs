'use strict';
// Visual Test Bridge: local, ephemeral test process. NOT a product IPC, HTTP server or MCP authority.
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync}=require('node:fs');
const {resolve,join,basename,isAbsolute}=require('node:path');
const {tmpdir}=require('node:os');
const {createHash}=require('node:crypto');

// Child Electron/host processes must not inherit API keys, MCP grants, CI
// tokens, or unrelated ORDAX_* secrets from the invoking development agent.
const OS_ENV_KEYS=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP',
  'TMPDIR','APPDATA','LOCALAPPDATA','PROGRAMDATA','USERPROFILE','HOMEDRIVE',
  'HOMEPATH','USERNAME','USERDOMAIN','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS',
  'PUBLIC','PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES',
  'ALLUSERSPROFILE','HOME','LANG','LC_ALL','DISPLAY','XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME']);
function isolatedElectronEnv(source=process.env,{development=false,profileDir}={}) {
  if(typeof profileDir!=='string'||!isAbsolute(profileDir))
    throw Error('An absolute disposable Electron profile is required');
  const selected=Object.fromEntries(Object.entries(source)
    .filter(([name,value])=>OS_ENV_KEYS.has(name.toUpperCase())&&typeof value==='string'));
  selected.ORDAX_DESKTOP_TEST_PROFILE='1';
  selected.ORDAX_DESKTOP_TEST_PROFILE_DIR=profileDir;
  if(development && source.ORDAX_DESKTOP_LOCAL_DEV==='1')
    selected.ORDAX_DESKTOP_LOCAL_DEV='1';
  return selected;
}
const MAX_LOGS=500;
const OPERATIONS=new Set(['launch','close','list_windows','select_window','navigate','inspect','assert','click','type','screenshot','get_logs','get_accessibility_tree','run_e2e','compare_visual','collect_artifacts','scan_layout']);
function localUrl(input) {
  let parsed;
  try {parsed=new URL(input);} catch {throw Error('An absolute loopback URL is required');}
  if(parsed.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) ||
     parsed.username || parsed.password || parsed.hash)
    throw Error('Only credential-free, local HTTP preview origins are authorized');
  return parsed;
}
function safeText(input) {
  return String(input??'').replace(/(?:[0-9a-f]{32,}|Bearer\s+\S+)/gi,'[REDACTED]')
    .replace(/(?:https?|wss?):\/\/[^\s/'"]+([^\s'"]*)/g,(_full,path)=>path.split('?')[0])
    .slice(0,1200);
}
function boundedName(input) {
  if(typeof input!=='string'||!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(input))throw Error('Invalid artifact identifier');
  return input;
}
function comparePngDetailed(actualBytes,baselineBytes,{channelTolerance=10,maxMismatchRatio=0.001}={},withDiff=false) {
  if(!Number.isInteger(channelTolerance)||channelTolerance<0||channelTolerance>255 ||
     typeof maxMismatchRatio!=='number'||maxMismatchRatio<0||maxMismatchRatio>1)
    throw Error('Invalid comparison tolerances');
  const {PNG}=require('pngjs');
  const actual=PNG.sync.read(actualBytes),baseline=PNG.sync.read(baselineBytes);
  if(actual.width!==baseline.width||actual.height!==baseline.height)
    return {result:{match:false,reason:'dimensions',actual:[actual.width,actual.height],
      baseline:[baseline.width,baseline.height],mismatchedPixels:null},diffPng:null};
  const overlay=withDiff?new PNG({width:actual.width,height:actual.height}):null;
  let mismatch=0;
  for(let i=0;i<actual.data.length;i+=4){
    const changed=[0,1,2,3].some(c=>Math.abs(actual.data[i+c]-baseline.data[i+c])>channelTolerance);
    if(changed)mismatch++;
    if(overlay){
      overlay.data[i]=changed?255:0;
      overlay.data[i+1]=changed?32:0;
      overlay.data[i+2]=changed?32:0;
      overlay.data[i+3]=changed?255:0;
    }
  }
  const pixels=actual.width*actual.height,mismatchRatio=mismatch/pixels;
  return {result:{match:mismatchRatio<=maxMismatchRatio,reason:'pixels',
      width:actual.width,height:actual.height,mismatchedPixels:mismatch,mismatchRatio,
      channelTolerance,maxMismatchRatio},
    diffPng:overlay&&mismatch?PNG.sync.write(overlay):null};
}
function comparePng(actualBytes,baselineBytes,options={}) {
  return comparePngDetailed(actualBytes,baselineBytes,options).result;
}

class VisualTestBridge {
  constructor({playwright=null,artifactsDir=resolve('out/visual-test-bridge')}={}) {
    this.playwright=playwright;this.artifactsDir=resolve(artifactsDir);
    this.app=null;this.browser=null;this.context=null;this.page=null;
    this.mode=null;this.profileRoot=null;this.tracing=false;this.logs=[];this.artifacts=[];
    this.snapshots=new Map();this.sessionIndex=0;
    this.boundPages=new WeakSet();this.windowIds=new WeakMap();this.nextWindowId=1;
  }
  record(kind,detail) {
    this.logs.push({at:new Date().toISOString(),kind,detail:safeText(detail)});
    if(this.logs.length>MAX_LOGS)this.logs.shift();
  }
  currentPage(){if(!this.page)throw Error('Bridge has no launched test session');return this.page;}
  bindPage(page){
    if(this.boundPages.has(page))return;
    this.boundPages.add(page);
    page.on('pageerror',error=>this.record('pageerror',error.message));
    page.on('console',message=>{if(message.type()==='error')this.record('console-error',message.text());});
    page.on('requestfailed',request=>this.record('requestfailed',request.method()+' '+new URL(request.url()).pathname+' '+(request.failure()?.errorText||'')));
    page.on('response',response=>{if(response.status()>=400)
      this.record('http-error',response.status()+' '+new URL(response.url()).pathname);});
    page.on('crash',()=>this.record('crash','Renderer process crashed'));
  }
  async launch({mode,executablePath,appPath,url,width=1280,height=800}={}) {
    if(this.page||this.app||this.browser)throw Error('A test session is already active');
    if(!['electron-development','electron-installed','web'].includes(mode))throw Error('Unsupported test mode');
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<800||width>3840||height<570||height>2160)
      throw Error('Viewport out of tested bounds');
    const pw=this.playwright||require('playwright');
    this.mode=mode;
    this.logs=[];
    try {
      if(mode==='web'){
        const preview=localUrl(url);
        this.browser=await pw.chromium.launch({headless:true,chromiumSandbox:true});
        this.context=await this.browser.newContext({viewport:{width,height},deviceScaleFactor:1,
          serviceWorkers:'block'});
        // Local previews are deliberately not allowed to load scripts, fonts,
        // requests, redirects or WebSocket traffic from unrelated origins.
        // Keep this restriction on WEB testing only, not on product Electron.
        await this.context.route('**/*',route=>{
          let target;
          try{target=new URL(route.request().url());}catch{
            this.record('network-blocked','invalid URL');
            return route.abort('blockedbyclient');
          }
          if(target.origin!==preview.origin){
            this.record('network-blocked','off-origin HTTP request');
            return route.abort('blockedbyclient');
          }
          return route.continue();
        });
        await this.context.routeWebSocket('**/*',ws=>{
          let target;
          try{target=new URL(ws.url());}catch{
            this.record('websocket-blocked','invalid URL');
            return ws.close({code:1008,reason:'Invalid WebSocket URL'});
          }
          if(target.protocol!=='ws:'||'http://'+target.host!==preview.origin){
            this.record('websocket-blocked','off-origin WebSocket');
            return ws.close({code:1008,reason:'External WebSocket denied'});
          }
          return ws.connectToServer();
        });
        this.context.on('page',page=>this.bindPage(page));
        this.page=await this.context.newPage();
        this.bindPage(this.page);
        await this.page.goto(preview.href,{waitUntil:'domcontentloaded',timeout:60000});
        if(new URL(this.page.url()).origin!==preview.origin)
          throw Error('Preview escaped its authorized local origin');
      }else{
        // Local test grants are NOT product authorization. The caller must run in
        // an isolated Windows account / CI runner / VM, never a user's interactive session.
        if(process.env.ORDAX_VISUAL_ISOLATED_SESSION!=='1')throw Error('Electron tests require an attested isolated operator session');
        if(typeof executablePath!=='string'||!isAbsolute(executablePath)||!existsSync(executablePath))
          throw Error('An existing absolute Electron executable is required');
        if(mode==='electron-installed' && basename(executablePath)!=='OrdaX OS Desktop Dev.exe')
          throw Error('Installed mode requires the canonical Desktop executable');
        if(mode==='electron-development' && basename(executablePath).toLowerCase()!=='electron.exe')
          throw Error('Development mode requires the pinned Electron executable');
        if(mode==='electron-development' &&
          (!isAbsolute(appPath||'')||!existsSync(join(appPath,'main.cjs'))))
          throw Error('Development mode requires the canonical Electron app directory');
        this.profileRoot=mkdtempSync(join(tmpdir(),'ordax-visual-bridge-'));
        const profileDir=join(this.profileRoot,'OrdaX OS Desktop Dev Test');
        mkdirSync(profileDir,{recursive:true});
        this.app=await pw._electron.launch({
          executablePath,args:mode==='electron-development'?[appPath]:[],
          cwd:mode==='electron-development'?appPath:undefined,
          env:isolatedElectronEnv(process.env,{
            development:mode==='electron-development',profileDir}),
          chromiumSandbox:true,timeout:120000,
        });
        const child=this.app.process();
        child.stdout?.on('data',data=>this.record('electron-stdout',String(data)));
        child.stderr?.on('data',data=>this.record('electron-stderr',String(data)));
        // Bind before waiting for firstWindow so early renderer logs are captured.
        this.app.on('window',page=>this.bindPage(page));
        for(const page of this.app.windows())this.bindPage(page);
        this.page=await this.app.firstWindow({timeout:120000});
        this.context=this.page.context();
        this.bindPage(this.page);
      }
      await this.context.tracing.start({screenshots:true,snapshots:true,sources:false});
      this.tracing=true;
      this.sessionIndex++;
      return {mode,windows:await this.listWindows(),profileIsolated:mode!=='web',
        browserSandbox:true};
    }catch(error){await this.close();throw error;}
  }
  uniqueEvidencePath(stem,extension) {
    // A new bridge process may reuse a caller-supplied artifact directory.
    // Preserve existing ZIPs and diagnostics instead of silently replacing them.
    const initial=join(this.artifactsDir,stem+'.'+extension);
    if(!existsSync(initial))return initial;
    for(let index=2;index<=9999;index++){
      const name=stem+'-v'+String(index).padStart(2,'0')+'.'+extension;
      const candidate=join(this.artifactsDir,name);
      if(!existsSync(candidate))return candidate;
    }
    throw Error('No unused evidence identifier remains');
  }
  tracePath(){
    const stem=this.sessionIndex===1?'trace':
      'trace-'+String(this.sessionIndex).padStart(2,'0');
    return this.uniqueEvidencePath(stem,'zip');
  }
  async close() {
    try{
      if(this.tracing&&this.context){
        mkdirSync(this.artifactsDir,{recursive:true});
        const path=this.tracePath();
        await this.context.tracing.stop({path});
        this.artifacts.push(path);
      }
    }finally{
      this.tracing=false;
      try{if(this.app)await this.app.close();if(this.browser)await this.browser.close();}
      finally{
        this.app=null;this.browser=null;this.context=null;this.page=null;this.mode=null;
        if(this.profileRoot){rmSync(this.profileRoot,{recursive:true,force:true});this.profileRoot=null;}
      }
    }
    return {closed:true,artifacts:[...this.artifacts]};
  }
  windowId(page){
    if(!this.windowIds.has(page))this.windowIds.set(page,this.nextWindowId++);
    return this.windowIds.get(page);
  }
  async listWindows() {
    this.currentPage();
    const pages=(this.app?this.app.windows():this.context.pages()).filter(p=>!p.isClosed());
    return Promise.all(pages.map(async(page)=>({
      id:this.windowId(page),title:safeText(await page.title()),
      path:(new URL(page.url())).pathname,closed:false,selected:page===this.page
    })));
  }
  async selectWindow({id}={}) {
    this.currentPage();
    if(!Number.isInteger(id)||id<1)throw Error('Window selection requires a listed numeric ID');
    const pages=(this.app?this.app.windows():this.context.pages()).filter(p=>!p.isClosed());
    const selected=pages.find(page=>this.windowId(page)===id);
    if(!selected)throw Error('Window ID not present in the current test session');
    this.page=selected;
    this.bindPage(selected);
    // Focus is confined to the dedicated VM/CI desktop or headless browser.
    await selected.bringToFront();
    return {id,path:(new URL(selected.url())).pathname,selected:true};
  }
  locator({role,name,testId,css}={}) {
    const page=this.currentPage();
    if(typeof role==='string'&&typeof name==='string'&&role.length<=40&&name.length<=160)
      return page.getByRole(role,{name,exact:true});
    if(typeof testId==='string'&&/^[a-z0-9_-]{1,80}$/i.test(testId))return page.getByTestId(testId);
    if(typeof css==='string'&&css.length>0&&css.length<=180&&!/[{};\\]/.test(css))
      return page.locator(css);
    throw Error('Target requires bounded role+name, testId or CSS');
  }
  async navigate({url}={}) {
    if(this.mode!=='web')throw Error('Navigation is only permitted in the isolated Web preview');
    const page=this.currentPage(),source=localUrl(page.url()),target=localUrl(url);
    if(source.origin!==target.origin)throw Error('Cross-origin navigation blocked');
    await page.goto(target.href,{waitUntil:'domcontentloaded'});
    return {path:target.pathname};
  }
  async inspect({target={css:'#ordax-root'}}={}) {
    const locator=this.locator(target);
    const count=await locator.count();
    if(count!==1)return {count,found:false};
    const item=locator.first();
    const style=await item.evaluate(el=>{
      const css=getComputedStyle(el);
      const box=el.getBoundingClientRect();
      return {tag:el.tagName.toLowerCase(),role:el.getAttribute('role'),
        ariaLabel:el.getAttribute('aria-label'),text:(el.textContent||'').trim().slice(0,160),
        style:{display:css.display,visibility:css.visibility,opacity:css.opacity,
          overflow:css.overflow,position:css.position,zIndex:css.zIndex,
          color:css.color,backgroundColor:css.backgroundColor},
        bounds:{x:box.x,y:box.y,width:box.width,height:box.height}};
    });
    return {count,found:true,visible:await item.isVisible(),...style};
  }
  async assertTarget({target,visible=true,textContains,minWidth=0,minHeight=0,timeoutMs=10000}={}) {
    if(typeof visible!=='boolean'||typeof timeoutMs!=='number'||
       !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000||
       ![minWidth,minHeight].every(x=>Number.isFinite(x)&&x>=0&&x<=3840)||
       (textContains!==undefined&&(typeof textContains!=='string'||
         textContains.length===0||textContains.length>160))||
       (!visible&&(minWidth>0||minHeight>0)))
      throw Error('Invalid bounded semantic assertion');
    const locator=this.locator(target);
    try{await locator.first().waitFor({state:'attached',timeout:timeoutMs});}
    catch{throw Error('Expected semantic target is not mounted');}
    if(await locator.count()!==1)throw Error('Expected semantic target is not unique');
    try{await locator.waitFor({state:visible?'visible':'hidden',timeout:timeoutMs});}
    catch{throw Error('Semantic target visibility does not match expectation');}
    if(await locator.count()!==1)throw Error('Semantic target became unavailable');
    if(textContains!==undefined){
      const contains=await locator.evaluate((el,needle)=>
        (el.textContent||'').slice(0,8192).includes(needle),textContains);
      if(!contains)throw Error('Semantic target does not include required text');
    }
    const box=await locator.boundingBox();
    if(visible&&(!box||box.width<minWidth||box.height<minHeight))
      throw Error('Semantic target is smaller than required bounds');
    return {passed:true,visible,textMatched:textContains===undefined?null:true,
      bounds:box?{width:box.width,height:box.height}:null};
  }
  async click({target}={}) {await this.locator(target).click({timeout:10000});return {clicked:true};}
  async type({target,text}={}) {
    if(typeof text!=='string'||text.length>4096)throw Error('Invalid input length');
    await this.locator(target).fill(text,{timeout:10000});return {typed:true,length:text.length};
  }
  nextCaptureName(base) {
    const label=boundedName(base);
    for(let index=1;index<=9999;index++){
      const candidate=index===1?label:label+'-'+String(index).padStart(2,'0');
      if(!this.snapshots.has(candidate)&&!existsSync(join(this.artifactsDir,candidate+'.png')))
        return candidate;
    }
    throw Error('No unused bounded screenshot identifier remains');
  }
  async screenshot({name='desktop'}={}) {
    const label=boundedName(name),file=join(this.artifactsDir,label+'.png');
    this.currentPage();
    mkdirSync(this.artifactsDir,{recursive:true});
    if(this.snapshots.has(label)||existsSync(file))
      throw Error('Screenshot identifier already captured; choose a distinct name');
    const bytes=await this.currentPage().screenshot({animations:'disabled'});
    // wx prevents accidental replacement even if another process creates
    // an artifact of the same name while Chromium is rendering.
    writeFileSync(file,bytes,{flag:'wx'});
    this.artifacts.push(file);
    this.snapshots.set(label,file);
    return {file,sha256:createHash('sha256').update(bytes).digest('hex'),
      size:bytes.length};
  }
  async getAccessibilityTree() {
    return {ariaSnapshot:(await this.currentPage().locator('body').ariaSnapshot()).slice(0,30000)};
  }
  getLogs(){return {events:[...this.logs]};}
  async scanLayout() {
    return this.currentPage().evaluate(()=>{
      const selector='button,a,input,textarea,select,[role="button"]';
      const allNodes=[...document.querySelectorAll(selector)];
      const viewport={width:innerWidth,height:innerHeight};
      const offscreen=[],clipped=[],tiny=[],hidden=[],disabled=[],clippedByAncestor=[],overlapping=[];
      const visible=[];
      const activeDialog=[...document.querySelectorAll('[role="dialog"][aria-modal="true"],dialog[open][aria-modal="true"]')]
        .find(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
      // An active modal may appear after hundreds of background controls.
      // Filter background BEFORE applying the bounded 300-control scan.
      const activeNodes=activeDialog?allNodes.filter(el=>activeDialog.contains(el)):allNodes;
      const nodes=activeNodes.slice(0,300);
      let excludedBackgroundTargets=allNodes.length-activeNodes.length;
      for(const el of nodes){
        const name=(el.getAttribute('aria-label')||el.textContent||el.tagName).trim().slice(0,70);
        // The underlying desktop remains mounted while First Run / a modal is
        // active. Never diagnose its intentionally inert background as clickable.
        if((activeDialog&&!activeDialog.contains(el))||
           el.closest('[inert],[aria-hidden="true"]')){
          excludedBackgroundTargets++;
          continue;
        }
        const s=getComputedStyle(el),r=el.getBoundingClientRect();
        if(!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})||
           s.pointerEvents==='none'||r.width<=0||r.height<=0){
          hidden.push(name);
          continue;
        }
        if(el.matches(':disabled,[aria-disabled="true"]')){
          disabled.push(name);
          continue;
        }
        if(r.right<=0||r.bottom<=0||r.left>=viewport.width||r.top>=viewport.height){
          offscreen.push(name);
          continue;
        }
        if(r.left<0||r.top<0||r.right>viewport.width||r.bottom>viewport.height)clipped.push(name);
        if(r.width<24||r.height<24)tiny.push(name);
        visible.push({el,name,r});
        for(let parent=el.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
          const ps=getComputedStyle(parent);
          if(!/(hidden|clip|scroll|auto)/.test(ps.overflowX+' '+ps.overflowY))continue;
          const pr=parent.getBoundingClientRect();
          if(r.left<pr.left-1||r.top<pr.top-1||r.right>pr.right+1||r.bottom>pr.bottom+1){
            clippedByAncestor.push(name);
            break;
          }
        }
      }
      for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){
        const a=visible[i],b=visible[j];
        if(a.el.contains(b.el)||b.el.contains(a.el))continue;
        const dx=Math.max(0,Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left));
        const dy=Math.max(0,Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top));
        const ratio=dx*dy/Math.max(1,Math.min(a.r.width*a.r.height,b.r.width*b.r.height));
        if(ratio>=0.4){
          overlapping.push({a:a.name,b:b.name,coverage:Math.round(ratio*1000)/1000});
          if(overlapping.length>=30)break;
        }
      }
      return {viewport,interactiveElements:allNodes.length,scannedInteractiveElements:nodes.length,
        unscannedInteractiveElements:activeNodes.length-nodes.length,visibleHitTargets:visible.length,
        activeModal:!!activeDialog,excludedBackgroundTargets,
        disabledInteractiveElements:disabled.slice(0,30),
        hiddenInteractiveElements:hidden.slice(0,30),
        offscreen:offscreen.slice(0,30),viewportClipped:clipped.slice(0,30),
        parentClipped:clippedByAncestor.slice(0,30),
        overlappingHitTargets:overlapping.slice(0,30),smallHitTargets:tiny.slice(0,30)};
    });
  }
  async compareVisual({name,baseline,referenceCapture,channelTolerance=10,maxMismatchRatio=0.001}={}) {
    const id=boundedName(name);
    if(baseline&&referenceCapture)throw Error('Select either a versioned baseline or a captured rendering');
    let reference;
    if(referenceCapture!==undefined){
      const label=boundedName(referenceCapture);
      reference=this.snapshots.get(label);
      if(!reference||!existsSync(reference))
        return {match:false,reason:'capture-missing',referenceCapture:label};
    }else{
      const base=resolve(__dirname,'baselines');
      reference=resolve(base,boundedName(baseline||id)+'.png');
      if(!reference.startsWith(base+require('node:path').sep)||!existsSync(reference))
        return {match:false,reason:'baseline-missing',baseline:reference};
    }
    const {statSync}=require('node:fs');
    if(statSync(reference).size>20*1024*1024)throw Error('Visual reference exceeds the 20MB bound');
    const current=await this.currentPage().screenshot({animations:'disabled'});
    const {result,diffPng}=comparePngDetailed(current,readFileSync(reference),
      {channelTolerance,maxMismatchRatio},true);
    let diffFile=null;
    if(diffPng){
      mkdirSync(this.artifactsDir,{recursive:true});
      diffFile=join(this.artifactsDir,id+'-diff.png');
      writeFileSync(diffFile,diffPng,{flag:'wx'});
      this.artifacts.push(diffFile);
    }
    return {...result,reference,diffFile};
  }
  async runE2E({scenario='native-smoke',steps=[]}={}) {
    if(!['native-smoke','semantic-journey'].includes(scenario))throw Error('Unknown E2E scenario');
    const page=this.currentPage();
    await page.locator('#ordax-root').waitFor({state:'visible',timeout:90000});
    await page.locator('#ordax-boot-screen[data-state="ready"]').waitFor({state:'attached',timeout:90000});
    if(!(await page.locator('#ordax-root').evaluate(el=>el.childElementCount>0)))
      throw Error('Surface root is empty');
    const assertions=[];
    if(scenario==='semantic-journey'){
      if(!Array.isArray(steps)||steps.length===0||steps.length>30)
        throw Error('Semantic journey must provide 1..30 steps');
      for(let index=0;index<steps.length;index++){
        const step=steps[index];
        try {
          if(!['click','type','inspect','assert'].includes(step?.op))
            throw Error('E2E step not allowed');
          if(step.op==='inspect'){
            // Introspection alone must never be counted as a successful assertion
            // when its target is absent. Preserve inspect's read-only semantics
            // outside E2E while enforcing a visible, unique target inside E2E.
            const result=await this.assertTarget({target:step.args?.target});
            assertions.push({step:index+1,op:step.op,...result});
          }else {
            const result=await this.execute(step);
            if(step.op==='assert')assertions.push({step:index+1,op:step.op,...result});
          }
        }catch(error){
          this.record('e2e-step-failed','Step '+(index+1)+' ('+String(step?.op||'unknown')+')');
          try{await this.screenshot({name:this.nextCaptureName('e2e-failed-'+String(index+1).padStart(2,'0'))});}
          catch{this.record('e2e-evidence-failed','Could not capture failing step');}
          throw error;
        }
      }
    }
    const critical=this.logs.filter(l=>l.kind==='pageerror'||l.kind==='crash');
    if(critical.length)throw Error('Native E2E detected '+critical.length+' renderer exceptions/crashes');
    const visual=await this.screenshot({name:this.nextCaptureName(scenario)});
    const scan=await this.scanLayout();
    return {scenario,passed:true,visual,scan,assertions,jsErrors:critical};
  }
  async collectArtifacts() {
    mkdirSync(this.artifactsDir,{recursive:true});
    if(this.tracing&&this.context){
      const trace=this.tracePath();
      await this.context.tracing.stop({path:trace});
      this.tracing=false;this.artifacts.push(trace);
    }
    const stem=this.sessionIndex<=1?'diagnostics':
      'diagnostics-'+String(this.sessionIndex).padStart(2,'0');
    const logsPath=this.uniqueEvidencePath(stem,'json');
    writeFileSync(logsPath,JSON.stringify({schema:'ordax.visual-test-evidence/1',
      recordedAt:new Date().toISOString(),mode:this.mode,session:this.sessionIndex,
      events:this.logs,artifacts:[...this.artifacts]},null,2)+'\n',{flag:'wx'});
    return {diagnostics:logsPath,artifacts:[...this.artifacts]};
  }
  async execute(request) {
    if(!request||typeof request!=='object'||!OPERATIONS.has(request.op))throw Error('Unknown bridge operation');
    const args=request.args||{};
    switch(request.op){
      case 'launch':return this.launch(args);
      case 'close':return this.close();
      case 'list_windows':return this.listWindows();
      case 'select_window':return this.selectWindow(args);
      case 'navigate':return this.navigate(args);
      case 'inspect':return this.inspect(args);
      case 'assert':return this.assertTarget(args);
      case 'click':return this.click(args);
      case 'type':return this.type(args);
      case 'screenshot':return this.screenshot(args);
      case 'get_logs':return this.getLogs();
      case 'get_accessibility_tree':return this.getAccessibilityTree();
      case 'run_e2e':return this.runE2E(args);
      case 'compare_visual':return this.compareVisual(args);
      case 'collect_artifacts':return this.collectArtifacts();
      case 'scan_layout':return this.scanLayout();
      default:throw Error('Unsupported operation');
    }
  }
}
module.exports={VisualTestBridge,localUrl,safeText,comparePng,OPERATIONS,isolatedElectronEnv};