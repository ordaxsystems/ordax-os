'use strict';
const { join, resolve, isAbsolute } = require('node:path');
const { readFileSync, existsSync, lstatSync } = require('node:fs');

// Only un-packaged local development may point the Electron shell to a
// separate OS checkout. The installed product always uses its bundled template.
function developmentOsRoot(appDirectory, env = process.env) {
  const explicit = env.ORDAX_DESKTOP_OS_CHECKOUT;
  if (explicit === undefined || explicit === '') return resolve(appDirectory, '../..');
  if (typeof explicit !== 'string' || !isAbsolute(explicit))
    throw Error('Desktop development OS checkout must be an absolute path');
  const root = resolve(explicit);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error('Desktop development OS checkout must be a real directory');
  return root;
}

// A single OS distribution contract owns both Dev Git origin and public
// signed-release restrictions. The installer embeds the read-only snapshot.
function distributionAuthority() {
  const localDevelopment = process.env.ORDAX_DESKTOP_LOCAL_DEV === '1';
  const source = join(localDevelopment ? developmentOsRoot(__dirname)
    : resolve(__dirname, '../..'), 'docs', 'contracts', 'distribution-profiles.json');
  const packaged = join(process.resourcesPath || '', 'runtime-template', 'docs',
    'contracts', 'distribution-profiles.json');
  const path = localDevelopment ? source : existsSync(source) ? source : packaged;
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
  if (isPackaged) return join(resourcesPath, 'runtime-template');
  return process.env.ORDAX_DESKTOP_LOCAL_DEV === '1'
    ? developmentOsRoot(appDirectory) : resolve(appDirectory, '../..');
}
function runtimeStateDirectory(userData) { return join(userData, 'native-state'); }
module.exports = { OFFICIAL_REMOTE, resolveTemplate, developmentOsRoot, runtimeStateDirectory };
