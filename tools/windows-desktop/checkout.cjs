'use strict';
// Writable Git checkout for the canonical Native runtime; offline snapshot is fallback.
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { existsSync, symlinkSync } = require('node:fs');
const { OFFICIAL_REMOTE, existingCheckout, gitArgs } = require('./runtime.cjs');
function git(argv, cwd, timeoutMs = 90000) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', finished = false;
    const child = spawn('git', argv, { cwd, windowsHide:true,
      env: { ...process.env, GIT_TERMINAL_PROMPT:'0' },
      stdio:['ignore','pipe','pipe'] });
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
function dependencies(checkout,template) {
  const dir=join(checkout,'node_modules');
  if (existsSync(dir)) return;
  const source=join(template,'node_modules');
  if (!existsSync(source)) throw Error('Packaged runtime dependencies missing');
  symlinkSync(source,dir,process.platform==='win32'?'junction':'dir');
}
async function selectRuntime({isPackaged,userData,template,log}) {
  if (!isPackaged) return template;
  const cached=existingCheckout(userData);
  if (cached) {
    if (!await isTrusted(cached)) {
      log('Unexpected origin in cached checkout; using bundled snapshot');
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
  dependencies(target,template);
  return target;
}
module.exports={git,isTrusted,selectRuntime};
