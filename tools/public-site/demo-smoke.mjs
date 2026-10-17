// Isolated browser regression for the generated public Surface; never uses a user profile.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,relative,isAbsolute,sep,join} from 'node:path';
import {runBrowser,sleep} from '../browser-proof/chromium.mjs';
const supplied=process.argv[2]??'out/public-demo-source2-20261017';
const remote=supplied.startsWith('http:')?new URL(supplied):null;if(remote&&(remote.hostname!=='127.0.0.1'||remote.pathname!=='/'))throw Error('Proof accepts only a loopback root');
const bundle=resolve(remote?'out':supplied);
const evidence=resolve('out/public-demo-proof-20261017');await mkdir(evidence,{recursive:true});
const policy=JSON.parse(await readFile('vercel.json','utf8')).headers.find(x=>x.source==='/(.*)').headers;
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{try{const path=resolve(bundle,'.'+new URL(req.url,'http://127.0.0.1').pathname.replace(/\/$/,'/index.html'));const rel=relative(bundle,path);if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error();const body=await readFile(path);res.setHeader('Content-Type',mime[extname(path)]??'application/octet-stream');for(const h of policy)if(h.key!=='Strict-Transport-Security')res.setHeader(h.key,h.value);res.end(body);}catch(error){console.error('DEMO_HTTP_ERROR',req.url,error.message);res.writeHead(404);res.end();}});
if(!remote)await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=remote?.href??('http://127.0.0.1:'+server.address().port+'/');
assert.equal((await fetch(url)).status,200);
try{await runBrowser(async client=>{
 const evaluate=async expression=>{const reply=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(reply.exceptionDetails)throw Error(reply.exceptionDetails.exception?.description);return reply.result?.value;};
 await client.send('Runtime.enable');
 for(const [name,width,height] of [['desktop',1440,1100],['phone',390,844]]){
 await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await client.send('Page.navigate',{url});
 const deadline=Date.now()+30000;while(!await evaluate('!!document.querySelector(".demo-native .meridian-home")')){if(Date.now()>deadline){await writeFile(join(evidence,'failure.json'),JSON.stringify({events:client.events.filter(x=>x.method==='Runtime.exceptionThrown'),page:await evaluate('document.body.innerText.slice(0,1000)')},null,2));throw Error('Source-rendered demo did not mount; see failure.json');}await sleep(100);}
 await evaluate('document.fonts.ready');await sleep(250);
 const state=await evaluate(`(()=>{const laptop=document.querySelector('[data-device="laptop"]'),phone=document.querySelector('[data-device="phone"]');return {width,sidebars:document.querySelectorAll('.demo-native .meridian-rail').length,homes:document.querySelectorAll('.demo-native .meridian-home').length,inlineStyles:document.querySelectorAll('.demo-native [style]').length,laptopSidebar:getComputedStyle(laptop.querySelector('.meridian-rail')).display,phoneSidebar:getComputedStyle(phone.querySelector('.meridian-rail')).display,phoneMenu:getComputedStyle(phone.querySelector('.meridian-mobile-menu')).display,hero:phone.querySelector('.meridian-hero img').complete,viewportOverflow:document.documentElement.scrollWidth>innerWidth};})()` .replace('return {width,','return {width:innerWidth,'));
 await writeFile(join(evidence,name+'-state.json'),JSON.stringify(state,null,2));const earlyShot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(evidence,name+'-initial.png'),Buffer.from(earlyShot.data,'base64'));
 assert.equal(state.sidebars,2);assert.equal(state.homes,2);assert.equal(state.inlineStyles,0);assert.equal(state.phoneSidebar,'none');assert.notEqual(state.phoneMenu,'none');assert.equal(state.viewportOverflow,false);assert.equal(state.hero,true);
 // Public controls must switch to the actual generated app page, not call services.
 await evaluate(`document.querySelector('[data-device="laptop"] [data-action="app"][data-value="settings"]').click()`);assert.equal(await evaluate(`!!document.querySelector('[data-device="laptop"] [data-ordax-settings-overview-view]')`),true);
 assert.equal(await evaluate(`document.querySelector('[data-device="laptop"]').dataset.app`),'settings');
 await evaluate(`document.querySelector('[data-recipe="home"]').click()`);await sleep(100);
 const clip=await evaluate(`(()=>{const r=document.querySelector('.laptop-viewport').getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1};})()`);const deviceShot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});await writeFile(join(evidence,name+'-device.png'),Buffer.from(deviceShot.data,'base64'));
 const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(evidence,name+'.png'),Buffer.from(shot.data,'base64'));await writeFile(join(evidence,name+'.json'),JSON.stringify(state,null,2));
 }
 assert.equal(client.events.filter(event=>event.method==='Runtime.exceptionThrown').length,0);console.log('PUBLIC_SURFACE_DEMO_PROOF=PASS');
});}finally{if(server.listening)await new Promise(r=>server.close(r));}
