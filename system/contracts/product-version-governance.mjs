import { compareComponentVersions, validateComponentVersion } from './component-manifest.mjs';

// SemVer belongs to an explicitly versioned product composition/candidate.
// Source revisions between version changes remain uniquely identified by Git SHA
// and provenance; parallel source PRs never compete for the same global version.
export const PRODUCT_VERSION_GOVERNANCE_SCHEMA = 'ordax.product-version-governance/2';
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
  if (typeof record.displayName !== 'string' || !record.displayName.endsWith(displayVersion)) {
    throw new TypeError('Product displayName must include the current version label');
  }
  if (typeof stableRelease !== 'boolean') {
    throw new TypeError('A product must explicitly declare stableRelease');
  }
  if (channel !== 'unqualified' && stableRelease) {
    throw new TypeError('An alpha/beta/rc product cannot claim stable release');
  }
  return Object.freeze({ version: semanticVersion, channel, stableRelease });
}

export function assertVersionAdvance(previous, next, { required = false } = {}) {
  productVersionChannel(previous);
  productVersionChannel(next);
  const comparison = compareComponentVersions(next, previous);
  if (comparison < 0) throw new RangeError('Version regression is forbidden');
  if (required && comparison === 0) {
    throw new RangeError('An explicit product-version change must advance SemVer');
  }
  return Object.freeze({ previous, next, required });
}

export function versionGovernancePolicy() {
  return Object.freeze({
    schema: PRODUCT_VERSION_GOVERNANCE_SCHEMA,
    prereleaseChannels: RELEASE_CHANNELS,
    unqualifiedMeansPublished: false,
    sourceVersionAuthorizesRelease: false,
    everySourceChangeRequiresVersionAdvance: false,
    explicitCompositionVersionMustAdvance: true,
    sourceRevisionIdentity: 'git-sha-and-provenance',
  });
}
