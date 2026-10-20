'use strict';
const { join, resolve } = require('node:path');
const OFFICIAL_REMOTE = 'https://github.com/ordaxsystems/ordax-os.git';
function resolveTemplate(appDirectory, resourcesPath, isPackaged) {
  return isPackaged ? join(resourcesPath, 'runtime-template') : resolve(appDirectory, '../..');
}
function runtimeStateDirectory(userData) { return join(userData, 'native-state'); }
module.exports = { OFFICIAL_REMOTE, resolveTemplate, runtimeStateDirectory };
