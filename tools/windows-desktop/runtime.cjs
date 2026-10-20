'use strict';
const { join, resolve } = require('node:path');
const { existsSync } = require('node:fs');

const OFFICIAL_REMOTE = 'https://github.com/ordaxsystems/ordax-os.git';
function resolveTemplate(appDirectory, resourcesPath, isPackaged) {
  return isPackaged ? join(resourcesPath, 'runtime-template') : resolve(appDirectory, '../..');
}
function existingCheckout(userData) {
  const root = join(userData, 'runtime-checkout');
  return existsSync(join(root, '.git')) ? root : null;
}
function runtimeStateDirectory(userData) {
  return join(userData, 'native-state');
}
function gitArgs(target) {
  return ['clone', '--filter=blob:none', '--depth', '1', '--branch', 'main', OFFICIAL_REMOTE, target];
}
module.exports = { OFFICIAL_REMOTE, resolveTemplate, existingCheckout, runtimeStateDirectory, gitArgs };
