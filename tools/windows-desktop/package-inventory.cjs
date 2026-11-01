'use strict';
const { readdirSync, lstatSync, existsSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');
const { createHash } = require('node:crypto');

function inventory(root, exclusions) {
  // Only the canonical Web-only composition may use a subtree exclusion.
  // Every other omission stays exact and reviewable against the real source tree.
  const WEB_ONLY = '!composition/web/**';
  if (!Array.isArray(exclusions) || exclusions.some(x =>
    typeof x !== 'string' || !x.startsWith('!') ||
    ((x.includes('*') || x.includes('?') || x.includes('[')) && x !== WEB_ONLY))) {
    throw Error('Unexpected non-exact exclusion; inventory requires explicit review');
  }
  const excluded = new Set(exclusions.map(x => x.slice(1)));
  const included = [];
  const skipped = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const key = relative(root, absolute).split(sep).join('/');
      if (entry.isSymbolicLink()) throw Error('Untrusted symlink in packaged system: ' + key);
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!entry.isFile()) throw Error('Unsupported packaged entry: ' + key);
      const size = lstatSync(absolute).size;
      (excluded.has(key) ||
        (excluded.has('composition/web/**') && key.startsWith('composition/web/'))
        ? skipped : included).push({ path: key, bytes: size });
    }
  };
  walk(root);
  included.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  skipped.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  const missing = [...excluded].filter(key => key === 'composition/web/**'
    ? !skipped.some(x => x.path.startsWith('composition/web/'))
    : !skipped.some(x => x.path === key)).sort();
  // Missing exclusion targets are expected during source migrations; never
  // pretend they were removed from an actual installer.
  const groups = {};
  for (const entry of included) {
    const owner = entry.path.split('/').slice(0,2).join('/');
    const item = groups[owner] || (groups[owner] = { files:0, bytes:0 });
    item.files++;
    item.bytes += entry.bytes;
  }
  const totalBytes = included.reduce((sum,x) => sum+x.bytes,0);
  const fingerprint = createHash('sha256').update(JSON.stringify(included)).digest('hex');
  return { schema:'ordax.desktop-system-inventory/1', includedFiles:included.length, includedBytes:totalBytes,
    excludedFiles:skipped.length, excludedBytes:skipped.reduce((s,x)=>s+x.bytes,0),
    missingExclusions:missing, groups, fingerprint };
}

// Enforce the single checked-in contract before shipping an NSIS system tree.
// Neither arbitrary extra omissions nor parallel system copies are allowed.
function canonicalWindowsPackageExclusions(packageJson, autonomy) {
  const resources = packageJson?.build?.extraResources;
  if (!Array.isArray(resources)) throw Error('Windows package resources unavailable');
  const sources = resources.filter(x => x.from === '../../system');
  if (sources.length !== 1 || sources[0].to !== 'runtime-template/system' ||
      !Array.isArray(sources[0].filter) || sources[0].filter[0] !== '**/*') {
    throw Error('Windows system packaging source is not unique');
  }
  const scope = autonomy?.client_build_independence;
  const groups = [
    scope?.windows_package_forbidden_linux_boot_paths,
    scope?.windows_package_forbidden_linux_shell_paths,
    scope?.linux_only_client_probe_paths,
    scope?.linux_only_client_host_entrypoints,
    scope?.linux_only_client_base_update_diagnostics_paths,
  ];
  if (groups.some(group => !Array.isArray(group) || group.length === 0) ||
      typeof scope?.linux_only_client_package_manifest !== 'string' ||
      !scope.linux_only_client_package_manifest) {
    throw Error('Canonical Windows exclusions unavailable');
  }
  const paths = [...groups.flat(), scope.linux_only_client_package_manifest,
    'composition/web/**'];
  if (paths.some(x => typeof x !== 'string' || !x) ||
      new Set(paths).size !== paths.length) {
    throw Error('Duplicate or malformed canonical Windows exclusion');
  }
  const allowed = new Set(paths.map(x => '!' + x));
  const actual = sources[0].filter.slice(1);
  if (actual.length !== allowed.size ||
      new Set(actual).size !== actual.length ||
      actual.some(x => !allowed.has(x))) {
    throw Error('Windows package exclusions diverge from canonical build-autonomy contract');
  }
  return actual;
}

// Inspect the bytes extracted by NSIS using the SAME canonical exclusions
// already validated against electron-builder. Never maintain another path list.
function verifyInstalledWindowsPackage(installedRoot, packageJson, autonomy) {
  const root = lstatSync(installedRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw Error('Installed Windows system root must be a real directory');
  }
  const exclusions = canonicalWindowsPackageExclusions(packageJson, autonomy);
  for (const entry of exclusions) {
    const rel = entry === '!composition/web/**'
      ? 'composition/web' : entry.slice(1);
    // The contract is trusted source, but never let a modified path escape
    // the installed system root, including Windows absolute/path traversal.
    if (!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/.test(rel)) {
      throw Error('Unsafe installed Windows exclusion path: ' + rel);
    }
    const path = join(installedRoot, ...rel.split('/'));
    try { lstatSync(path); }
    catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    throw Error('Forbidden Linux/Web source shipped in Windows installer: ' + rel);
  }
  const nativeEntry = lstatSync(join(installedRoot,'composition','native','index.html'));
  if (!nativeEntry.isFile() || nativeEntry.isSymbolicLink()) {
    throw Error('Installed Windows Native source entry unavailable');
  }
  return { schema:'ordax.desktop-installed-exclusions/1',
    verifiedExclusions:exclusions.length, nativeEntryVerified:true };
}

// The verified Vite output is a separate runtime artifact. Report it alongside
// the source template without treating either as an automatic deletion target.
function nativeBundleComparison(systemReport, compiledRoot) {
  if (!existsSync(join(compiledRoot,'system','composition','native','index.html')) ||
      !existsSync(join(compiledRoot,'assets'))) {
    throw Error('Canonical compiled Native entry or assets missing');
  }
  const compiled = inventory(compiledRoot, []);
  const ui = systemReport.groups['surface/ui'];
  const workspace = systemReport.groups['surface/workspace'];
  if (!ui || !workspace || ui.files < 1 || workspace.files < 1) {
    throw Error('Verified canonical Surface source missing from Windows template');
  }
  return {
    schema: 'ordax.desktop-native-representation-cost/1',
    visualSourceFiles: ui.files + workspace.files,
    visualSourceBytes: ui.bytes + workspace.bytes,
    compiledNativeFiles: compiled.includedFiles,
    compiledNativeBytes: compiled.includedBytes,
    compiledNativeFingerprint: compiled.fingerprint,
    // These are distinct representations, not evidence of removable duplication.
    deletionAuthorized: false
  };
}

function main() {
  const base = resolve(__dirname, '../..');
  const packageJson = require('./package.json');
  const autonomy = require('../../docs/contracts/build-autonomy.json');
  const installedFlag = process.argv.indexOf('--installed-system');
  if (installedFlag !== -1) {
    if (installedFlag !== 2 || process.argv.length !== 4) {
      throw Error('Installed Windows verification requires exactly one system path');
    }
    process.stdout.write(JSON.stringify(
      verifyInstalledWindowsPackage(process.argv[3],packageJson,autonomy)) + '\n');
    return;
  }
  const exclusions = canonicalWindowsPackageExclusions(packageJson, autonomy);
  const report = inventory(join(base,'system'), exclusions);
  if (report.missingExclusions.length) {
    throw Error('Unverified Windows exclusions: ' + report.missingExclusions.join(', '));
  }
  if (process.argv.includes('--compiled')) {
    report.nativeRepresentations = nativeBundleComparison(report, join(base, 'out', 'windows-desktop-native'));
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
if (require.main === module) main();
module.exports = { inventory, nativeBundleComparison, canonicalWindowsPackageExclusions, verifyInstalledWindowsPackage };
