import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {runBrowser,sleep} from '../../browser-proof/chromium.mjs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:4188/');
if (base.hostname !== '127.0.0.1') throw Error('Loopback regression only');
const evidence = new URL('../../../out/store-shared-proof/',import.meta.url);
await mkdir(evidence,{recursive:true});
await runBrowser(async client => {
  const evaluate = async expression => {
    const reply=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description);
    return reply.result?.value;
  };
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await client.send('Page.navigate',{url:new URL('tools/surface-web/checks/store-shared-proof.html',base).href});
  const deadline=Date.now()+30000;
  while(!await evaluate('!!window.storeProof')) {if(Date.now()>deadline)throw Error('Store fixture did not mount');await sleep(100);}
  assert.equal(await evaluate(`document.querySelector('#web').dataset.storeMode`),'planned');
  assert.equal(await evaluate(`document.querySelector('#native .ordax-store-experience').dataset.storeMode`),'official');
  await evaluate(`document.querySelector('#native [data-store-operation="install"]').click()`);await sleep(100);
  assert.equal(await evaluate('storeProof.requests.length'),1);
  assert.equal(await evaluate('storeProof.requests[0].authority'),'none');
  assert.equal(await evaluate('storeProof.entry.state'),'available','Accepted requests never become installed state');
  await evaluate(`document.querySelector('#native [data-store-switch]').click()`);
  while(!await evaluate(`!!document.querySelector('#native [data-store-preview-host]').shadowRoot?.querySelector('.feature')`)) {if(Date.now()>deadline)throw Error('Native planned view did not mount');await sleep(100);}
  assert.equal(await evaluate(`document.querySelector('#web [data-store-preview-host]').shadowRoot.querySelector('#view').innerHTML === document.querySelector('#native [data-store-preview-host]').shadowRoot.querySelector('#view').innerHTML`),true,'Both modes use identical planned markup');
  await evaluate(`document.querySelector('#web [data-store-planned]').hidden=true;document.querySelector('#web').hidden=true;document.querySelector('#native').scrollIntoView()`);
  for(const width of [1280,390]) {
    await client.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await sleep(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Store must fit its container');
    const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(new URL('planned-'+width+'.png',evidence),Buffer.from(shot.data,'base64'));
  }
  await evaluate(`const shadow=document.querySelector('#native [data-store-preview-host]').shadowRoot;shadow.querySelector('[href="#apps"]').click();shadow.querySelector('[data-action="install"][data-id="media"]').click()`);await sleep(100);
  assert.equal(await evaluate(`document.querySelector('#native [data-store-preview-host]').shadowRoot.querySelector('#queue-dock').textContent.includes('Player de Mídia')`),true,'Mock operation is visible in its own queue');
  assert.equal(await evaluate('storeProof.requests.length'),1,'Simulated operations never reach the lifecycle port');
  await evaluate(`document.querySelector('#native [data-store-switch]').click()`);
  assert.equal(await evaluate(`document.querySelector('#native [data-store-app-card]').dataset.storeEntryState`),'available');
  await evaluate('storeProof.native.destroy();storeProof.web.destroy()');
  assert.equal(await evaluate('storeProof.catalogListeners.size'),0,'Destroy releases catalog subscriptions');
  // Also exercise the shipped React composition, not only the DOM port harness.
  const webUrl = new URL(process.argv[3] ?? 'http://127.0.0.1:4187/?preview=layout');
  if (webUrl.hostname !== '127.0.0.1') throw Error('Loopback Web regression only');
  await client.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await client.send('Page.navigate',{url:webUrl.href});
  let until = Date.now()+30000;
  while(!await evaluate(`!!document.querySelector('.meridian-home')`)) {if(Date.now()>until)throw Error('Built Web composition did not mount');await sleep(100);}
  assert.equal(await evaluate(`(()=>{const control=Array.from(document.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')==='Abrir Loja'||button.getAttribute('aria-label')==='Loja'||button.textContent.trim()==='Loja');control?.click();return !!control;})()`),true);
  until=Date.now()+30000;
  while(!await evaluate(`!!document.querySelector('[data-store-preview-host]')?.shadowRoot?.querySelector('.feature')`)) {if(Date.now()>until)throw Error('Built Web Store preview did not mount');await sleep(100);}
  assert.equal(await evaluate(`document.querySelector('[data-store-shared]').dataset.storeMode`),'planned');
  const webShot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(new URL('web-planned.png',evidence),Buffer.from(webShot.data,'base64'));
  await evaluate(`document.querySelector('[data-store-switch]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-store-official] [data-app-extension]').dataset.storeState`),'unavailable');
  assert.equal(await evaluate(`document.querySelectorAll('[data-store-official] [data-store-app-card]').length`),0);
  assert.equal(client.events.filter(event=>event.method==='Runtime.exceptionThrown').length,0);
  console.log('SHARED_STORE_BROWSER=PASS');
});
