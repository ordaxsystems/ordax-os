#!/usr/bin/env node
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve, relative, isAbsolute, sep} from 'node:path';
import {runBrowser, sleep} from '../browser-proof/chromium.mjs';
function parseArgs(argv) {
  let bundleDir = 'out/web-client';
  let publicAccountUrl = null;
  let evidenceDir = 'out/account-viewport-proof';
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--public-account-url') { publicAccountUrl = argv[++index]; continue; }
    if (value === '--evidence-dir') { evidenceDir = argv[++index]; continue; }
    if (value === '--bundle-dir') {
      bundleDir = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${value}`);
  }
  if (publicAccountUrl) {
    const url = new URL(publicAccountUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/conta/' || url.search || url.hash || url.username || url.password) {
      throw new Error('public account proof requires the local canonical /conta/ preview');
    }
    assertInside(resolve('out'), resolve(evidenceDir));
  }
  return { bundleDir: resolve(bundleDir), publicAccountUrl, evidenceDir: resolve(evidenceDir) };
}

function assertInside(root, candidate) {
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`bundle dependency escapes bundle root: ${candidate}`);
  }
}

async function provePublicAccount(client, url, evidenceDir) {
  await mkdir(evidenceDir, { recursive: true });
  async function evaluate(expression) {
    const reply = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? 'account proof evaluation failed');
    return reply.result?.value;
  }
  async function escapeDialog() {
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  async function click(selector) {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit !== element && !element.contains(hit)) throw new Error('account control is obstructed: ' + ${JSON.stringify(selector)});
      return point;
    })()`);
    if (!point) throw new Error(`account control is not visible: ${selector}`);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  const reports = [];
  for (const [name, width, height] of [['desktop',1440,900],['tablet',1024,768],['mobile',390,844],['narrow',320,740],['short',320,568],['wide-phone',430,932],['landscape',844,390]]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await client.send('Page.navigate', { url: new URL('#visao-geral', url).href });
    const deadline = Date.now() + 30_000;
    while (!await evaluate('document.readyState === "complete" && document.querySelector("#account-content h1") && document.querySelector("#account-session")?.dataset.status !== "checking"')) {
      if (Date.now() > deadline) throw new Error(`${name} account preview readiness timed out`);
      await sleep(50);
    }
    await evaluate('window.OrdaXPublicI18n.setLocale("pt-BR"); document.fonts.ready.then(() => true)');
    const report = await evaluate(`(() => {
      const box = element => element.getBoundingClientRect();
      const phone = innerWidth <= 760;
      const cards = [...document.querySelectorAll('.account-overview-grid .account-card')];
      const columns = [...document.querySelectorAll('.account-overview-grid > *')];
      const overviewTargets = new Set([...document.querySelectorAll('#account-content a[href^="#"]')].map(link => link.hash));
      const sidebar = [...document.querySelectorAll('#sidebar-navigation a, .sidebar-bottom a[data-section]')];
      const nav = [...document.querySelectorAll('#mobile-navigation > *')];
      return {
        width: innerWidth, height: innerHeight,
        noOverflow: document.documentElement.scrollWidth <= innerWidth,
        canonicalPage: document.body.dataset.page === 'conta' && location.pathname === '/conta/',
        onePresentation: document.querySelectorAll('#account-content').length === 1,
        allSections: sidebar.length === 12 && new Set(sidebar.map(link => link.hash)).size === 12,
        overview: !!document.querySelector('.account-intro h1') && !!document.querySelector('.identity-card [id=overview-profile-title]'),
        summaryCards: cards.length === 4,
        primaryTilesAligned: innerWidth < 1200 || columns.length === 2 && Math.abs(box(columns[0]).top - box(columns[1]).top) < 2,
        singleUsageChart: document.querySelectorAll('.usage-chart').length === 1,
        emptyChart: !!document.querySelector('.chart-empty') && !document.querySelector('.usage-chart polyline'),
        decorativeProfileArt: !!document.querySelector('.identity-card .identity-art[aria-hidden="true"] img[src="/assets/account-landscape.jpg"][alt=""]'),
        managementSections: ['dados-pessoais','assinatura','faturamento','consumo','seguranca','dispositivos','preferencias','privacidade','integracoes','atividade','suporte'].every(id => overviewTargets.has('#' + id)),
        mobileWebReachable: !!document.querySelector('#more-dialog a[href="https://web.ordax.com.br/"]'),
        noInventedIdentity: !document.querySelector('.verified-email').textContent.includes('@'),
        accountNavigation: nav.length === 5 && nav.slice(0,4).map(item => item.hash).join(',') === '#visao-geral,#assinatura,#consumo,#seguranca' && nav[4].id === 'more-toggle',
        touchTargets: !phone || nav.every(element => box(element).height >= 44),
        headerHeight: box(document.querySelector('.topbar')).height,
        unavailableSession: ['anonymous','unavailable'].includes(document.querySelector('#account-session').dataset.status)
      };
    })()`);
    if (Object.entries(report).some(([key,value]) => !['width','height','headerHeight'].includes(key) && value !== true) || report.headerHeight > 80) {
      throw new Error(`${name} account layout failed: ${JSON.stringify(report)}`);
    }
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(evidenceDir, `account-${name}.png`), Buffer.from(screenshot.data, 'base64'));
    if (width <= 760) {
      await click('#more-toggle');
      if (!await evaluate('document.querySelector("#more-dialog").open && document.querySelector("#more-dialog").contains(document.activeElement)')) throw new Error('More focus failed');
      const moreShot = await client.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
      await writeFile(join(evidenceDir, `account-${name}-more.png`), Buffer.from(moreShot.data, 'base64'));
      await escapeDialog();
      if (!await evaluate('!document.querySelector("#more-dialog").open && document.activeElement.id === "more-toggle"')) throw new Error('More Escape failed');
      await click('#more-toggle');
      await click('#more-navigation a[href="#integracoes"]');
      await sleep(50);
      if (!await evaluate('location.hash === "#integracoes" && document.activeElement.matches("#account-content h1") && !document.querySelector("#more-dialog").open')) throw new Error('More section routing/focus failed');
    }
    await click('[data-open-dialog=notifications]');
    if (!await evaluate('document.querySelector("#account-dialog").open && document.querySelector(".empty-state.compact")')) throw new Error('notification shortcut failed');
    await escapeDialog();
    if (!await evaluate('document.activeElement.matches("[data-open-dialog=notifications]")')) throw new Error('notification Escape focus failed');
    await click('#profile-menu-trigger');
    if (!await evaluate(`!document.querySelector('#ordax-profile-menu').hidden && !document.querySelector('#ordax-profile-menu .ordax-profile-signout') && !!document.querySelector('#ordax-profile-menu a[href="/login/"]')`)) throw new Error('profile menu invented an authenticated session');
    await escapeDialog();
    if (width <= 760) await click('#more-toggle');
    await click(width <= 760 ? '#more-dialog [data-open-dialog=search]' : '.topbar [data-open-dialog=search]');
    if (!await evaluate('document.activeElement.id === "dialog-search"')) throw new Error('account search focus failed');
    await evaluate('document.querySelector("#dialog-search").value = "dispositivos"; document.querySelector("#dialog-search").dispatchEvent(new Event("input", { bubbles: true }))');
    if (!await evaluate("!!document.querySelector('#search-results a[href=\"#dispositivos\"]')")) throw new Error('account search filtering failed');
    await click('#search-results a[href="#dispositivos"]');
    await sleep(50);
    if (!await evaluate('location.hash === "#dispositivos" && document.activeElement.matches("#account-content h1") && !document.querySelector("#account-dialog").open')) throw new Error('search section routing/focus failed');
    await evaluate('location.hash = "#consumo"');
    await sleep(50);
    await click('#usage-tab-storage');
    if (!await evaluate('document.activeElement.id === "usage-tab-storage" && document.activeElement.getAttribute("aria-selected") === "true"')) throw new Error(`${name} storage selection failed`);
    await client.send('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
    await client.send('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
    if (!await evaluate('document.activeElement.id === "usage-tab-apis" && document.activeElement.getAttribute("aria-selected") === "true"')) throw new Error(`${name} usage keyboard navigation failed`);
    await evaluate('location.hash = "#preferencias"');
    await sleep(50);
    if (!await evaluate('!document.querySelector("[role=switch]") && document.querySelector("#account-locale").options.length === 2')) throw new Error('preferences invented an account service');
    await evaluate('location.hash = "#assinatura"');
    await sleep(100);
    if (!await evaluate(`document.querySelectorAll('#account-content .commercial-plan').length === 4
      && document.querySelectorAll('#account-content .commercial-additions > li').length === 7
      && document.querySelector('#account-content .commercial-catalog').textContent.includes('R$ 49,90')
      && document.documentElement.scrollWidth <= innerWidth
      && !document.querySelector('#account-content .commercial-catalog button, #account-content .commercial-catalog form')`)) throw new Error(`${name} reference subscription catalog failed`);
    await evaluate('window.OrdaXPublicI18n.setLocale("en-US")');
    await sleep(100);
    if (!await evaluate(`document.querySelector('#account-content .commercial-notice').textContent.includes('Plans in preparation')
      && document.querySelector('#account-content .commercial-features').textContent.includes('Active Spaces')
      && document.documentElement.scrollWidth <= innerWidth`)) throw new Error(`${name} English subscription catalog failed`);
    const catalogShot = await client.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
    await writeFile(join(evidenceDir, `account-${name}-plans-en.png`), Buffer.from(catalogShot.data, 'base64'));
    await evaluate('location.hash = "#visao-geral"; window.OrdaXPublicI18n.setLocale("en-US")');
    await sleep(100);
    if (!await evaluate('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".topbar").getBoundingClientRect().height <= 80 && document.documentElement.lang === "en-US"')) throw new Error(`${name} English layout overflowed`);
    const englishShot = await client.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
    await writeFile(join(evidenceDir, `account-${name}-en.png`), Buffer.from(englishShot.data, 'base64'));
    await evaluate('window.OrdaXPublicI18n.setLocale("pt-BR")');
    reports.push({ name, ...report, dialogsAndFocus: true, sectionRouting: true, keyboardTabs: true, englishFits: true, referenceCatalog: true });
  }
  for (const width of [1440, 390, 320]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height:900, deviceScaleFactor:1, mobile:width < 600 });
    await client.send('Page.navigate', { url:new URL('/#planos', url).href });
    const deadline = Date.now() + 30000;
    while (!await evaluate('document.readyState === "complete" && !!document.querySelector("#planos .commercial-catalog")')) {
      if (Date.now() > deadline) throw new Error('landing commercial catalog readiness timed out');
      await sleep(50);
    }
    await evaluate('window.OrdaXPublicI18n.setLocale("en-US")');
    await sleep(100);
    if (!await evaluate(`document.querySelectorAll('#planos .commercial-plan').length === 4
      && document.querySelector('#planos .commercial-notice').textContent.includes('Plans in preparation')
      && !document.querySelector('#planos button, #planos form')
      && document.documentElement.scrollWidth <= innerWidth`)) throw new Error(`${width}px landing reference catalog failed`);
  }
  if (client.events.some(event => event.method === 'Runtime.exceptionThrown')) throw new Error('public account emitted a JavaScript exception');
  await writeFile(join(evidenceDir, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(`PUBLIC_ACCOUNT_VIEWPORT_PROOF=PASS ${JSON.stringify(reports)}`);
}


const {publicAccountUrl, evidenceDir} = parseArgs(process.argv.slice(2));
if (!publicAccountUrl) throw new Error('Use --public-account-url');
runBrowser(client => provePublicAccount(client, publicAccountUrl, evidenceDir)).catch(error => { console.error(error); process.exitCode = 1; });
