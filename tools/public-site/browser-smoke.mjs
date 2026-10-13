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

async function proveReactPublicAccount(client, url, evidenceDir) {
  // Same CDP/browser runner as the canonical public account proof, but with
  // assertions for the literal Lovable React tree rather than the old HTML UI.
  await mkdir(evidenceDir, { recursive: true });
  const evaluate = async (expression) => {
    const response = await client.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? 'React account evaluation failed');
    }
    return response.result?.value;
  };
  const reports = [];
  const viewports = [
    ['desktop', 1440, 900], ['tablet', 1024, 768],
    ['mobile', 390, 844], ['narrow', 320, 740],
    ['short', 320, 568], ['wide-phone', 430, 932], ['landscape', 844, 390],
  ];
  for (const [name, width, height] of viewports) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 600,
    });
    await client.send('Page.navigate', { url });
    const deadline = Date.now() + 30_000;
    while (!await evaluate('document.readyState === "complete" && !!document.querySelector(".account-app .overview-hero")')) {
      if (Date.now() > deadline) {
        throw new Error(`${name} React account boot timed out: ${JSON.stringify(await evaluate('({path:location.pathname, html:document.body.innerText.slice(0,300)})'))}`);
      }
      await sleep(50);
    }
    await evaluate('window.OrdaXPublicI18n.setLocale("pt-BR"); document.fonts.ready.then(() => true)');
    await sleep(50);
    const report = await evaluate(`(() => {
      const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const hero = document.querySelector('.overview-hero');
      const main = document.querySelector('.account-main');
      const nav = document.querySelector('.mobile-nav');
      const sidebar = document.querySelector('.desktop-sidebar');
      const logo = document.querySelector('.topbar .brand img');
      const summary = [...document.querySelectorAll('.summary-grid > .account-card')];
      const secondary = [...document.querySelectorAll('.dashboard-grid > .account-card')];
      return {
        path: location.pathname,
        width: innerWidth,
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        mainVisible: visible(main),
        heroVisible: visible(hero) && hero.getBoundingClientRect().height >= 130,
        profileVisible: visible(document.querySelector('.profile-banner')),
        noInventedPersonalPlan: document.querySelector('.profile-label')?.textContent !== 'Pessoal',
        originalLogoLoaded: logo?.complete && logo?.naturalWidth > 0,
        originalLandscapeLoaded: !!hero?.querySelector('img')?.naturalWidth,
        threeSummaryCards: summary.length === 3 && summary.every(visible),
        twoDashboardCards: secondary.length === 2 && secondary.every(visible),
        localePtBr: document.documentElement.lang === 'pt-BR',
        noInventedConsumption: (() => {
          const chart = document.querySelector('.usage-chart');
          const empty = chart?.querySelector('.chart-empty');
          const svgs = chart ? [...chart.querySelectorAll('svg')] : [];
          return visible(empty) && svgs.length === 1 && empty.contains(svgs[0]);
        })(),
        noExposedUnverifiedIdentity: !document.querySelector('.account-session-email'),
        mobileNavigation: innerWidth >= 600 || visible(nav),
        sidebarDesktop: innerWidth < 1100 || visible(sidebar),
        accountButton: visible(document.querySelector('button.account-menu')),
        publicPrivacyLink: !!document.querySelector('.page-footer a[href="/privacidade/"]'),
        summaryActive: !!document.querySelector('.desktop-sidebar a.sidebar-link.active[href="/conta/"]'),
        contentWidth: main?.getBoundingClientRect().width || 0
      };
    })()`);
    const required = [
      'noHorizontalOverflow', 'mainVisible', 'heroVisible', 'profileVisible', 'noInventedPersonalPlan',
      'originalLogoLoaded', 'originalLandscapeLoaded', 'threeSummaryCards',
      'twoDashboardCards', 'localePtBr', 'noInventedConsumption',
      'noExposedUnverifiedIdentity', 'mobileNavigation', 'sidebarDesktop',
      'accountButton', 'publicPrivacyLink', 'summaryActive',
    ];
    if (report.path !== '/conta/' || required.some(key => !report[key])) {
      throw new Error(`${name} React account visual contract failed: ${JSON.stringify(report)}`);
    }
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(evidenceDir, `react-account-${name}.png`), Buffer.from(screenshot.data, 'base64'));
    await evaluate('window.OrdaXPublicI18n.setLocale("en-US")');
    await sleep(100);
    const englishFits = await evaluate('document.documentElement.lang === "en-US" && document.documentElement.scrollWidth <= innerWidth + 1');
    if (!englishFits) throw new Error(`${name} React account English layout overflowed`);
    const englishScreenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(evidenceDir, `react-account-${name}-en.png`), Buffer.from(englishScreenshot.data, 'base64'));
    report.englishFits = englishFits;
    await evaluate('window.OrdaXPublicI18n.setLocale("pt-BR")');
    await sleep(50);
    // Radix DropdownMenu listens to genuine pointer/keyboard events, not
    // HTMLElement.click(), which skips pointerdown and can hide regressions.
    await evaluate('document.querySelector("button.account-menu").focus()');
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    });
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    });
    await sleep(90);
    if (!await evaluate("!!document.querySelector('[role=menu].ordax-account-dropdown')")) {
      throw new Error(`${name} account menu did not open`);
    }
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
    });
    await sleep(70);
    if (await evaluate("!!document.querySelector('[role=menu].ordax-account-dropdown')")) {
      throw new Error(`${name} account menu Escape did not close`);
    }
    if (name === 'desktop') {
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2,
      });
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2,
      });
      await sleep(90);
      if (!await evaluate('!!document.querySelector("[role=dialog] .search-field input")')) {
        throw new Error('Ctrl+K did not open canonical account search dialog');
      }
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      });
      await sleep(90);
      if (await evaluate('!!document.querySelector("[role=dialog] .search-field input")')) {
        throw new Error('Escape did not close account search dialog');
      }
    }
    if (name === 'mobile') {
      // React's controlled native button uses click, unlike the Radix
      // dropdown trigger which listens directly for keydown/pointerdown.
      // Verify that it is a real button before activating its native handler.
      if (!await evaluate('document.querySelector(".mobile-nav button")?.tagName === "BUTTON"')) {
        throw new Error('Mobile More is not a native keyboard-accessible button');
      }
      await evaluate('document.querySelector(".mobile-nav button").focus(); document.querySelector(".mobile-nav button").click()');
      const moreDeadline = Date.now() + 5000;
      while (!await evaluate('!!document.querySelector("#account-mobile-more[role=dialog]")')) {
        if (Date.now() > moreDeadline) {
          const details = await evaluate(`({
            mobileNavigation: !!document.querySelector('.mobile-nav'),
            mobileButton: document.querySelector('.mobile-nav button')?.outerHTML,
            dialogs: [...document.querySelectorAll('[role=dialog]')].map(node => ({ id: node.id, html: node.outerHTML.slice(0, 600) })),
            pageError: document.body.innerText.slice(-300)
          })`);
          throw new Error(`Mobile More did not open the Radix accessible dialog: ${JSON.stringify(details)}`);
        }
        await sleep(50);
      }
      if (!await evaluate('document.querySelector(".mobile-nav button")?.getAttribute("aria-expanded") === "true"')) {
        throw new Error('Mobile More trigger did not announce expanded');
      }
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
      });
      await sleep(90);
      if (!await evaluate('!document.querySelector("#account-mobile-more[role=dialog]") && document.activeElement?.getAttribute("aria-label") === "Mais opções"')) {
        throw new Error('Mobile More Escape failed to close and return keyboard focus');
      }
    }
    await evaluate('document.querySelector(".plan-button a, a.plan-button")?.click()');
    const sectionDeadline = Date.now() + 5000;
    while (!await evaluate('location.pathname === "/conta/assinatura" && !!document.querySelector(".detail-page-heading")')) {
      if (Date.now() > sectionDeadline) {
        throw new Error(`${name} React account route /conta/assinatura failed`);
      }
      await sleep(30);
    }
    await client.send('Page.navigate', { url: new URL('/conta/seguranca', url).href });
    const deepDeadline = Date.now() + 5000;
    while (!await evaluate('document.readyState === "complete" && !!document.querySelector(".detail-page-heading")')) {
      if (Date.now() > deepDeadline) {
        throw new Error(`${name} React deep link /conta/seguranca failed`);
      }
      await sleep(50);
    }
    const deep = await evaluate('location.pathname === "/conta/seguranca" && document.querySelector(".detail-page-heading h1")?.textContent === "Segurança e acesso" && document.querySelector(".desktop-sidebar a.sidebar-link.active")?.getAttribute("href") === "/conta/seguranca" && document.querySelector(".breadcrumb")?.textContent?.includes("Segurança e acesso")');
    if (!deep) throw new Error(`${name} React deep link did not resolve security section`);
    reports.push({ name, ...report, menuAndEscape: true, clientRoute: true, deepLink: true });
  }
  // Isolated browser-only session fixture. It never enters the bundle,
  // server, artifacts, production auth, or real credential storage. This
  // exercises authenticated presentation without claiming a live E2E login.
  const fixtureEmail = 'proof-account@example.invalid';
  const fixtureSession = {
    $schema: 'prototype-ordax.public-identity-session/1',
    provider: 'supabase', authenticated: true, status: 'authenticated',
    subject: 'browser-proof-subject', email: fixtureEmail,
  };
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__ordaxAccountProofAuthenticated = true;
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const address = typeof input === 'string' ? input : input?.url;
        if (typeof address === 'string' && new URL(address, location.href).pathname === '/auth/session') {
          const authenticated = window.__ordaxAccountProofAuthenticated;
          const session = authenticated ? ${JSON.stringify(fixtureSession)} : { $schema: 'prototype-ordax.public-identity-session/1', provider: 'supabase', authenticated: false, status: 'anonymous' };
          return Promise.resolve(new Response(JSON.stringify(session), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          }));
        }
        return nativeFetch(input, init);
      };
    })();`,
  });
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await client.send('Page.navigate', { url });
  const verifiedDeadline = Date.now() + 10000;
  while (!await evaluate('!!document.querySelector(".account-app .overview-hero")')) {
    if (Date.now() > verifiedDeadline) throw new Error('authenticated fixture page boot timed out');
    await sleep(40);
  }
  await evaluate('document.querySelector("button.account-menu").focus()');
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  const authDeadline = Date.now() + 5000;
  let authenticatedMenu = null;
  while (!(authenticatedMenu = await evaluate(`(() => {
    const menu = document.querySelector('[role=menu].ordax-account-dropdown');
    const email = menu?.querySelector('.ordax-account-dropdown-email')?.textContent;
    const logout = menu?.querySelector('form[action="/auth/logout"]');
    const profile = menu?.querySelector('a[href="/conta/dados-pessoais"]');
    const security = menu?.querySelector('a[href="/conta/seguranca"]');
    return menu && email === ${JSON.stringify(fixtureEmail)} && logout?.method.toLowerCase() === 'post' && !!profile && !!security
      && !!document.querySelector('.profile-banner a[href="/conta/dados-pessoais"]');
  })()`))) {
    if (Date.now() > authDeadline) throw new Error('verified fixture account menu lacks profile/security/logout');
    await sleep(40);
  }
  const verifiedProfile = await evaluate(`document.querySelector(".profile-banner .profile-identity p")?.textContent === ${JSON.stringify(fixtureEmail)}`);
  if (!verifiedProfile) throw new Error('verified session email not reflected in original Lovable profile');
  await evaluate('window.__ordaxAccountProofAuthenticated = false; window.dispatchEvent(new Event("focus"))');
  const expiredDeadline = Date.now() + 5000;
  let expiredState = false;
  while (!(expiredState = await evaluate(`(() => {
    const menu = document.querySelector('[role=menu].ordax-account-dropdown');
    return !!menu?.querySelector('a[href="/login/"]')
      && !menu.querySelector('.ordax-account-dropdown-email')
      && !menu.querySelector('form[action="/auth/logout"]')
      && !document.querySelector('.profile-banner .profile-identity p')?.textContent?.includes(${JSON.stringify(fixtureEmail)})
      && !!document.querySelector('.profile-banner a[href="/login/"]');
  })()`))) {
    if (Date.now() > expiredDeadline) throw new Error('expired session did not erase verified identity');
    await sleep(40);
  }
  reports.push({ name: 'authenticated-fixture', menuAndLogout: authenticatedMenu,
    verifiedProfile, expiryClearsIdentity: expiredState, liveLoginClaimed: false });
  if (client.events.some(event => event.method === 'Runtime.exceptionThrown')) {
    throw new Error('React account emitted a JavaScript exception');
  }
  await writeFile(join(evidenceDir, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(`PUBLIC_REACT_ACCOUNT_VIEWPORT_PROOF=PASS ${JSON.stringify(reports)}`);
}

async function provePublicAccount(client, url, evidenceDir) {
  const markup = await (await fetch(url)).text();
  if (markup.includes('<div id="root"></div>')) {
    return proveReactPublicAccount(client, url, evidenceDir);
  }
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
      const cards = [...document.querySelectorAll('.summary-grid > article')];
      const sidebar = [...document.querySelectorAll('#sidebar-navigation a, .sidebar-bottom a[data-section]')];
      const nav = [...document.querySelectorAll('#mobile-navigation > *')];
      return {
        width: innerWidth, height: innerHeight,
        noOverflow: document.documentElement.scrollWidth <= innerWidth,
        canonicalPage: document.body.dataset.page === 'conta' && location.pathname === '/conta/',
        onePresentation: document.querySelectorAll('#account-content').length === 1,
        allSections: sidebar.length === 12 && new Set(sidebar.map(link => link.hash)).size === 12,
        overview: !!document.querySelector('.overview-hero h1') && !!document.querySelector('.profile-banner'),
        summaryCards: cards.length === 3,
        primaryTilesAligned: innerWidth < 1200 || cards.every(card => Math.abs(box(card).top - box(cards[0]).top) < 2),
        singleUsageChart: document.querySelectorAll('.usage-chart').length === 1,
        emptyChart: !!document.querySelector('.chart-empty') && !document.querySelector('.usage-chart polyline'),
        decorativePlanSymbol: !!document.querySelector('.plan-body img[src="/assets/ordax-symbol.png"]'),
        managementSections: document.querySelectorAll('.management-grid a').length === 9,
        mobileWebReachable: !!document.querySelector('#more-dialog a[href="/web/"]'),
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
    if (!await evaluate('document.querySelectorAll("#search-results a").length === 1')) throw new Error('account search filtering failed');
    await click('#search-results a');
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
    await evaluate('location.hash = "#visao-geral"; window.OrdaXPublicI18n.setLocale("en-US")');
    await sleep(100);
    if (!await evaluate('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".topbar").getBoundingClientRect().height <= 80 && document.documentElement.lang === "en-US"')) throw new Error(`${name} English layout overflowed`);
    const englishShot = await client.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
    await writeFile(join(evidenceDir, `account-${name}-en.png`), Buffer.from(englishShot.data, 'base64'));
    await evaluate('window.OrdaXPublicI18n.setLocale("pt-BR")');
    reports.push({ name, ...report, dialogsAndFocus: true, sectionRouting: true, keyboardTabs: true, englishFits: true });
  }
  if (client.events.some(event => event.method === 'Runtime.exceptionThrown')) throw new Error('public account emitted a JavaScript exception');
  await writeFile(join(evidenceDir, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(`PUBLIC_ACCOUNT_VIEWPORT_PROOF=PASS ${JSON.stringify(reports)}`);
}


const {publicAccountUrl, evidenceDir} = parseArgs(process.argv.slice(2));
if (!publicAccountUrl) throw new Error('Use --public-account-url');
runBrowser(client => provePublicAccount(client, publicAccountUrl, evidenceDir)).catch(error => { console.error(error); process.exitCode = 1; });
