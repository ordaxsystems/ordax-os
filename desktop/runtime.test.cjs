'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const canonicalOs=require('./ci/resolve-test-os.cjs');
const {
  resolveTemplate, developmentOsRoot, defaultDevelopmentOsRoot,
  runtimeStateDirectory, OFFICIAL_REMOTE,
} = require('./runtime.cjs');
const { resolveInstalledGit } = require('./checkout.cjs');

test('Dev and MVP share the single authoritative distribution contract', () => {
  const source = JSON.parse(readFileSync(join(
    canonicalOs,'docs/contracts/distribution-profiles.json'
  ),'utf8'));
  assert.equal(OFFICIAL_REMOTE,'https://github.com/'+source.source_authority.repository+'.git');
  assert.equal(source.source_authority.branch,'main');
  assert.equal(source.source_authority.permanent_profile_forks_allowed,false);
  assert.equal(source.profiles['owner-development'].normal_update_transport,'git-main');
  assert.equal(source.profiles['stable-mvp'].normal_update_transport,'official-signed-release-channel');
  assert.equal(source.profiles['stable-mvp'].operational_git_allowed,false);
  assert.ok(require('./package.json').build.extraResources.some(
    source => source.to === 'runtime-template/docs/contracts/distribution-profiles.json'));
});
test('desktop source defaults to the single parent OS checkout', () => {
  const sibling=resolve(__dirname,'..');
  assert.equal(defaultDevelopmentOsRoot(__dirname),sibling);
  assert.equal(resolveTemplate(__dirname, 'ignored', false), canonicalOs);
  assert.equal(developmentOsRoot(__dirname,{}),sibling);
});
test('explicit detached OS checkout must be absolute and must not be a symlink', () => {
  const sibling=resolve(__dirname,'..');
  assert.throws(()=>developmentOsRoot(__dirname,{ORDAX_DESKTOP_OS_CHECKOUT:'../ordax-os'}),/absolute path/);
  assert.equal(developmentOsRoot(__dirname,{ORDAX_DESKTOP_OS_CHECKOUT:canonicalOs}),canonicalOs);
});
test('packaged Windows uses offline verified snapshot with isolated state', () => {
  const template = resolveTemplate('ignored','C:\\OrdaXResources',true);
  assert.equal(template,join('C:\\OrdaXResources','runtime-template'));
  assert.ok(!runtimeStateDirectory('C:\\UserData').includes('runtime-template'));
});
test('Windows Git discovery reuses installed Git without PATH or a second installer',()=>{
  const expected='C:\\Program Files\\Git\\cmd\\git.exe';
  const seen=[];
  const fakeStat=path=>{
    seen.push(path);
    if(path===expected)return {isFile:()=>true,isSymbolicLink:()=>false};
    throw Object.assign(Error('ENOENT'),{code:'ENOENT'});
  };
  assert.equal(resolveInstalledGit({
    platform:'win32',env:{ProgramFiles:'C:\\Program Files',PATH:'C:\\Windows'},
    stat:fakeStat,
  }),expected);
  assert.equal(seen.includes(expected),true);
  assert.equal(resolveInstalledGit({
    platform:'win32',env:{ProgramFiles:'C:\\Untrusted',PATH:''},
    stat:()=>({isFile:()=>true,isSymbolicLink:()=>true}),
  }),'git','never select a symlink as a privileged Git binary');
  assert.equal(resolveInstalledGit({platform:'linux'}),'git');
});

test('Desktop Dev source is the sole canonical remote, with no shallow live merge', () => {
  assert.equal(OFFICIAL_REMOTE, 'https://github.com/ordaxsystems/ordax-os.git');
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  const checkout = readFileSync(join(__dirname,'checkout.cjs'),'utf8');
  const staging = readFileSync(join(__dirname,'dev-update.cjs'),'utf8');
  assert.ok(main.includes('chooseBootVersion'));
  assert.ok(!checkout.includes('refreshIncompatibleCheckout'));
  assert.ok(!checkout.includes('merge\',\'--ff-only'));
  assert.ok(staging.includes("'--sparse'"));
  assert.ok(!staging.includes("'--depth'"));
});
test('installed Electron loads canonical Native composition only after attested listener readiness', () => {
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  const host = readFileSync(join(__dirname,'host.cjs'),'utf8');
  assert.ok(main.includes("const PRODUCT='/system/composition/native/index.html'"));
  assert.ok(host.includes("path:attested?'/__ordax/desktop-host-ready':'/system/composition/native/index.html'"));
  assert.ok(host.includes('if(await isReady(port,staticHost?nativeSessionToken:null,signal))'));
  assert.ok(host.includes("signal?.addEventListener('abort',cancelPending,{once:true})"),
    'shutdown must own the Native child while startup is still awaiting readiness');
  assert.ok(host.includes('if(signal?.aborted)break;'),
    'late HTTP readiness must not revive a Native host after shutdown');
  assert.ok(host.includes('timingSafeEqual(expected,Buffer.from(proof,\'hex\'))'));
});

test('Windows NSIS consumes only the exact OS source SHA and same-commit Desktop',()=>{
 const workflow=readFileSync(join(canonicalOs,'.github/workflows/windows-desktop-dev.yml'),'utf8');
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/workflow_call:/);
 assert.ok(workflow.includes('repository: ordaxsystems/ordax-os'));
 assert.ok(workflow.includes('ref: $'+'{{ inputs.os_sha }}'));
 assert.ok(workflow.includes('node desktop/standalone-stage.cjs'));
 assert.doesNotMatch(workflow,/repository: ordaxsystems\/ordax-desktop/);
 assert.doesNotMatch(workflow,/inputs[.]desktop_sha/);
 assert.ok(workflow.includes('Verify isolated NSIS installation and Native files'));
});

test('Electron locks the canonical user profile before requesting a single instance', () => {
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  const name = main.indexOf("app.setName('OrdaX OS Desktop Dev')");
  const path = main.indexOf("app.setPath('userData',desktopUserData)");
  const lock = main.indexOf('app.requestSingleInstanceLock()');
  assert.ok(name >= 0 && name < path && path < lock);
});

test('direct source Desktop reuses the one verified Surface preparation without changing packaged or HMR profiles', () => {
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  assert.ok(main.includes("if(!app.isPackaged && !devProfile && !localDevelopment)"));
  assert.ok(main.includes("const surfaceRoot=require('./local-dev.cjs').prepare();"));
  assert.ok(main.includes('process.env.ORDAX_DESKTOP_SURFACE_ROOT=surfaceRoot;'));
  assert.equal((main.match(/require\('\.\/local-dev\.cjs'\)\.prepare\(\)/g)||[]).length,1);
});

test('packaged NSIS smoke uses a separate Electron profile and journal', () => {
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  const smoke = readFileSync(join(__dirname,'install-smoke.ps1'),'utf8');
  assert.ok(main.includes("process.env.ORDAX_DESKTOP_TEST_PROFILE === '1'"));
  assert.ok(!main.includes("!app.isPackaged && process.env.ORDAX_DESKTOP_TEST_PROFILE"));
  assert.ok(main.includes("'OrdaX OS Desktop Dev Test'"));
  assert.ok(main.includes('ORDAX_DESKTOP_TEST_PROFILE_DIR'));
  assert.ok(main.includes("basename(resolve(explicitTestDirectory))"));
  assert.ok(main.includes('!isAbsolute(explicitTestDirectory)'));
  assert.ok(smoke.includes('ORDAX_DESKTOP_TEST_PROFILE = "1"'));
  assert.ok(smoke.includes('ORDAX_DESKTOP_TEST_PROFILE_DIR = $testProfile'));
  assert.ok(smoke.includes('$testProfile = Join-Path $dest "OrdaX OS Desktop Dev Test"'));
  assert.ok(smoke.includes('"OrdaX OS Desktop Dev Test"'));
  assert.ok(smoke.includes('$env:ORDAX_DESKTOP_TEST_PROFILE = $previousTestProfile'));
  assert.ok(smoke.includes('$env:ORDAX_DESKTOP_TEST_PROFILE_DIR = $previousTestDirectory'));
});

test('Development installer defaults to the user profile and preserves application data', () => {
  const nsis = require('./package.json').build.nsis;
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.selectPerMachineByDefault, false);
  assert.equal(nsis.allowToChangeInstallationDirectory, false);
  assert.equal(nsis.deleteAppDataOnUninstall, false);
  assert.equal(nsis.include, 'installer.nsh');
});

test('NSIS Owner Dev mode is forced to the current Windows user without a selection page', () => {
  const nsisScript = readFileSync(join(__dirname,'installer.nsh'),'utf8');
  assert.match(nsisScript, /!macro customInstallMode/);
  assert.ok(nsisScript.includes('StrCpy $isForceCurrentInstall "1"'));
  assert.ok(!nsisScript.includes('StrCpy $isForceMachineInstall "1"'));
});

test('NSIS app-running detection uses the bounded tasklist fallback instead of slow 32-bit CIM', () => {
  const nsisScript = readFileSync(join(__dirname,'installer.nsh'),'utf8');
  assert.match(nsisScript, /!macro customCheckAppRunning/);
  assert.ok(nsisScript.includes('!include "getProcessInfo.nsh"'));
  assert.ok(nsisScript.includes('Var /GLOBAL pid'));
  assert.ok(nsisScript.includes('Var /GLOBAL IsPowerShellAvailable'));
  assert.ok(nsisScript.includes('StrCpy $IsPowerShellAvailable "1"'));
  assert.ok(nsisScript.includes('!insertmacro _CHECK_APP_RUNNING'));
  assert.ok(!/customCheckAppRunning[\s\S]*Get-CimInstance/.test(nsisScript));
});

test('Windows package excludes Linux-only Alpine package declaration without dropping the shared Native tree', () => {
  const resources = require('./package.json').build.extraResources;
  const system = resources.filter(item => item.to === 'runtime-template/system');
  assert.equal(system.length, 1);
  assert.equal(system[0].from, '../system');
  assert.deepEqual(system[0].filter, [
    '**/*', '!surface/runtime/packages.txt',
    '!surface/runtime/media_runtime_probe.py', '!surface/runtime/audio-session.sh',
    '!surface/runtime/physical_ata_probe.py', '!surface/runtime/physical_kernel_log_probe.py', '!surface/runtime/physical_performance_probe.py',
  ]);
  const workflow = readFileSync(join(canonicalOs, '.github/workflows/windows-desktop-dev.yml'), 'utf8').replace(/\r\n/g,'\n');
  assert.ok(workflow.includes('node desktop/package-inventory.cjs --compiled'));
  assert.ok(!workflow.includes('node tools/windows-desktop/package-inventory.cjs'));
  assert.ok(workflow.includes('Build unsigned Windows installer'));
  assert.ok(workflow.includes('run: npm run dist:win'));
  assert.ok(workflow.includes('Verify isolated NSIS installation and Native files'));
  assert.match(workflow, /\n  workflow_call:\n/);
  assert.doesNotMatch(workflow, /paths: &desktop_product_sources/);
});

test('Electron host passes the canonical Desktop Dev journal to the OS Native provider', () => {
  const host = readFileSync(join(__dirname,'host.cjs'),'utf8');
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  assert.ok(host.includes('ORDAX_DESKTOP_UPDATE_USER_DATA:userData'));
  assert.ok(main.includes('userData,log'));
});

test('packaged Electron obtains OS observation grants from the verified runtime-template', () => {
  const source = readFileSync(join(__dirname,'main.cjs'),'utf8');
  const pack = require('./package.json');
  assert.ok(pack.build.extraResources.some(item =>
    item.from === '../system' && item.to === 'runtime-template/system'));
  assert.match(source,/resolveTemplate\(__dirname,process\.resourcesPath,app\.isPackaged\)/);
  assert.match(source,/require\(join\(template,'system','adapters'/);
  assert.doesNotMatch(source,/require\(['"]\.\.\/\.\.\/system\/adapters\/desktop\/observation-grant\.cjs/);
});


test('installed NSIS smoke invokes the one Desktop-owned Vite update test', () => {
  const smoke = readFileSync(join(__dirname,'install-smoke.ps1'),'utf8');
  // The installer runs the verified same-commit Desktop test from desktop/.
  assert.match(smoke,/^\s*& node --test "desktop\/dev-update-real-build\.test\.cjs"\s*$/m);
  assert.equal((smoke.match(/& node --test "[^"]*dev-update-real-build\.test\.cjs"/g)||[]).length,1);
  assert.doesNotMatch(smoke,/& node --test "tools\/windows-desktop\/dev-update-real-build\.test\.cjs"/);
  assert.ok(smoke.includes('INSTALLED_READONLY_DEV_UPDATE_SMOKE=PASS'));
  // Historical OS-owned installers remain readable during an upgrade.
  assert.ok(smoke.includes('DESKTOP_INSTALLED_NATIVE_NO_VITE=PASS'));
});

test('Native readiness client validates a fresh HMAC challenge without an OS test fixture', async t => {
  const { createServer } = require('node:http');
  const { createHmac } = require('node:crypto');
  const { isReady } = require('./host.cjs');
  const token = 'c'.repeat(64);
  const server = createServer((req,res) => {
    const challenge=req.headers['x-ordax-desktop-ready-challenge'];
    if(req.url !== '/__ordax/desktop-host-ready' || !/^[0-9a-f]{64}$/.test(challenge || '')) {
      res.writeHead(404); res.end(); return;
    }
    const proof=createHmac('sha256',Buffer.from(token,'hex'))
      .update('ordax.desktop.native-ready/1:'+challenge).digest('hex');
    res.writeHead(200,{'cache-control':'no-store','x-ordax-desktop-ready-proof':proof});
    res.end();
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port=server.address().port;
  assert.equal(await isReady(port,token),true);
  assert.equal(await isReady(port,'9'.repeat(64)),false);
  assert.equal(await isReady(port,'malformed'),false);
});

test('Electron host selects compiled Native only when the verified listener exists', () => {
  const source = readFileSync(join(__dirname,'host.cjs'),'utf8');
  assert.match(source,/const staticHost=Boolean\(builtAssetsRoot && existsSync\(installedNative\)\)/);
  assert.match(source,/const entry=staticHost\?installedNative:/);
  assert.match(source,/http-ready after/);
});
