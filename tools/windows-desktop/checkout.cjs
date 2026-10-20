'use strict';
// Canonical Native runtime checkout; the bundled snapshot is a safe offline fallback.
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { existsSync, readFileSync, symlinkSync } = require('node:fs');
const { OFFICIAL_REMOTE, existingCheckout, gitArgs } = require('./runtime.cjs');

function git(argv, cwd, timeoutMs = 90000) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', finished = false;
    const child = spawn('git', argv, {
      cwd, windowsHide:true, env: { ...process.env, GIT_TERMINAL_PROMPT:'0' },
      stdio:['ignore','pipe','pipe']
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', b => { stdout = (stdout + b.toString()).slice(-1024); });
    child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-1024); });
    const finish = ok => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      resolve({ ok, stdout:stdout.trim(), stderr:stderr.trim() });
    };
    child.on('error', () => finish(false));
    child.on('close', code => finish(code === 0));
  });
}

async function isTrusted(checkout) {
  const origin = await git(['-C',checkout,'config','--get','remote.origin.url'],checkout,10000);
  return origin.ok && origin.stdout === OFFICIAL_REMOTE;
}

function hasDesktopHostContract(root) {
  try {
    const path = join(root,'tools','windows-emulator','desktop-host-contract.json');
    const manifest = JSON.parse(readFileSync(path,'utf8'));
    const capabilities = manifest?.desktopHost?.capabilities;
    return manifest.schema === 1
      && manifest.desktopHost.contractVersion === 1
      && manifest.desktopHost.nativeSource === 'system/composition/native/index.html'
      && Array.isArray(capabilities)
      && ['no-external-browser','dynamic-loopback-port','external-state-directory']
        .every(feature => capabilities.includes(feature))
      && existsSync(join(root,'tools','windows-emulator','dev-supervisor.mjs'))
      && existsSync(join(root,'system','composition','native','index.html'));
  } catch { return false; }
}

function dependencies(checkout,template) {
  const dir=join(checkout,'node_modules');
  if (existsSync(dir)) return;
  const source=join(template,'node_modules');
  if (!existsSync(source)) throw Error('Packaged runtime dependencies missing');
  symlinkSync(source,dir,process.platform==='win32'?'junction':'dir');
}

// One-time bootstrap recovery for a checkout predating the versioned host contract.
// Once compatible, all ongoing Pull remains exclusively with dev-supervisor.mjs.
async function refreshIncompatibleCheckout(checkout,log) {
  const status = await git(['-C',checkout,'status','--porcelain=v1'],checkout,10000);
  if (!status.ok || status.stdout) {
    log('Incompatible Git checkout has local edits or unreadable status; preserving it');
    return false;
  }
  const fetched = await git(['-C',checkout,'fetch','--no-tags','origin','main'],checkout,60000);
  if (!fetched.ok) {
    log('Cannot refresh incompatible Git checkout; bundled snapshot remains active');
    return false;
  }
  const advanced = await git(['-C',checkout,'merge','--ff-only','FETCH_HEAD'],checkout,30000);
  if (!advanced.ok) {
    log('Git checkout is not fast-forward; preserving checkout and using bundled snapshot');
    return false;
  }
  return hasDesktopHostContract(checkout);
}

async function selectRuntime({isPackaged,userData,template,log}) {
  if (!isPackaged) return template;
  const cached=existingCheckout(userData);
  if (cached) {
    if (!await isTrusted(cached)) {
      log('Unexpected origin in cached checkout; using bundled snapshot');
      return template;
    }
    if (!hasDesktopHostContract(cached)
        && !await refreshIncompatibleCheckout(cached,log)) {
      log('Installed canonical main lacks Desktop Host contract v1; using bundled snapshot (Pull inactive)');
      return template;
    }
    dependencies(cached,template);
    return cached;
  }
  const target=join(userData,'runtime-checkout');
  if (existsSync(target)) {
    log('Incomplete checkout preserved; using bundled snapshot');
    return template;
  }
  const result=await git(gitArgs(target),userData);
  if (!result.ok || !await isTrusted(target)) {
    log('Git acquisition unavailable; using bundled snapshot (Pull inactive)');
    return template;
  }
  if (!hasDesktopHostContract(target)) {
    log('Canonical main does not yet implement Desktop Host contract v1; using bundled snapshot (Pull inactive)');
    return template;
  }
  dependencies(target,template);
  return target;
}
module.exports={git,isTrusted,hasDesktopHostContract,refreshIncompatibleCheckout,selectRuntime};
