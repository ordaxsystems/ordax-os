import { compareComponentVersions, validateComponentVersion } from './component-manifest.mjs';

// Version grammar is inherited from the existing canonical component manifest.
// Channels classify source revisions; no channel independently grants publication.
export const PRODUCT_VERSION_GOVERNANCE_SCHEMA = 'ordax.product-version-governance/1';
const RELEASE_CHANNELS = Object.freeze(['alpha', 'beta', 'rc']);
const PRODUCT_PRERELEASE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-(alpha|beta|rc)\.(0|[1-9]\d*)$/;

export function productVersionChannel(version) {
  validateComponentVersion(version);
  if (!version.includes('-')) return 'unqualified';
  const match = PRODUCT_PRERELEASE.exec(version);
  if (!match) throw new TypeError('Unsupported product prerelease. Use alpha.N, beta.N or rc.N.');
  return match[1];
}

export function assertProductVersionIdentity(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('Invalid OrdaX product version identity');
  }
  const { semanticVersion, displayVersion, stableRelease } = record;
  const channel = productVersionChannel(semanticVersion);
  if (displayVersion !== 'v' + semanticVersion) {
    throw new TypeError('Displayed version must be derived from semanticVersion');
  }
  if (typeof stableRelease !== 'boolean') {
    throw new TypeError('A product must explicitly declare stableRelease');
  }
  if (channel !== 'unqualified' && stableRelease) {
    throw new TypeError('An alpha/beta/rc product cannot claim stable release');
  }
  return Object.freeze({ version: semanticVersion, channel, stableRelease });
}

export function assertVersionAdvance(previous, next, { changedRuntime = true } = {}) {
  productVersionChannel(previous);
  productVersionChannel(next);
  if (compareComponentVersions(next, previous) < 0) {
    throw new RangeError('Version regression is forbidden');
  }
  if (changedRuntime && compareComponentVersions(next, previous) === 0) {
    throw new RangeError('Runtime changes require a version advance');
  }
  return Object.freeze({ previous, next, changedRuntime });
}

export function versionGovernancePolicy() {
  return Object.freeze({
    schema: PRODUCT_VERSION_GOVERNANCE_SCHEMA,
    prereleaseChannels: RELEASE_CHANNELS,
    unqualifiedMeansPublished: false,
    sourceVersionAuthorizesRelease: false,
    componentManifestIsVersionOwner: true,
  });
}
