'use strict';
const { readdirSync, lstatSync, existsSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');
const { createHash } = require('node:crypto');

function inventory(root, exclusions) {
  if (!Array.isArray(exclusions) || exclusions.some(x => typeof x !== 'string' || !x.startsWith('!') || x.includes('**'))) {
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
      (excluded.has(key) ? skipped : included).push({ path: key, bytes: size });
    }
  };
  walk(root);
  included.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  skipped.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  const missing = [...excluded].filter(key => !skipped.some(x => x.path === key)).sort();
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
  const sources = packageJson.build.extraResources.filter(x => x.from === '../../system' && x.to === 'runtime-template/system');
  if (sources.length !== 1 || sources[0].filter[0] !== '**/*') throw Error('Windows system packaging source is not unique');
  const report = inventory(join(base,'system'), sources[0].filter.slice(1));
  if (process.argv.includes('--compiled')) {
    report.nativeRepresentations = nativeBundleComparison(report, join(base, 'out', 'windows-desktop-native'));
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
if (require.main === module) main();
module.exports = { inventory, nativeBundleComparison };
