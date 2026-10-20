'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { resolveTemplate, runtimeStateDirectory, OFFICIAL_REMOTE } = require('./runtime.cjs');

test('desktop dev uses canonical source in un-packaged mode', () => {
  assert.equal(resolveTemplate(__dirname, 'ignored', false), resolve(__dirname,'../..'));
});
test('packaged Windows uses offline verified snapshot with isolated state', () => {
  const template = resolveTemplate('ignored','C:\\OrdaXResources',true);
  assert.equal(template,join('C:\\OrdaXResources','runtime-template'));
  assert.ok(!runtimeStateDirectory('C:\\UserData').includes('runtime-template'));
});
test('Desktop Dev source is the sole canonical remote, with no shallow live merge', () => {
  assert.equal(OFFICIAL_REMOTE, 'https://github.com/ordaxsystems/ordax-os.git');
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  const checkout = readFileSync(join(__dirname,'checkout.cjs'),'utf8');
  const staging = readFileSync(join(__dirname,'dev-update.cjs'),'utf8');
  assert.ok(main.includes('chooseBootVersion'));
  assert.ok(!checkout.includes('refreshIncompatibleCheckout'));
  assert.ok(!checkout.includes('merge\',\'--ff-only'));
  assert.ok(staging.includes("'--sparse'"));
  assert.ok(!staging.includes("'--depth'"));
});
test('installed Electron opens canonical Native composition without iframe', () => {
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  const host = readFileSync(join(__dirname,'host.cjs'),'utf8');
  assert.ok(main.includes("const PRODUCT='/system/composition/native/index.html'"));
  assert.ok(host.includes("path:'/system/composition/native/index.html'"));
});

test('Electron locks the canonical user profile before requesting a single instance', () => {
  const main = readFileSync(join(__dirname,'main.cjs'),'utf8');
  const name = main.indexOf("app.setName('OrdaX OS Desktop Dev')");
  const path = main.indexOf("app.setPath('userData',desktopUserData)");
  const lock = main.indexOf('app.requestSingleInstanceLock()');
  assert.ok(name >= 0 && name < path && path < lock);
});
