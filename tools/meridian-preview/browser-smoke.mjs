#!/usr/bin/env node
// Focused preview regressions using the repository's shared Chromium proof runner.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runBrowser, sleep } from '../browser-proof/chromium.mjs';
import { sections, sceneOptions } from '../../system/surface/experiments/meridian/catalog.mjs';

const evidence = resolve(process.env.MERIDIAN_EVIDENCE_DIR ?? 'out/meridian-proof');
await mkdir(evidence, { recursive: true });
const host = spawn(process.env.ORDAX_PYTHON ?? 'python', ['tools/meridian-preview/serve.py', '--port', '0'], {
  cwd: resolve(import.meta.dirname, '../..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let hostLog = '';
host.stderr.on('data', chunk => { hostLog += chunk; });
const checks = [], captures = [];
function check(label, condition) { assert.ok(condition, label); checks.push(label); }
try {
  const origin = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(Error('Preview host startup timed out')), 30000);
    let output = '';
    host.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); done(match[0]); }
    });
    host.once('error', error => { clearTimeout(timer); fail(error); });
    host.once('exit', code => { clearTimeout(timer); fail(Error('Preview host exited: '+code)); });
  });
  const response = await fetch(origin);
  check('Preview is reachable', response.status === 200);
  check('Network and forms are denied by CSP', response.headers.get('content-security-policy').includes("connect-src 'none'") && response.headers.get('content-security-policy').includes("form-action 'none'"));
  for (const path of ['/README.md','/.git/config','/docs/contracts/spaces.json','/api/identity','/system/surface/experiments/meridian/','/system/surface/experiments/meridian/%2e%2e/../workspace/state.mjs'])
    check('Static allowlist denies '+path, (await fetch(origin+path)).status === 404);
  check('No write endpoint', (await fetch(origin, {method:'POST',body:'preview-only'})).status === 501);
  await runBrowser(async client => {
    await client.send('Network.enable');
    const evaluate = async expression => {
      const result = await client.send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? 'Browser evaluation failed');
      return result.result?.value;
    };
    const until = async expression => {
      const deadline = Date.now()+15000;
      while (!await evaluate(expression)) { if (Date.now()>deadline) throw Error('Timed out: '+expression); await sleep(50); }
    };
    const navigate = async query => {
      await client.send('Page.navigate',{url:'about:blank'});
      await until('location.href==="about:blank" && !document.querySelector("[data-meridian]")');
      await client.send('Page.navigate',{url:origin+'/'+query});
      await until("document.readyState==='complete' && !!document.querySelector('[data-meridian] .md-main')");
      await evaluate('document.fonts.ready.then(()=>true)');
    };
    const viewport = async (width,height) => {
      await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    };
    const click = async selector => {
      const point = await evaluate('(()=>{const el=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(n=>n.getClientRects().length);if(!el)throw Error("Missing visible control");el.scrollIntoView({block:"center",behavior:"instant"});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
      await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    };
    const action = value => click('[data-action='+JSON.stringify(value)+']');
    const type = async (selector,text) => { await click(selector); await client.send('Input.insertText',{text}); };
    const key = async (key,code,modifiers=0) => {
      const windowsVirtualKeyCode=({Escape:27,Tab:9,KeyK:75})[code];
      await client.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode});
      await client.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode});
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    };
    const shot = async name => {
      const result = await client.send('Page.captureScreenshot',{format:'png'});
      await writeFile(resolve(evidence,name+'.png'),Buffer.from(result.data,'base64'));
    };
    const inspect = async label => {
      const geometry = await evaluate('(()=>{const main=document.querySelector(".md-main");return{width:innerWidth,height:innerHeight,document:document.documentElement.scrollWidth,main:main.scrollWidth,mainClient:main.clientWidth,dialog:document.querySelector("dialog")?.getBoundingClientRect().toJSON(),markerVisible:!!document.querySelector(".md-demo-label")?.getClientRects().length}})()');
      check(label+' has no horizontal page overflow',geometry.document<=geometry.width+1 && geometry.main<=geometry.mainClient+1);
      const ax = await client.send('Accessibility.getFullAXTree');
      const unnamed = ax.nodes.filter(n=>!n.ignored && ['button','switch','checkbox'].includes(n.role?.value) && !n.name?.value?.trim());
      check(label+' has named controls',unnamed.length===0);
      captures.push({label,...geometry});
    };
    try {
      for (const [surface,query] of [['argila',''],['grafite','?material=ink'],['desktop','?surface=desktop']]) {
        await navigate(query);
        check(surface+' token stylesheet loaded',await evaluate('getComputedStyle(document.querySelector("[data-meridian]")).getPropertyValue("--md-canvas").trim()')===(surface==='grafite'?'#202824':'#f4f2ed'));
        for (const [width,height] of [[1440,900],[1024,768],[768,600],[390,844],[320,568],[844,390]]) {
          await viewport(width,height);
          await inspect(surface+' '+width+'x'+height);
          if (width===1440 || width===390) await shot(surface+'-'+width);
        }
      }
      await viewport(390,844); await navigate('');
      await type('#md-central-prompt','Rascunho ainda não enviado');
      await key('k','KeyK',2);
      await until('!!document.querySelector("dialog[open]")');
      check('Search receives focus',await evaluate('document.activeElement.matches("dialog input")'));
      await key('Escape','Escape');
      check('Keyboard dialog restores originating input',await evaluate('document.activeElement.id==="md-central-prompt"'));
      check('Unsent Central text survives dialog',await evaluate('document.querySelector("#md-central-prompt").value==="Rascunho ainda não enviado"'));
      await key('k','KeyK',2);
      for(let index=0;index<32;index++) {
        await key('Tab','Tab');
        check('Modal retains keyboard focus '+index,await evaluate('!!document.activeElement.closest("dialog") || document.activeElement===document.body'));
      }
      await key('Escape','Escape');
      await viewport(1440,900);
      await action('panel:spaces'); await action('select-space:personal');
      check('Unsent text is isolated by Space',await evaluate('document.querySelector("#md-central-prompt").value===""'));
      await action('panel:spaces'); await action('select-space:studio');
      check('Returning to Space restores its draft',await evaluate('document.querySelector("#md-central-prompt").value==="Rascunho ainda não enviado"'));
      await click('[data-form="ask"] button[type="submit"]');
      check('Submitted prompt appears as text',await evaluate('document.querySelector(".md-request p").textContent==="Rascunho ainda não enviado"'));
      await action('route:central');
      check('Successful submission clears draft',await evaluate('document.querySelector("#md-central-prompt").value===""'));
      await key('k','KeyK',2); await action('route:messages');
      const conversations = await evaluate('[...document.querySelectorAll(".md-message-card")].map(n=>n.dataset.action)');
      await action(conversations[0]); await type('#md-reply','Resposta <img src=x> de exemplo');
      await action('panel:close'); await action(conversations[1]);
      check('Reply drafts are isolated by conversation',await evaluate('document.querySelector("#md-reply").value===""'));
      await action('panel:close'); await action(conversations[0]);
      check('Unsent reply survives closing panel',await evaluate('document.querySelector("#md-reply").value==="Resposta <img src=x> de exemplo"'));
      await click('[data-form="reply"] button[type="submit"]');
      check('Reply text is escaped',await evaluate('!document.querySelector(".md-conversation-thread img") && document.querySelector(".md-chat-message.is-own p").textContent.includes("<img src=x>")'));
      check('Sent reply clears composer',await evaluate('document.querySelector("#md-reply").value===""'));
      await action('panel:close');

      for (const section of sections) {
        await navigate('?area='+section.id);
        await viewport(390,844); await inspect('route '+section.id);
        check('Route '+section.id+' renders main content',await evaluate('document.querySelector(".md-main").textContent.trim().length>0'));
      }
      await viewport(1440,900); await navigate('');
      for (const scene of sceneOptions) {
        await action('panel:scenes'); await action('scene:'+scene.id);
        await inspect('scenario '+scene.id);
        check('Scenario '+scene.id+' selected',await evaluate('!document.querySelector("dialog")'));
      }
      await action('panel:scenes'); await action('scene:connected');
      await action('route:settings'); await action('motion'); await action('text-size');
      check('Motion preference reaches root',await evaluate('document.querySelector("[data-meridian]").dataset.reduceMotion==="true"'));
      check('Text preference reaches root',await evaluate('document.querySelector("[data-meridian]").dataset.largeText==="true"'));
      await action('route:central');
      check('Motion preference stops page animation',await evaluate('getComputedStyle(document.querySelector(".md-page")).animationDuration.split(",").every(v=>parseFloat(v)===0)'));
      await viewport(320,568); await inspect('large text 320');
      await viewport(1440,900); await action('app:notes');
      await type('#md-note-draft','Rascunho de janela');
      await action('window-compact:notes'); await action('app:studio');
      await viewport(390,844); await inspect('Desktop expanded + compact');
      check('Compact draft survives opening another app',await evaluate('document.querySelector("#md-note-draft").value.includes("Rascunho de janela")'));
      await shot('desktop-compact-390');
      await viewport(1440,900); await action('window-minimize:notes'); await action('app:notes');
      check('Minimized draft survives restore',await evaluate('document.querySelector("#md-note-draft").value.includes("Rascunho de janela")'));
      await shot('desktop-windows-1440');
      check('No remote requests',client.events.filter(e=>e.method==='Network.requestWillBeSent').every(e=>e.params.request.url.startsWith(origin+'/') || e.params.request.url.startsWith('data:')));
    } catch (error) {
      await shot('failure').catch(()=>{});
      await writeFile(resolve(evidence,'browser-failure.json'),JSON.stringify({message:error.message,events:client.events.filter(e=>/exception|loadingFailed|entryAdded/.test(e.method)).slice(-25)},null,2));
      throw error;
    }
  });
  console.log('MERIDIAN_BROWSER_PROOF=PASS');
} finally {
  host.kill();
  await writeFile(resolve(evidence,'results.json'),JSON.stringify({checks,captures},null,2));
  await writeFile(resolve(evidence,'preview-host.log'),hostLog);
  console.log('MERIDIAN_ASSERTIONS='+checks.length);
}
