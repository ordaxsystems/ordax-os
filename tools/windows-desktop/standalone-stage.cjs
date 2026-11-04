#!/usr/bin/env node
'use strict';
// Disposable build view for extracting the Windows shell from ordax-os.
// All product sources remain owned by ordax-os/ordax-surface; the view is
// assembled from the exact verified Windows build inputs, never checked in.
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join, resolve, dirname, relative, sep, isAbsolute } = require('node:path');

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SCHEMA = 'ordax.desktop-standalone-stage/1';
const MAX_FILES = 100000;
const MAX_BYTES = 8 * 1024 * 1024 * 1024;

function inside(root, child) {
  const rel = relative(root, child);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw Error('Path is not a child of its authorized root');
  return rel;
}
function hashFile(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function pathExistsIncludingLinks(path) {
  try { fs.lstatSync(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function safeFile(path) {
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error('Untrusted packaging file (link or non-file): ' + path);
  return stat;
}
function assertPlainDirectory(path) {
  const stat = fs.lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error('Untrusted packaging directory: ' + path);
}
function extractFilters(entry) {
  const raw = entry.filter || ['**/*'];
  if (!Array.isArray(raw) || raw[0] !== '**/*')
    throw Error('Unsupported Desktop packaging include filter');
  const excludes = new Set();
  for (const pattern of raw.slice(1)) {
    if (typeof pattern !== 'string' || !pattern.startsWith('!') ||
        pattern.length < 2 || pattern.includes('\\') || pattern.includes('*') ||
        pattern.includes('?') || pattern.includes('..') || pattern.startsWith('!/'))
      throw Error('Unsupported Desktop packaging exclusion');
    excludes.add(pattern.slice(1));
  }
  return excludes;
}

function attestDetachedShell(shell, desktopSha) {
  if (!SHA40.test(desktopSha))
    throw Error('External Desktop shell requires an exact commit SHA');
  assertPlainDirectory(shell);
  const git = (...args) => execFileSync('git',['-C',shell,...args],{
    encoding:'utf8',windowsHide:true,timeout:15000,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
  }).trim();
  try {
    if (!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)ordaxsystems\/ordax-desktop(?:\.git)?$/i
      .test(git('remote','get-url','origin')))
      throw Error('External Desktop source is not the canonical Git repository');
    if (git('rev-parse','--show-prefix') !== '')
      throw Error('External Desktop shell must be the Git repository root');
    if (git('rev-parse','HEAD') !== desktopSha)
      throw Error('External Desktop source does not match pinned commit');
    if (git('status','--porcelain','--untracked-files=all') !== '')
      throw Error('External Desktop shell contains uncommitted or untracked files');
  } catch (error) {
    if (error.message?.startsWith('External Desktop')) throw error;
    throw Error('Could not attest exact external Desktop Git source');
  }
}

function stageStandalonePackage({
  sourceRoot, osSha, verifyNative, outputRoot, desktopRoot, desktopSha
} = {}) {
  if (!SHA40.test(osSha)) throw Error('Expected an exact 40-character OS source SHA');
  const root = resolve(sourceRoot || join(__dirname, '../..'));
  const originalShell = join(root, 'tools', 'windows-desktop');
  const detached = desktopRoot !== undefined || desktopSha !== undefined;
  if (detached && (typeof desktopRoot !== 'string' || !isAbsolute(desktopRoot)))
    throw Error('Detached Desktop shell requires an absolute source directory');
  const shell = detached ? resolve(desktopRoot) : originalShell;
  assertPlainDirectory(root);
  assertPlainDirectory(shell);
  if (detached) attestDetachedShell(shell, desktopSha);
  const out = resolve(outputRoot || join(root, 'out', 'windows-desktop-standalone'));
  const authorized = join(root, 'out');
  if (dirname(out) !== authorized || out === authorized)
    throw Error('Standalone stage may only be written under the OS out directory');
  if (pathExistsIncludingLinks(out)) throw Error('Existing standalone stage cannot be silently overwritten');
  if (typeof verifyNative !== 'function') {
    // Reuse the established OS+Surface source/provenance gate, not a new one.
    verifyNative = (base, emittedRoot = join(base, 'out', 'windows-desktop-native')) =>
      require('./native-build.cjs').verifyBundledNativeReceipt(base, emittedRoot);
  }
  if (!verifyNative(root)) throw Error('Compiled OS+Surface Native bundle failed existing provenance gate');
  const provenancePath = join(root, 'out', 'windows-desktop-native', 'source-provenance.json');
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  if (provenance.schema !== 'ordax.desktop-native-bundle-provenance/1' ||
      provenance.os_sha !== osSha || !SHA40.test(provenance.source_commit))
    throw Error('Desktop OS/Surface provenance is not bound to requested OS SHA');

  const pkg = JSON.parse(fs.readFileSync(join(shell, 'package.json'), 'utf8'));
  if (!pkg.build || !Array.isArray(pkg.build.files) ||
      !Array.isArray(pkg.build.extraResources) || !pkg.build.extraResources.length ||
      pkg.build.nsis?.include !== 'installer.nsh')
    throw Error('Unrecognized Windows package configuration');
  fs.mkdirSync(authorized, { recursive: true });
  assertPlainDirectory(authorized);
  const temporary = fs.mkdtempSync(join(authorized, '.ordax-desktop-standalone-'));
  const sourceRecords = [];
  const seen = new Set();
  let totalBytes = 0;
  function copyVerified(from, to, key, authorizedRoot = root) {
    inside(authorizedRoot, from);
    inside(temporary, to);
    // Even an intermediate path segment must not redirect a trusted mapping.
    let ancestor = dirname(from);
    while (ancestor !== authorizedRoot) {
      inside(authorizedRoot, ancestor);
      const parentStat = fs.lstatSync(ancestor);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
        throw Error('Linked or non-directory packaging source ancestor');
      ancestor = dirname(ancestor);
    }
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw Error('Untrusted linked source: ' + from);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, {recursive:true});
      for (const child of fs.readdirSync(from).sort()) {
        copyVerified(join(from, child), join(to, child), key + '/' + child, authorizedRoot);
      }
      return;
    }
    safeFile(from);
    const normalized = key.replaceAll('\\', '/').toLowerCase();
    if (seen.has(normalized)) throw Error('Duplicate Desktop packaging target: ' + key);
    seen.add(normalized);
    if (seen.size > MAX_FILES || totalBytes + stat.size > MAX_BYTES)
      throw Error('Desktop packaging input exceeds allowed bound');
    totalBytes += stat.size;
    fs.mkdirSync(dirname(to), {recursive:true});
    // Hardlinks can propagate edits from a build stage into canonical OS files.
    // Prefer copy-on-write reflinks where supported; copy independently otherwise.
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
    const digest = hashFile(to);
    if (!SHA256.test(digest)) throw Error('Invalid staged file hash');
    sourceRecords.push({path:key.replaceAll('\\', '/'), sha256:digest, bytes:stat.size});
  }
  try {
    const stageShell = join(temporary, 'shell');
    const stagePayload = join(temporary, 'runtime-template');
    fs.mkdirSync(stageShell);
    fs.mkdirSync(stagePayload);
    for (const file of [...pkg.build.files, 'installer.nsh', 'package-lock.json']) {
      if (typeof file !== 'string' || !/^[a-zA-Z0-9][\w.-]*$/.test(file))
        throw Error('Non-literal or unsafe shell file in Desktop build manifest');
      if (file === 'package.json') continue; // rewritten deterministically below
      copyVerified(join(shell, file), join(stageShell, file), 'shell/' + file,
        detached ? shell : root);
    }
    // Resources are only the existing package.json inputs; no second ownership
    // or independent source lock is introduced by the Desktop export.
    for (const entry of pkg.build.extraResources) {
      if (!entry || typeof entry.from !== 'string' || typeof entry.to !== 'string' ||
          isAbsolute(entry.from) || isAbsolute(entry.to))
        throw Error('Invalid Desktop resource mapping');
      // Resource paths retain the OS virtual shell layout even when the
      // actual Desktop package.json belongs to a separate canonical repo.
      const from = resolve(originalShell, entry.from);
      inside(root, from);
      const to = resolve(stagePayload, entry.to.replace(/^runtime-template\//, ''));
      if (!entry.to.startsWith('runtime-template/') ||
          relative(stagePayload, to).startsWith('..'))
        throw Error('Unexpected Desktop resource destination');
      const exclusions = extractFilters(entry);
      let matchedExclusions = 0;
      function traverse(source, target, resourceRelative) {
        if (resourceRelative && exclusions.has(resourceRelative)) {
          matchedExclusions++;
          return;
        }
        const stat = fs.lstatSync(source);
        if (stat.isSymbolicLink()) throw Error('Untrusted linked Desktop resource');
        if (stat.isDirectory()) {
          fs.mkdirSync(target, {recursive:true});
          for (const leaf of fs.readdirSync(source).sort()) {
            traverse(join(source, leaf), join(target, leaf),
              resourceRelative ? resourceRelative + '/' + leaf : leaf);
          }
        } else {
          copyVerified(source, target, 'runtime-template/' + relative(stagePayload,target).split(sep).join('/'));
        }
      }
      traverse(from, to, '');
      if (matchedExclusions > exclusions.size)
        throw Error('Invalid duplicate resource exclusion');
    }
    const standalone = structuredClone(pkg);
    standalone.build.extraResources = [
      {from:'../runtime-template', to:'runtime-template', filter:['**/*']}
    ];
    standalone.build.directories.output = '../../windows-desktop-installer';
    const packageBytes = JSON.stringify(standalone, null, 2) + '\n';
    fs.writeFileSync(join(stageShell,'package.json'), packageBytes, {flag:'wx'});
    sourceRecords.push({path:'shell/package.json',sha256:hashFile(join(stageShell,'package.json')),
      bytes:Buffer.byteLength(packageBytes)});
    sourceRecords.sort((a,b)=>a.path.localeCompare(b.path,'en'));
    const manifest = {schema:SCHEMA, os_sha:osSha,
      product_owner:'ordaxsystems/ordax-os',
      source_authority:detached
        ? 'ordaxsystems/ordax-desktop/package.json'
        : 'tools/windows-desktop/package.json',
      ...(detached ? {desktop_owner:'ordaxsystems/ordax-desktop',
        desktop_sha:desktopSha} : {}),
      files:sourceRecords,
      total_bytes:totalBytes + Buffer.byteLength(packageBytes)};
    fs.writeFileSync(join(temporary,'stage-manifest.json'),
      JSON.stringify(manifest, null, 2)+'\n', {flag:'wx'});
    verifyStandaloneStage(temporary);
    // Verify the *copied* payload, not merely the source bytes before copy.
    // The existing Native receipt attests to the actual NSIS packaging input.
    const stagedTemplate = join(temporary, 'runtime-template');
    if (!verifyNative(stagedTemplate, join(stagedTemplate, 'desktop-assets')))
      throw Error('Copied Desktop Native bundle fails canonical OS/Surface provenance');
    fs.renameSync(temporary, out);
    return {destination:out, os_sha:osSha, files:manifest.files.length, bytes:manifest.total_bytes};
  } catch (error) {
    fs.rmSync(temporary, {recursive:true, force:true});
    throw error;
  }
}

function verifyStandaloneStage(stageRoot) {
  const root = resolve(stageRoot);
  assertPlainDirectory(root);
  const manifest = JSON.parse(fs.readFileSync(join(root, 'stage-manifest.json'), 'utf8'));
  if (manifest.schema !== SCHEMA || !SHA40.test(manifest.os_sha) ||
      !Array.isArray(manifest.files) || manifest.files.length < 1 ||
      manifest.files.length > MAX_FILES ||
      (manifest.desktop_owner !== undefined &&
        (manifest.desktop_owner !== 'ordaxsystems/ordax-desktop' ||
          !SHA40.test(manifest.desktop_sha) ||
          manifest.source_authority !== 'ordaxsystems/ordax-desktop/package.json')) ||
      (manifest.desktop_owner === undefined && manifest.desktop_sha !== undefined))
    throw Error('Invalid standalone stage manifest');
  const targets = new Set();
  let bytes = 0;
  for (const record of manifest.files) {
    if (typeof record.path !== 'string' || !/^(shell|runtime-template)\//.test(record.path) ||
        typeof record.sha256 !== 'string' || !SHA256.test(record.sha256) ||
        !Number.isSafeInteger(record.bytes) || record.bytes < 0)
      throw Error('Invalid staged source record');
    const file = resolve(root, record.path);
    inside(root, file);
    const normalized = record.path.toLowerCase();
    if (targets.has(normalized)) throw Error('Duplicate stage file');
    targets.add(normalized);
    const stat = safeFile(file);
    if (stat.size !== record.bytes || hashFile(file) !== record.sha256)
      throw Error('Staged Desktop source hash mismatch: ' + record.path);
    bytes += stat.size;
  }
  if (bytes !== manifest.total_bytes) throw Error('Stage byte total mismatch');
  const pkg = JSON.parse(fs.readFileSync(join(root,'shell','package.json'),'utf8'));
  if (pkg.build?.extraResources?.length !== 1 ||
      pkg.build.extraResources[0].from !== '../runtime-template' ||
      pkg.build.extraResources[0].to !== 'runtime-template')
    throw Error('Standalone shell still packages a foreign checkout path');
  // All files must be declared: prevent any unverified insertion after staging.
  function auditTree(dir, prefix) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      const p = join(dir, entry.name), key = prefix + entry.name;
      const stat=fs.lstatSync(p);
      if (stat.isSymbolicLink()) throw Error('Linked staged Desktop file');
      if (stat.isDirectory()) auditTree(p, key+'/');
      else if (!stat.isFile() || !targets.has(key.toLowerCase()))
        throw Error('Unmanifested staged Desktop file: ' + key);
    }
  }
  auditTree(join(root,'shell'), 'shell/');
  auditTree(join(root,'runtime-template'), 'runtime-template/');
  return manifest;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const standalone = args.length === 1;
    const detached = args.length === 7 && args[1] === '--os-root' &&
      args[3] === '--desktop-root' && args[5] === '--desktop-sha';
    if (!standalone && !detached)
      throw Error('Usage: node standalone-stage.cjs <exact-OS-SHA> [--os-root <absolute-OS-path> --desktop-root <absolute-Desktop-path> --desktop-sha <exact-Desktop-SHA>]');
    if (detached && !isAbsolute(args[2]))
      throw Error('Detached staging requires an absolute OS checkout directory');
    const staged = stageStandalonePackage(detached ? {
      osSha:args[0],sourceRoot:args[2],desktopRoot:args[4],desktopSha:args[6]
    } : {osSha:args[0]});
    process.stdout.write('ORDAX_DESKTOP_STANDALONE_STAGE=VERIFIED '+
      staged.os_sha+' files='+staged.files+' bytes='+staged.bytes+'\n');
  } catch (error) {
    process.stderr.write(String(error.message)+'\n');
    process.exitCode = 1;
  }
}
module.exports = {stageStandalonePackage, verifyStandaloneStage};
