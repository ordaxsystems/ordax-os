'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { resolveTemplate, runtimeStateDirectory, OFFICIAL_REMOTE } = require('./runtime.cjs');
const { resolveInstalledGit } = require('./checkout.cjs');

test('Dev and MVP share the single authoritative distribution contract', () => {
  const source = JSON.parse(readFileSync(join(__dirname,'../../docs/contracts/distribution-profiles.json'),'utf8'));
  assert.equal(OFFICIAL_REMOTE,'https://github.com/'+source.source_authority.repository+'.git');
  assert.equal(source.source_authority.branch,'main');
  assert.equal(source.source_authority.permanent_profile_forks_allowed,false);
  assert.equal(source.profiles['owner-development'].normal_update_transport,'git-main');
  assert.equal(source.profiles['stable-mvp'].normal_update_transport,'official-signed-release-channel');
  assert.equal(source.profiles['stable-mvp'].operational_git_allowed,false);
  assert.ok(require('./package.json').build.extraResources.some(
    source => source.to === 'runtime-template/docs/contracts/distribution-profiles.json'));
});
test('desktop dev uses canonical source in un-packaged mode', () => {
  assert.equal(resolveTemplate(__dirname, 'ignored', false), resolve(__dirname,'../..'));
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
  assert.ok(host.includes('if(await isReady(port,staticHost?nativeSessionToken:null))'));
  assert.ok(host.includes('timingSafeEqual(expected,Buffer.from(proof,\'hex\'))'));
});

test('Windows installer CI uses exact PR head rather than ephemeral test-merge SHA', () => {
  const workflow = readFileSync(join(__dirname,'../../.github/workflows/windows-desktop-dev.yml'),'utf8');
  assert.ok(workflow.includes('ref: ${{ github.event.pull_request.head.sha || github.sha }}'));
  assert.ok(workflow.includes('Assert exact installer OS source identity'));
  assert.ok(workflow.includes('DESKTOP_INSTALLER_SOURCE_SHA=$actual'));
});

test('canonical main automatically builds one SSOT Windows artifact for relevant changes', () => {
  const workflow = readFileSync(join(__dirname,'../../.github/workflows/windows-desktop-dev.yml'),'utf8');
  const events = workflow.replace(/\r\n/g,'\n').split('\npermissions:')[0];
  assert.match(events, /\n  pull_request:\n    paths: &desktop_product_sources\n/);
  assert.match(events, /\n  push:\n    branches:\n      - main\n    paths: \*desktop_product_sources\n/);
  assert.match(events, /\nconcurrency:\n  group: windows-desktop-dev-/);
  assert.match(events, /\n  cancel-in-progress: true\n/);
  const boundary=require('../../docs/contracts/build-autonomy.json').client_build_independence;
  for(const field of ['windows_package_forbidden_linux_boot_paths','windows_package_forbidden_linux_shell_paths']){
    for(const file of boundary[field]){
      assert.ok(events.includes(`- '!system/${file}'`),
        `Linux-only source must not rebuild the Desktop installer: ${file}`);
    }
  }
  assert.ok(workflow.includes('EXPECTED_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}'));
  assert.ok(workflow.includes('Bind installer to exact OS + Surface Native provenance'));
  assert.ok(workflow.includes('Verify isolated NSIS installation and Native files'));
  assert.ok(workflow.includes('if-no-files-found: error'));
});

test('Electron locks the canonical user profile before requesting a single instance', () => {
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  const name = main.indexOf("app.setName('OrdaX OS Desktop Dev')");
  const path = main.indexOf("app.setPath('userData',desktopUserData)");
  const lock = main.indexOf('app.requestSingleInstanceLock()');
  assert.ok(name >= 0 && name < path && path < lock);
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

test('Windows package excludes Linux-only Alpine package declaration without dropping the shared Native tree', () => {
  const resources = require('./package.json').build.extraResources;
  const system = resources.filter(item => item.to === 'runtime-template/system');
  assert.equal(system.length, 1);
  assert.equal(system[0].from, '../../system');
  assert.deepEqual(system[0].filter, [
    '**/*', '!surface/runtime/packages.txt',
    ...require('../../docs/contracts/build-autonomy.json').client_build_independence
      .windows_package_forbidden_linux_boot_paths.map(path=>'!'+path),
    ...require('../../docs/contracts/build-autonomy.json').client_build_independence
      .windows_package_forbidden_linux_shell_paths.map(path=>'!'+path),
    ...require('../../docs/contracts/build-autonomy.json').client_build_independence
      .linux_only_client_probe_paths.map(path=>'!'+path),
    ...require('../../docs/contracts/build-autonomy.json').client_build_independence
      .linux_only_client_host_entrypoints.map(path=>'!'+path),
    ...require('../../docs/contracts/build-autonomy.json').client_build_independence
      .linux_only_client_base_update_diagnostics_paths.map(path=>'!'+path),
    '!composition/web/**',
  ]);
  const workflow = readFileSync(join(__dirname, '../../.github/workflows/windows-desktop-dev.yml'), 'utf8');
  const paths = workflow.split('paths: &desktop_product_sources', 2)[1].split('  # Every integrated main', 1)[0];
  assert.match(paths, /- 'system\/\*\*'/);
  assert.match(paths, /- '!system\/surface\/runtime\/packages\.txt'/);
  assert.match(paths, /- '!system\/surface\/runtime\/media_runtime_probe\.py'/);
  assert.match(paths, /- '!system\/surface\/runtime\/audio-session\.sh'/);
  assert.match(paths, /- '!system\/surface\/runtime\/physical_ata_probe\.py'/);
  assert.match(paths, /- '!system\/surface\/runtime\/physical_kernel_log_probe\.py'/);
  assert.match(paths, /- '!system\/surface\/runtime\/physical_performance_probe\.py'/);
  assert.ok(workflow.includes('paths: *desktop_product_sources'));
});

test('Native Desktop updater never stages the Web-only producer',()=>{
  const source=readFileSync(join(__dirname,'dev-update.cjs'),'utf8');
  assert.match(source, /'sparse-checkout','set',\s*'--no-cone',\.\.\.patterns/);
  assert.match(source, /canonicalWindowsSparsePatterns\(candidatePackage,candidateAuthority\)/);
  assert.ok(!source.includes("'tools/surface-web'"));
  assert.ok(require('./package.json').build.files.includes('package-inventory.cjs'));
  const resources=require('./package.json').build.extraResources;
  assert.ok(!resources.some(x=>x.to==='runtime-template/tools/surface-web'));
  const nativeCompiler=readFileSync(join(__dirname,'vite-native-build.mjs'),'utf8');
  assert.ok(nativeCompiler.includes('system/composition/native/index.html'));
  assert.ok(!nativeCompiler.includes('tools/surface-web/'));
});
