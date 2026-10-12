import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_SHORTCUTS_PREFERENCE_ID as id, homeShortcutsPreference, readFavoriteShortcutIds, setFavoriteShortcutValue } from '../system/services/preferences/home-shortcuts.mjs';
import { createPreferenceRuntime } from '../system/services/preferences/runtime.mjs';
import { createWebPreferenceStore } from '../system/adapters/web/preferences.mjs';
import { recoverPreferenceSnapshot } from '../system/services/preferences/catalog.mjs';
import { PREFERENCE_STORE_SCHEMA } from '../system/contracts/preference-store.mjs';

test('favorite edits and an intentionally empty selection persist through canonical storage', () => {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) };
  let runtime = createPreferenceRuntime(createWebPreferenceStore({localStorage}));
  runtime.set('appearance.theme','dark');
  runtime.set(id,setFavoriteShortcutValue(runtime.getSnapshot()[id],'terminal',false));
  runtime.dispose();
  runtime = createPreferenceRuntime(createWebPreferenceStore({localStorage}));
  assert.ok(!readFavoriteShortcutIds(runtime.getSnapshot()[id]).includes('terminal'));
  assert.equal(runtime.getSnapshot()['appearance.theme'],'dark');
  runtime.set(id,'');
  runtime.dispose();
  runtime = createPreferenceRuntime(createWebPreferenceStore({localStorage}));
  assert.deepEqual(readFavoriteShortcutIds(runtime.getSnapshot()[id]),[]);
  assert.equal(values.size,1);
  runtime.dispose();
});

test('multiple consumers observe the same edits even when persistence fails', () => {
  const runtime = createPreferenceRuntime({schema:PREFERENCE_STORE_SCHEMA,load:()=>({}),save:()=>false});
  const home=[], apps=[];
  const releaseHome=runtime.subscribe(s=>home.push(s[id]));
  const releaseApps=runtime.subscribe(s=>apps.push(s[id]));
  runtime.set(id,setFavoriteShortcutValue(runtime.getSnapshot()[id],'files',false));
  runtime.set(id,setFavoriteShortcutValue(runtime.getSnapshot()[id],'projects',false));
  assert.deepEqual(home,apps);
  assert.equal(readFavoriteShortcutIds(runtime.getSnapshot()[id]).includes('files'),false);
  assert.equal(readFavoriteShortcutIds(runtime.getSnapshot()[id]).includes('projects'),false);
  assert.equal(runtime.getPersistenceSnapshot(),'session-only');
  releaseHome();releaseApps();runtime.dispose();
});

test('unknown targets, duplicate IDs and oversized selections fail closed; recovery retains other preferences', () => {
  for(const value of ['files,files','files,/private','https://example.com','x'.repeat(1000),{},null]) assert.throws(()=>homeShortcutsPreference.validate(value),TypeError);
  assert.throws(()=>setFavoriteShortcutValue('','unknown',true),TypeError);
  assert.throws(()=>setFavoriteShortcutValue('','files','true'),TypeError);
  const snapshot=recoverPreferenceSnapshot({[id]:'files,unknown','appearance.theme':'dark'});
  assert.equal(snapshot[id],homeShortcutsPreference.defaultValue);
  assert.equal(snapshot['appearance.theme'],'dark');
});

test('re-adding a shortcut restores canonical order and never duplicates it', () => {
  let value=setFavoriteShortcutValue(homeShortcutsPreference.defaultValue,'projects',false);
  value=setFavoriteShortcutValue(value,'projects',true);
  value=setFavoriteShortcutValue(value,'projects',true);
  assert.equal(value,homeShortcutsPreference.defaultValue);
  assert.equal(homeShortcutsPreference.validate('terminal,files'),'files,terminal');
});
