'use strict';
// Canonical Native runtime checkout; the bundled snapshot is a safe offline fallback.
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { existsSync, readFileSync, symlinkSync } = require('node:fs');
const { OFFICIAL_REMOTE } = require('./runtime.cjs');

function git(argv, cwd, timeoutMs = 90000) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', finished = false;
    // This updater accesses the public, immutable OrdaX OS source only.
// Global Git Credential Manager / gh auth helpers can block for minutes
// even on anonymous reads, exceeding the 25s discovery deadline. Empty
// credential.helper overrides all inherited helpers for this invocation;
// never prompt or forward an account credential to a public checkout.
const child = spawn('git', ['-c','credential.helper=',...argv], {
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

// Only the immutable Desktop Dev transaction manager may materialize source
// updates. This helper never merges a Git checkout in place.
module.exports = {git, isTrusted, hasDesktopHostContract, dependencies};
