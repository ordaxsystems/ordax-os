'use strict';
// Visual Test Bridge: local, ephemeral test process. NOT a product IPC, HTTP server or MCP authority.
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync}=require('node:fs');
const {resolve,join,basename,isAbsolute}=require('node:path');
const {tmpdir}=require('node:os');
const {createHash}=require('node:crypto');

const MAX_LOGS=500;
const OPERATIONS=new Set(['launch','close','list_windows','navigate','inspect','click','type','screenshot','get_logs','get_accessibility_tree','run_e2e','compare_visual','collect_artifacts','scan_layout']);
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
    .replace(/https?:\/\/[^\s/'"]+([^\s'"]*)/g,(_full,path)=>path.split('?')[0])
    .slice(0,1200);
}
function boundedName(input) {
  if(typeof input!=='string'||!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(input))throw Error('Invalid artifact identifier');
  return input;
}
function comparePng(actualBytes,baselineBytes,{channelTolerance=10,maxMismatchRatio=0.001}={}) {
  if(!Number.isInteger(channelTolerance)||channelTolerance<0||channelTolerance>255 ||
     typeof maxMismatchRatio!=='number'||maxMismatchRatio<0||maxMismatchRatio>1)
    throw Error('Invalid comparison tolerances');
  const {PNG}=require('pngjs');
  const actual=PNG.sync.read(actualBytes), baseline=PNG.sync.read(baselineBytes);
  if(actual.width!==baseline.width||actual.height!==baseline.height)
    return {match:false,reason:'dimensions',actual:[actual.width,actual.height],
      baseline:[baseline.width,baseline.height],mismatchedPixels:null};
  let mismatch=0;
  for(let i=0;i<actual.data.length;i+=4){
    if([0,1,2,3].some(c=>Math.abs(actual.data[i+c]-baseline.data[i+c])>channelTolerance))mismatch++;
  }
  const pixels=actual.width*actual.height;
  const mismatchRatio=mismatch/pixels;
  return {match:mismatchRatio<=maxMismatchRatio,reason:'pixels',
    width:actual.width,height:actual.height,mismatchedPixels:mismatch,mismatchRatio,
    channelTolerance,maxMismatchRatio};
}

class VisualTestBridge {
  constructor({playwright=null,artifactsDir=resolve('out/visual-test-bridge')}={}) {
    this.playwright=playwright;this.artifactsDir=resolve(artifactsDir);
    this.app=null;this.browser=null;this.context=null;this.page=null;
    this.mode=null;this.profileRoot=null;this.tracing=false;this.logs=[];this.artifacts=[];
  }
  record(kind,detail) {
    this.logs.push({at:new Date().toISOString(),kind,detail:safeText(detail)});
    if(this.logs.length>MAX_LOGS)this.logs.shift();
  }
  currentPage(){if(!this.page)throw Error('Bridge has no launched test session');return this.page;}
  bindPage(page){
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
    try {
      if(mode==='web'){
        const preview=localUrl(url);
        this.browser=await pw.chromium.launch({headless:true,chromiumSandbox:true});
        this.context=await this.browser.newContext({viewport:{width,height},deviceScaleFactor:1});
        this.page=await this.context.newPage();
        this.bindPage(this.page);
        await this.page.goto(preview.href,{waitUntil:'domcontentloaded',timeout:60000});
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
          env:{...process.env,ORDAX_DESKTOP_TEST_PROFILE:'1',
            ORDAX_DESKTOP_TEST_PROFILE_DIR:profileDir},
          chromiumSandbox:true,timeout:120000,
        });
        const child=this.app.process();
        child.stdout?.on('data',data=>this.record('electron-stdout',String(data)));
        child.stderr?.on('data',data=>this.record('electron-stderr',String(data)));
        this.page=await this.app.firstWindow({timeout:120000});
        this.context=this.page.context();
        this.bindPage(this.page);
        this.app.on('window',page=>this.bindPage(page));
      }
      await this.context.tracing.start({screenshots:true,snapshots:true,sources:false});
      this.tracing=true;
      return {mode,windows:await this.listWindows(),profileIsolated:mode!=='web',
        browserSandbox:true};
    }catch(error){await this.close();throw error;}
  }
  async close() {
    try{
      if(this.tracing&&this.context){
        mkdirSync(this.artifactsDir,{recursive:true});
        const path=join(this.artifactsDir,'trace.zip');
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
  async listWindows() {
    this.currentPage();
    const pages=this.app?this.app.windows():this.context.pages();
    return Promise.all(pages.map(async(page,index)=>({id:index,
      title:safeText(await page.title()),path:(new URL(page.url())).pathname,closed:page.isClosed()})));
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
  async click({target}={}) {await this.locator(target).click({timeout:10000});return {clicked:true};}
  async type({target,text}={}) {
    if(typeof text!=='string'||text.length>4096)throw Error('Invalid input length');
    await this.locator(target).fill(text,{timeout:10000});return {typed:true,length:text.length};
  }
  async screenshot({name='desktop'}={}) {
    const file=join(this.artifactsDir,boundedName(name)+'.png');
    mkdirSync(this.artifactsDir,{recursive:true});
    const bytes=await this.currentPage().screenshot({path:file,animations:'disabled'});
    this.artifacts.push(file);
    return {file,sha256:createHash('sha256').update(bytes).digest('hex'),
      size:bytes.length};
  }
  async getAccessibilityTree() {
    return {ariaSnapshot:(await this.currentPage().locator('body').ariaSnapshot()).slice(0,30000)};
  }
  getLogs(){return {events:[...this.logs]};}
  async scanLayout() {
    return this.currentPage().evaluate(()=>{
      const nodes=[...document.querySelectorAll('button,a,input,textarea,select,[role="button"]')].slice(0,300);
      const viewport={width:innerWidth,height:innerHeight},offscreen=[],clipped=[],tiny=[];
      for(const el of nodes){
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        if(s.display==='none'||s.visibility==='hidden')continue;
        const name=(el.getAttribute('aria-label')||el.textContent||el.tagName).trim().slice(0,70);
        if(r.right<=0||r.bottom<=0||r.left>=viewport.width||r.top>=viewport.height)offscreen.push(name);
        else if(r.left<0||r.top<0||r.right>viewport.width||r.bottom>viewport.height)clipped.push(name);
        if(r.width>0&&r.height>0&&(r.width<24||r.height<24))tiny.push(name);
      }
      return {viewport,interactiveElements:nodes.length,offscreen:offscreen.slice(0,30),
        viewportClipped:clipped.slice(0,30),smallHitTargets:tiny.slice(0,30)};
    });
  }
  async compareVisual({name,baseline,channelTolerance=10,maxMismatchRatio=0.001}={}) {
    boundedName(name);
    // Paths must remain inside the versioned baseline directory. Never update
    // approvals as a side effect of a failing test.
    const base=resolve(__dirname,'baselines');
    const candidate=resolve(base,boundedName(baseline||name)+'.png');
    if(!candidate.startsWith(base+require('node:path').sep)||!existsSync(candidate))
      return {match:false,reason:'baseline-missing',baseline:candidate};
    const current=await this.currentPage().screenshot({animations:'disabled'});
    const result=comparePng(current,readFileSync(candidate),{channelTolerance,maxMismatchRatio});
    return {...result,baseline:candidate};
  }
  async runE2E({scenario='native-smoke',steps=[]}={}) {
    if(!['native-smoke','semantic-journey'].includes(scenario))throw Error('Unknown E2E scenario');
    const page=this.currentPage();
    await page.locator('#ordax-root').waitFor({state:'visible',timeout:90000});
    await page.locator('#ordax-boot-screen[data-state="ready"]').waitFor({state:'attached',timeout:90000});
    if(!(await page.locator('#ordax-root').evaluate(el=>el.childElementCount>0)))
      throw Error('Surface root is empty');
    if(scenario==='semantic-journey'){
      if(!Array.isArray(steps)||steps.length===0||steps.length>30)
        throw Error('Semantic journey must provide 1..30 steps');
      for(const step of steps){
        if(!['click','type','inspect'].includes(step?.op))throw Error('E2E step not allowed');
        await this.execute(step);
      }
    }
    const critical=this.logs.filter(l=>l.kind==='pageerror'||l.kind==='crash');
    if(critical.length)throw Error('Native E2E detected '+critical.length+' renderer exceptions/crashes');
    const visual=await this.screenshot({name:scenario});
    const scan=await this.scanLayout();
    return {scenario,passed:true,visual,scan,jsErrors:critical};
  }
  async collectArtifacts() {
    mkdirSync(this.artifactsDir,{recursive:true});
    const logsPath=join(this.artifactsDir,'diagnostics.json');
    writeFileSync(logsPath,JSON.stringify({schema:'ordax.visual-test-evidence/1',
      recordedAt:new Date().toISOString(),mode:this.mode,events:this.logs,
      artifacts:this.artifacts},null,2)+'\n');
    if(this.tracing&&this.context){
      const trace=join(this.artifactsDir,'trace.zip');
      await this.context.tracing.stop({path:trace});
      this.tracing=false;this.artifacts.push(trace);
    }
    return {diagnostics:logsPath,artifacts:[...this.artifacts]};
  }
  async execute(request) {
    if(!request||typeof request!=='object'||!OPERATIONS.has(request.op))throw Error('Unknown bridge operation');
    const args=request.args||{};
    switch(request.op){
      case 'launch':return this.launch(args);
      case 'close':return this.close();
      case 'list_windows':return this.listWindows();
      case 'navigate':return this.navigate(args);
      case 'inspect':return this.inspect(args);
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
module.exports={VisualTestBridge,localUrl,safeText,comparePng,OPERATIONS};
