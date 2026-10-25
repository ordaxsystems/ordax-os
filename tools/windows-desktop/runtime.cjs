'use strict';
const { join, resolve } = require('node:path');
const { readFileSync, existsSync } = require('node:fs');

// A single OS distribution contract owns both Dev Git origin and public
// signed-release restrictions. The installer embeds the read-only snapshot.
function distributionAuthority() {
  const source = resolve(__dirname, '../../docs/contracts/distribution-profiles.json');
  const packaged = join(process.resourcesPath || '', 'runtime-template', 'docs',
    'contracts', 'distribution-profiles.json');
  const path = existsSync(source) ? source : packaged;
  const contract = JSON.parse(readFileSync(path, 'utf8'));
  const authority = contract.source_authority;
  const development = contract.profiles?.['owner-development'];
  const publicProfile = contract.profiles?.['stable-mvp'];
  if (contract.$schema !== 'prototype-ordax.distribution-profiles/1' ||
      authority?.repository !== 'ordaxsystems/ordax-os' ||
      authority.branch !== 'main' ||
      authority.single_product_codebase !== true ||
      authority.permanent_profile_forks_allowed !== false ||
      development?.normal_update_transport !== 'git-main' ||
      development.operational_git_allowed !== true ||
      publicProfile?.normal_update_transport !== 'official-signed-release-channel' ||
      publicProfile.operational_git_allowed !== false) {
    throw Error('Canonical OrdaX Dev/MVP distribution authority unavailable or unsafe');
  }
  return authority;
}
const sourceAuthority = distributionAuthority();
const OFFICIAL_REMOTE = 'https://github.com/' + sourceAuthority.repository + '.git';
function resolveTemplate(appDirectory, resourcesPath, isPackaged) {
  return isPackaged ? join(resourcesPath, 'runtime-template') : resolve(appDirectory, '../..');
}
function runtimeStateDirectory(userData) { return join(userData, 'native-state'); }
module.exports = { OFFICIAL_REMOTE, resolveTemplate, runtimeStateDirectory };
